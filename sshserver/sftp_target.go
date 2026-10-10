package sshserver

import (
	"errors"
	"github.com/pkg/sftp"
	"io"
	"lcmd-webshell/core"
	"os"
	"time"
)

type targetSFTP struct {
	files core.TargetFiles
	home  string
}

func (h targetSFTP) absolute(path string) string {
	if !h.files.IsAbs(path) {
		path = h.files.Join(h.home, path)
	}
	return h.files.Clean(path)
}
func (h targetSFTP) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	return h.files.OpenFile(h.absolute(r.Filepath), os.O_RDONLY, 0)
}
func (h targetSFTP) open(r *sftp.Request) (core.TargetFile, error) {
	p := r.Pflags()
	flags := os.O_RDONLY
	if p.Write {
		flags = os.O_WRONLY
	}
	if p.Read && p.Write {
		flags = os.O_RDWR
	}
	if p.Creat {
		flags |= os.O_CREATE
	}
	if p.Trunc {
		flags |= os.O_TRUNC
	}
	if p.Append {
		flags |= os.O_APPEND
	}
	if p.Excl {
		flags |= os.O_EXCL
	}
	f, err := h.files.OpenFile(h.absolute(r.Filepath), flags, 0666)
	if err != nil {
		return nil, err
	}
	if p.Append {
		return &appendTargetFile{TargetFile: f}, nil
	}
	return f, nil
}
func (h targetSFTP) Filewrite(r *sftp.Request) (io.WriterAt, error)          { return h.open(r) }
func (h targetSFTP) OpenFile(r *sftp.Request) (sftp.WriterAtReaderAt, error) { return h.open(r) }

type appendTargetFile struct{ core.TargetFile }

func (f *appendTargetFile) WriteAt(b []byte, _ int64) (int, error) { return f.TargetFile.Write(b) }
func (h targetSFTP) Filecmd(r *sftp.Request) error {
	path, target := h.absolute(r.Filepath), h.absolute(r.Target)
	switch r.Method {
	case "Setstat":
		a, flags := r.Attributes(), r.AttrFlags()
		if flags.Size {
			if err := h.files.Truncate(path, int64(a.Size)); err != nil {
				return err
			}
		}
		if flags.Permissions {
			if err := h.files.Chmod(path, a.FileMode()); err != nil {
				return err
			}
		}
		if flags.UidGid {
			if err := h.files.Chown(path, int(a.UID), int(a.GID)); err != nil {
				return err
			}
		}
		if flags.Acmodtime {
			return h.files.Chtimes(path, time.Unix(int64(a.Atime), 0), time.Unix(int64(a.Mtime), 0))
		}
		return nil
	case "Rename":
		return h.files.Rename(path, target)
	case "Rmdir", "Remove":
		return h.files.Remove(path)
	case "Mkdir":
		mode := os.FileMode(0777)
		if r.AttrFlags().Permissions {
			mode = r.Attributes().FileMode()
		}
		return h.files.Mkdir(path, mode)
	case "Link":
		return h.files.Link(path, target)
	case "Symlink":
		return h.files.Symlink(r.Filepath, target)
	}
	return errors.New("unsupported file operation")
}
func (h targetSFTP) PosixRename(r *sftp.Request) error {
	return h.files.Rename(h.absolute(r.Filepath), h.absolute(r.Target))
}

type targetFileList []os.FileInfo

func (l targetFileList) ListAt(dst []os.FileInfo, offset int64) (int, error) {
	if offset < 0 || offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(dst, l[offset:])
	if n < len(dst) {
		return n, io.EOF
	}
	return n, nil
}
func (h targetSFTP) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	path := h.absolute(r.Filepath)
	switch r.Method {
	case "List":
		items, err := h.files.ReadDir(path)
		return targetFileList(items), err
	case "Stat":
		i, err := h.files.Stat(path)
		if err != nil {
			return nil, err
		}
		return targetFileList{i}, nil
	}
	return nil, errors.New("unsupported file listing")
}
func (h targetSFTP) Lstat(r *sftp.Request) (sftp.ListerAt, error) {
	i, err := h.files.Lstat(h.absolute(r.Filepath))
	if err != nil {
		return nil, err
	}
	return targetFileList{i}, nil
}
func (h targetSFTP) RealPath(path string) (string, error) { return h.absolute(path), nil }
func (h targetSFTP) Readlink(path string) (string, error) { return h.files.Readlink(h.absolute(path)) }

func (h targetSFTP) StatVFS(r *sftp.Request) (*sftp.StatVFS, error) {
	stats, ok := h.files.(core.TargetFilesystemStatistics)
	if !ok {
		return nil, errors.New("filesystem statistics unavailable")
	}
	v, err := stats.StatVFS(h.absolute(r.Filepath))
	if err != nil {
		return nil, err
	}
	return &sftp.StatVFS{Bsize: v.Bsize, Frsize: v.Frsize, Blocks: v.Blocks, Bfree: v.Bfree, Bavail: v.Bavail, Files: v.Files, Ffree: v.Ffree, Favail: v.Favail, Fsid: v.Fsid, Flag: v.Flag, Namemax: v.Namemax}, nil
}
