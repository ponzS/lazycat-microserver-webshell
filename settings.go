package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"lcmd-webshell/internal/pkg/fonts"
)

func (s *pluginServer) fontStore() fonts.Store {
	return fonts.Store{
		Dir:        s.fontDir,
		BundledDir: filepath.Join(s.rootDir, "runtime", "fonts", "preinstalled"),
	}
}

func (s *pluginServer) handleSettings(w http.ResponseWriter, r *http.Request) {
	store := s.fontStore()
	switch r.Method {
	case http.MethodGet:
		state, err := store.State()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, state)
	case http.MethodPut:
		var payload fonts.Settings
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
			http.Error(w, "invalid settings payload", http.StatusBadRequest)
			return
		}
		if err := store.SaveSelection(strings.TrimSpace(payload.TerminalFontID)); err != nil {
			writeSettingsError(w, err)
			return
		}
		state, err := store.State()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, state)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *pluginServer) handleSettingsFonts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	const maxFontUploadCount = 32
	if err := r.ParseMultipartForm((fonts.MaxBytes * maxFontUploadCount) + (1 << 20)); err != nil {
		http.Error(w, "invalid upload", http.StatusBadRequest)
		return
	}
	headers := r.MultipartForm.File["font"]
	if len(headers) == 0 {
		http.Error(w, "font file is required", http.StatusBadRequest)
		return
	}
	if len(headers) > maxFontUploadCount {
		http.Error(w, "too many font files", http.StatusBadRequest)
		return
	}

	store := s.fontStore()
	var selectedFontID string
	for _, header := range headers {
		file, err := header.Open()
		if err != nil {
			writeSettingsError(w, err)
			return
		}
		font, err := store.StoreUpload(header.Filename, header.Header.Get("Content-Type"), file)
		closeErr := file.Close()
		if err != nil {
			writeSettingsError(w, err)
			return
		}
		if closeErr != nil {
			writeSettingsError(w, closeErr)
			return
		}
		selectedFontID = font.ID
	}
	if err := store.SaveSelection(selectedFontID); err != nil {
		writeSettingsError(w, err)
		return
	}
	state, err := store.State()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(state)
}

func (s *pluginServer) handleSettingsFont(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/settings/fonts/")
	id, suffix, _ := strings.Cut(path, "/")
	if !fonts.ValidID(id) {
		http.Error(w, "invalid font id", http.StatusBadRequest)
		return
	}
	store := s.fontStore()
	if suffix == "file" {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		file, err := store.File(id)
		if err != nil {
			writeSettingsError(w, err)
			return
		}
		w.Header().Set("Content-Type", file.MIME)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, file.Path)
		return
	}
	if suffix != "" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := store.Delete(id); err != nil {
		writeSettingsError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeSettingsError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, fonts.ErrBadRequest) {
		status = http.StatusBadRequest
	} else if errors.Is(err, os.ErrNotExist) {
		status = http.StatusNotFound
	}
	http.Error(w, err.Error(), status)
}
