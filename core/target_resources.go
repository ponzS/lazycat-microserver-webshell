package core

import (
	"context"
	"io"
	"io/fs"
	"net"
	"os"
	"time"
)

type TargetFile interface {
	io.Reader
	io.Writer
	io.ReaderAt
	io.WriterAt
	io.Seeker
	io.Closer
	Sync() error
	Stat() (fs.FileInfo, error)
	Chmod(os.FileMode) error
}
type TargetFiles interface {
	OpenFile(string, int, os.FileMode) (TargetFile, error)
	Stat(string) (fs.FileInfo, error)
	Lstat(string) (fs.FileInfo, error)
	ReadDir(string) ([]fs.FileInfo, error)
	Mkdir(string, os.FileMode) error
	Remove(string) error
	RemoveAll(string) error
	Rename(string, string) error
	Chmod(string, os.FileMode) error
	Chown(string, int, int) error
	Truncate(string, int64) error
	Chtimes(string, time.Time, time.Time) error
	Readlink(string) (string, error)
	Symlink(string, string) error
	Link(string, string) error
	MkdirTemp(string, string) (string, error)
	Glob(string) ([]string, error)
	Join(...string) string
	Clean(string) string
	Base(string) string
	Dir(string) string
	IsAbs(string) bool
	TempDir() string
}
type TargetFilesProvider interface{ TargetFiles() TargetFiles }
type TargetNetwork interface {
	DialContext(context.Context, string, string) (net.Conn, error)
	Listen(context.Context, string, string) (net.Listener, error)
}
type TargetNetworkProvider interface{ TargetNetwork() TargetNetwork }

type TargetFSStat struct{ Bsize, Frsize, Blocks, Bfree, Bavail, Files, Ffree, Favail, Fsid, Flag, Namemax uint64 }
type TargetFilesystemStatistics interface {
	StatVFS(string) (TargetFSStat, error)
}
