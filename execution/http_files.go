package execution

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (h FileHandler) fileRoot() string {
	home := h.Backend.Descriptor().Home
	if h.Backend.Descriptor().OS == "windows" && len(home) > 2 {
		return home[:2] + "/"
	}
	return "/"
}
func (h FileHandler) displayPath(path string) string {
	if path == "" {
		return ""
	}
	relative, err := targetRelative(h.fileRoot(), path)
	if err != nil {
		return ""
	}
	if relative == "." {
		return "/"
	}
	return "/" + filepath.ToSlash(relative)
}
func (h FileHandler) localPath(value string) (string, error) {
	if strings.IndexByte(value, 0) >= 0 {
		return "", errors.New("invalid path")
	}
	root := h.fileRoot()
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return "", errors.New("path escapes root directory")
		}
	}
	var path string
	if h.Backend.Descriptor().OS != "windows" && h.files().IsAbs(value) || len(value) > 2 && value[1] == ':' {
		path = h.files().Clean(value)
	} else {
		path = h.files().Join(root, targetFromSlash(strings.TrimLeft(value, "/")))
	}
	real, err := h.resolve(path)
	if err != nil {
		return "", err
	}
	relative, err := targetRelative(root, real)
	if err != nil || h.files().IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+"/") {
		return "", errors.New("path escapes root directory")
	}
	return real, nil
}

type fileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Type     string `json:"type"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

func (h FileHandler) entry(path string) (fileEntry, error) {
	real, err := h.localPath(path)
	if err != nil {
		return fileEntry{}, err
	}
	st, err := h.files().Stat(real)
	if err != nil {
		return fileEntry{}, err
	}
	kind := "file"
	if st.IsDir() {
		kind = "dir"
	}
	size := st.Size()
	if st.IsDir() {
		size = 0
	}
	return fileEntry{Name: h.files().Base(path), Path: h.displayPath(path), Type: kind, Size: size, Modified: st.ModTime().Unix()}, nil
}

func (h FileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var err error
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/attachments/files":
		var path string
		path, err = h.localPath(r.URL.Query().Get("path"))
		if err != nil {
			break
		}
		var files []os.FileInfo
		files, err = h.files().ReadDir(path)
		if err != nil {
			break
		}
		items := make([]fileEntry, 0, len(files))
		for _, f := range files {
			if e, eErr := h.entry(h.files().Join(path, f.Name())); eErr == nil {
				items = append(items, e)
			}
		}
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].Type != items[j].Type {
				return items[i].Type == "dir"
			}
			return items[i].Name < items[j].Name
		})
		parent := h.files().Dir(path)
		if parent == path {
			parent = ""
		}
		fileReply(w, 200, map[string]any{"path": h.displayPath(path), "parent": h.displayPath(parent), "entries": items})
		return
	case r.Method == http.MethodGet && r.URL.Path == "/attachments/stat":
		paths := r.URL.Query()["path"]
		if len(paths) == 0 || len(paths) > 64 {
			err = errors.New("invalid path count")
			break
		}
		items := make([]fileEntry, 0, len(paths))
		for _, p := range paths {
			var resolved string
			resolved, err = h.localPath(p)
			if err != nil {
				break
			}
			var item fileEntry
			item, err = h.entry(resolved)
			if err != nil {
				break
			}
			items = append(items, item)
		}
		if err == nil {
			fileReply(w, 200, items)
			return
		}
	case r.Method == http.MethodGet && r.URL.Path == "/attachments/open":
		var path string
		path, err = h.localPath(r.URL.Query().Get("path"))
		if err != nil {
			break
		}
		info, statErr := h.files().Stat(path)
		if statErr != nil {
			err = statErr
			break
		}
		if !info.Mode().IsRegular() {
			err = errors.New("selected path is not a regular file")
			break
		}
		response, requestErr := h.Backend.fileHTTP(r.Context(), http.MethodGet, fileServicePath(path), nil, r.Header)
		if requestErr != nil {
			err = requestErr
			break
		}
		defer response.Body.Close()
		for _, name := range []string{"Content-Length", "Content-Range", "Last-Modified", "ETag", "Accept-Ranges"} {
			for _, value := range response.Header.Values(name) {
				w.Header().Add(name, value)
			}
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
		return
	case r.Method == http.MethodPost && r.URL.Path == "/attachments":
		err = h.upload(w, r)
		if err == nil {
			return
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	fileReply(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
}

func (h FileHandler) upload(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, 32*(2<<30)+1<<20)
	reader, err := r.MultipartReader()
	if err != nil {
		return err
	}
	base := h.files().TempDir()
	if relative, err := targetRelative(h.fileRoot(), base); err != nil || h.files().IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+"/") {
		base = h.Backend.Descriptor().Home
	}
	dir, err := h.files().MkdirTemp(base, "lightos-upload-")
	if err != nil {
		return err
	}
	var created []string
	success := false
	defer func() {
		if !success {
			for _, path := range created {
				_ = h.files().Remove(path)
			}
			_ = h.files().Remove(dir)
		}
	}()
	files := make([]fileEntry, 0)
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		if len(files) >= 32 {
			return errors.New("too many files")
		}
		name := h.files().Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		if name == "." || name == ".." || name == "" {
			return errors.New("invalid filename")
		}
		target := h.files().Join(dir, name)
		created = append(created, target)
		limited := &io.LimitedReader{R: part, N: (2 << 30) + 1}
		copyErr := h.Backend.putFile(r.Context(), target, limited)
		size := (2 << 30) + 1 - limited.N
		_ = part.Close()
		if copyErr != nil {
			return copyErr
		}
		if err := h.files().Chmod(target, 0600); err != nil {
			return err
		}
		if size > 2<<30 {
			return errors.New("file exceeds 2 GiB")
		}
		files = append(files, fileEntry{Name: h.files().Base(h.files().Join(dir, name)), Path: h.displayPath(h.files().Join(dir, name)), Type: "file", Size: size})
	}
	if len(files) == 0 {
		return errors.New("file is required")
	}
	success = true
	fileReply(w, http.StatusCreated, map[string]any{"files": files})
	return nil
}

type FileHandler struct{ Backend *Backend }

func (h FileHandler) files() *Files { return &Files{backend: h.Backend} }
func (h FileHandler) resolve(p string) (string, error) {
	r, err := h.files().call(Request{Op: "file_resolve", Path: p})
	return r.Address, err
}
func fileReply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func targetFromSlash(p string) string { return p }
func targetRelative(root, p string) (string, error) {
	root = strings.ReplaceAll(root, "\\", "/")
	p = strings.ReplaceAll(p, "\\", "/")
	if !strings.HasPrefix(strings.ToLower(p), strings.ToLower(root)) {
		return "", errors.New("path escapes root directory")
	}
	relative := strings.TrimPrefix(p[len(root):], "/")
	if relative == "" {
		return ".", nil
	}
	return relative, nil
}
