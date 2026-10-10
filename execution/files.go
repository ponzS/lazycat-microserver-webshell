package execution

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"lcmd-webshell/core"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

type Files struct{ backend *Backend }
type RemoteFile struct {
	files    *Files
	id, name string
	position int64
	flags    int
	mu       sync.Mutex
	once     sync.Once
}
type nativeFileInfo struct{ FileInfo }

func (i nativeFileInfo) Name() string       { return i.FileInfo.Name }
func (i nativeFileInfo) Size() int64        { return i.FileInfo.Size }
func (i nativeFileInfo) Mode() fs.FileMode  { return fs.FileMode(i.FileInfo.Mode) }
func (i nativeFileInfo) ModTime() time.Time { return i.FileInfo.ModTime }
func (i nativeFileInfo) IsDir() bool        { return i.Mode().IsDir() }
func (i nativeFileInfo) Sys() any           { return nil }
func (f *Files) call(q Request) (Response, error) {
	ctx, cancel := context.WithTimeout(f.backend.ctx, 30*time.Second)
	defer cancel()
	return f.backend.call(ctx, q, false)
}
func (f *Files) OpenFile(path string, flags int, mode os.FileMode) (core.TargetFile, error) {
	r, err := f.call(Request{Op: "file_open", Path: path, Flags: portableFileFlags(flags), Mode: uint32(mode)})
	if err != nil {
		return nil, err
	}
	return &RemoteFile{files: f, id: r.Session, name: path, flags: flags}, nil
}
func (f *Files) Stat(path string) (fs.FileInfo, error)  { return f.stat(path, "file_stat") }
func (f *Files) Lstat(path string) (fs.FileInfo, error) { return f.stat(path, "file_lstat") }
func (f *Files) stat(path, op string) (fs.FileInfo, error) {
	r, err := f.call(Request{Op: op, Path: path})
	if err != nil {
		return nil, err
	}
	if len(r.Files) != 1 {
		return nil, errors.New("missing file metadata")
	}
	return nativeFileInfo{r.Files[0]}, nil
}
func (f *Files) ReadDir(path string) ([]fs.FileInfo, error) {
	var items []fs.FileInfo
	var offset int64
	for {
		r, err := f.call(Request{Op: "file_readdir", Path: path, Position: offset})
		if err != nil {
			return nil, err
		}
		for _, i := range r.Files {
			items = append(items, nativeFileInfo{i})
		}
		if len(r.Files) < 128 {
			return items, nil
		}
		if int64(r.Offset) <= offset {
			return nil, errors.New("invalid directory cursor")
		}
		offset = int64(r.Offset)
	}
}
func (f *Files) mutation(op, path, path2 string, mode os.FileMode, position int64, length int, offset uint64) error {
	_, err := f.call(Request{Op: op, Path: path, Path2: path2, Mode: uint32(mode), Position: position, Length: length, Offset: offset})
	return err
}
func (f *Files) Mkdir(p string, m os.FileMode) error {
	return f.mutation("file_mkdir", p, "", m, 0, 0, 0)
}
func (f *Files) Remove(p string) error { return f.mutation("file_remove", p, "", 0, 0, 0, 0) }
func (f *Files) RemoveAll(p string) error {
	_, err := f.call(Request{Op: "file_remove_all", Path: p})
	return err
}
func (f *Files) Rename(p, q string) error { return f.mutation("file_rename", p, q, 0, 0, 0, 0) }
func (f *Files) Chmod(p string, m os.FileMode) error {
	return f.mutation("file_chmod", p, "", m, 0, 0, 0)
}
func (f *Files) Chown(p string, uid, gid int) error {
	return f.mutation("file_chown", p, "", 0, int64(uid), gid, 0)
}
func (f *Files) Truncate(p string, n int64) error {
	return f.mutation("file_truncate", p, "", 0, n, 0, 0)
}
func (f *Files) Chtimes(p string, a, m time.Time) error {
	return f.mutation("file_times", p, "", 0, a.Unix(), 0, uint64(m.Unix()))
}
func (f *Files) Readlink(p string) (string, error) {
	r, err := f.call(Request{Op: "file_readlink", Path: p})
	return r.Address, err
}
func (f *Files) Symlink(p, q string) error { return f.mutation("file_symlink", p, q, 0, 0, 0, 0) }
func (f *Files) Link(p, q string) error    { return f.mutation("file_link", p, q, 0, 0, 0, 0) }
func (f *Files) MkdirTemp(p, pattern string) (string, error) {
	r, err := f.call(Request{Op: "file_mkdir_temp", Path: p, Path2: pattern})
	return r.Address, err
}
func (f *Files) Glob(path string) ([]string, error) {
	var items []string
	var offset int64
	for {
		r, err := f.call(Request{Op: "file_glob", Path: path, Position: offset})
		if err != nil {
			return nil, err
		}
		var batch []string
		if err = json.Unmarshal(r.Value, &batch); err != nil {
			return nil, err
		}
		items = append(items, batch...)
		if len(batch) < 128 {
			return items, nil
		}
		if int64(r.Offset) <= offset {
			return nil, errors.New("invalid glob cursor")
		}
		offset = int64(r.Offset)
	}
}
func (f *Files) windows() bool { return f.backend.Descriptor().OS == "windows" }
func (f *Files) Clean(p string) string {
	if f.windows() {
		p = strings.ReplaceAll(p, "\\", "/")
	}
	if !f.windows() {
		return path.Clean(p)
	}
	if strings.HasPrefix(p, "//") {
		parts := strings.Split(strings.TrimLeft(p, "/"), "/")
		if len(parts) < 2 {
			return "//" + strings.Join(parts, "/")
		}
		volume := "//" + parts[0] + "/" + parts[1]
		rest := path.Clean("/" + strings.Join(parts[2:], "/"))
		if rest == "/" {
			return volume
		}
		return volume + rest
	}
	if len(p) >= 2 && p[1] == ':' {
		return p[:2] + path.Clean(p[2:])
	}
	return path.Clean(p)
}
func (f *Files) Join(parts ...string) string {
	if f.windows() {
		return f.Clean(strings.Join(parts, "/"))
	}
	return f.Clean(path.Join(parts...))
}
func (f *Files) Base(p string) string { return path.Base(f.Clean(p)) }
func (f *Files) Dir(p string) string {
	clean := f.Clean(p)
	if f.windows() && strings.HasPrefix(clean, "//") {
		parts := strings.Split(strings.TrimPrefix(clean, "//"), "/")
		if len(parts) <= 2 {
			return clean
		}
		return "//" + strings.Join(parts[:len(parts)-1], "/")
	}
	return path.Dir(clean)
}
func (f *Files) IsAbs(p string) bool {
	return strings.HasPrefix(p, "/") || f.windows() && (len(p) > 2 && p[1] == ':' && (p[2] == '/' || p[2] == '\\') || strings.HasPrefix(p, `\\`))
}
func (f *Files) TempDir() string {
	r, err := f.call(Request{Op: "file_temp_dir"})
	if err != nil {
		return f.backend.Descriptor().Home
	}
	return r.Address
}
func (f *RemoteFile) ReadAt(b []byte, offset int64) (int, error) {
	read := 0
	for len(b) > 0 {
		length := len(b)
		if length > 64<<10 {
			length = 64 << 10
		}
		r, err := f.files.call(Request{Op: "file_read", Session: f.id, Position: offset, Length: length})
		n := copy(b, r.Data)
		read += n
		offset += int64(n)
		b = b[n:]
		if err != nil {
			return read, err
		}
		if n < length {
			return read, io.EOF
		}
	}
	return read, nil
}
func (f *RemoteFile) WriteAt(b []byte, offset int64) (int, error) {
	written := 0
	for len(b) > 0 {
		chunk := b
		if len(chunk) > 64<<10 {
			chunk = chunk[:64<<10]
		}
		op := "file_write"
		if f.flags&os.O_APPEND != 0 {
			op = "file_append"
		}
		r, err := f.files.call(Request{Op: op, Session: f.id, Position: offset, Data: chunk})
		n := int(r.Offset)
		if n < 0 || n > len(chunk) {
			return written, errors.New("invalid remote write size")
		}
		written += n
		offset += int64(n)
		b = b[n:]
		if err != nil {
			return written, err
		}
		if n == 0 {
			return written, io.ErrShortWrite
		}
	}
	return written, nil
}
func (f *RemoteFile) Read(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, err := f.ReadAt(b, f.position)
	f.position += int64(n)
	return n, err
}
func (f *RemoteFile) Write(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, err := f.WriteAt(b, f.position)
	f.position += int64(n)
	return n, err
}
func (f *RemoteFile) Seek(offset int64, whence int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch whence {
	case io.SeekStart:
		f.position = offset
	case io.SeekCurrent:
		f.position += offset
	case io.SeekEnd:
		i, err := f.Stat()
		if err != nil {
			return 0, err
		}
		f.position = i.Size() + offset
	default:
		return 0, errors.New("invalid seek")
	}
	if f.position < 0 {
		return 0, errors.New("negative seek")
	}
	return f.position, nil
}
func (f *RemoteFile) Stat() (fs.FileInfo, error) {
	r, err := f.files.call(Request{Op: "file_fstat", Session: f.id})
	if err != nil {
		return nil, err
	}
	if len(r.Files) != 1 {
		return nil, errors.New("missing file metadata")
	}
	return nativeFileInfo{r.Files[0]}, nil
}
func (f *RemoteFile) Chmod(m os.FileMode) error {
	_, err := f.files.call(Request{Op: "file_fchmod", Session: f.id, Mode: uint32(m)})
	return err
}
func (f *RemoteFile) Close() error {
	var err error
	f.once.Do(func() { _, err = f.files.call(Request{Op: "file_close", Session: f.id}) })
	return err
}
func unmarshalMetrics(b []byte, m *core.HostMetrics) error { return json.Unmarshal(b, m) }

func (f *RemoteFile) Sync() error {
	_, err := f.files.call(Request{Op: "file_sync", Session: f.id})
	return err
}
func (i nativeFileInfo) Uid() uint32 { return i.FileInfo.UID }
func (i nativeFileInfo) Gid() uint32 { return i.FileInfo.GID }
func portableFileFlags(flags int) int {
	mode := FileRead
	if flags&os.O_WRONLY != 0 {
		mode = FileWrite
	}
	if flags&os.O_RDWR != 0 {
		mode = FileRead | FileWrite
	}
	if flags&os.O_CREATE != 0 {
		mode |= FileCreate
	}
	if flags&os.O_TRUNC != 0 {
		mode |= FileTruncate
	}
	if flags&os.O_EXCL != 0 {
		mode |= FileExclusive
	}
	if flags&os.O_APPEND != 0 {
		mode |= FileAppend
	}
	if flags&os.O_SYNC != 0 {
		mode |= FileSync
	}
	return mode
}
func (f *Files) StatVFS(path string) (core.TargetFSStat, error) {
	r, err := f.call(Request{Op: "file_statvfs", Path: path})
	if err != nil {
		return core.TargetFSStat{}, err
	}
	var value core.TargetFSStat
	err = json.Unmarshal(r.Value, &value)
	return value, err
}
