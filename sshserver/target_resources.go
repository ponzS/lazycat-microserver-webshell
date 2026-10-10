package sshserver

import (
	"context"
	"io/fs"
	"lcmd-webshell/core"
	"net"
	"os"
	"path/filepath"
	"time"
)

type nativeFiles struct{}

func (nativeFiles) OpenFile(p string, f int, m os.FileMode) (core.TargetFile, error) {
	return os.OpenFile(p, f, m)
}
func (nativeFiles) Stat(p string) (fs.FileInfo, error)  { return os.Stat(p) }
func (nativeFiles) Lstat(p string) (fs.FileInfo, error) { return os.Lstat(p) }
func (nativeFiles) ReadDir(p string) ([]fs.FileInfo, error) {
	entries, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	items := make([]fs.FileInfo, 0, len(entries))
	for _, entry := range entries {
		i, err := entry.Info()
		if err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, nil
}
func (nativeFiles) Mkdir(p string, m os.FileMode) error    { return os.Mkdir(p, m) }
func (nativeFiles) Remove(p string) error                  { return os.Remove(p) }
func (nativeFiles) RemoveAll(p string) error               { return os.RemoveAll(p) }
func (nativeFiles) Rename(p, q string) error               { return os.Rename(p, q) }
func (nativeFiles) Chmod(p string, m os.FileMode) error    { return os.Chmod(p, m) }
func (nativeFiles) Chown(p string, u, g int) error         { return os.Chown(p, u, g) }
func (nativeFiles) Truncate(p string, n int64) error       { return os.Truncate(p, n) }
func (nativeFiles) Chtimes(p string, a, m time.Time) error { return os.Chtimes(p, a, m) }
func (nativeFiles) Readlink(p string) (string, error)      { return os.Readlink(p) }
func (nativeFiles) Symlink(p, q string) error              { return os.Symlink(p, q) }
func (nativeFiles) Link(p, q string) error                 { return os.Link(p, q) }
func (nativeFiles) MkdirTemp(p, q string) (string, error)  { return os.MkdirTemp(p, q) }
func (nativeFiles) Glob(p string) ([]string, error)        { return filepath.Glob(p) }
func (nativeFiles) Join(p ...string) string                { return filepath.Join(p...) }
func (nativeFiles) Clean(p string) string                  { return filepath.Clean(p) }
func (nativeFiles) Base(p string) string                   { return filepath.Base(p) }
func (nativeFiles) Dir(p string) string                    { return filepath.Dir(p) }
func (nativeFiles) IsAbs(p string) bool                    { return filepath.IsAbs(p) }
func (nativeFiles) TempDir() string                        { return os.TempDir() }

type nativeNetwork struct{}

func (nativeNetwork) DialContext(ctx context.Context, n, a string) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, n, a)
}
func (nativeNetwork) Listen(ctx context.Context, n, a string) (net.Listener, error) {
	return (&net.ListenConfig{}).Listen(ctx, n, a)
}
func writeTargetFile(files core.TargetFiles, path string, data []byte, mode os.FileMode) error {
	f, err := files.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
