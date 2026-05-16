package fonts

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStorePersistsUploadedFontSelectionAndDelete(t *testing.T) {
	store := Store{Dir: t.TempDir()}

	font, err := store.StoreUpload("JetBrainsMono.woff2", "font/woff2", strings.NewReader("font-data"))
	if err != nil {
		t.Fatalf("StoreUpload() error = %v", err)
	}
	if font.Label != "JetBrainsMono" {
		t.Fatalf("StoreUpload() label = %q, want %q", font.Label, "JetBrainsMono")
	}
	if _, err := os.Stat(store.dataPath(Metadata{ID: font.ID, Filename: font.Filename, Extension: ".woff2"})); err != nil {
		t.Fatalf("font data not persisted: %v", err)
	}

	if err := store.SaveSelection(font.ID); err != nil {
		t.Fatalf("SaveSelection() error = %v", err)
	}
	state, err := store.State()
	if err != nil {
		t.Fatalf("State() error = %v", err)
	}
	if state.TerminalFontID != font.ID || len(state.Fonts) != 1 {
		t.Fatalf("State() = %+v, want selected font and one descriptor", state)
	}

	if err := store.Delete(font.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	state, err = store.State()
	if err != nil {
		t.Fatalf("State() after Delete() error = %v", err)
	}
	if state.TerminalFontID != "" || len(state.Fonts) != 0 {
		t.Fatalf("State() after Delete() = %+v, want empty state", state)
	}
}

func TestStoreUsesFilenameForWebFontLabel(t *testing.T) {
	store := Store{Dir: t.TempDir()}

	font, err := store.StoreUpload("霞鹜文楷.woff2", "font/woff2", strings.NewReader("font-data"))
	if err != nil {
		t.Fatalf("StoreUpload() error = %v", err)
	}
	if font.Label != "霞鹜文楷" {
		t.Fatalf("StoreUpload() label = %q, want %q", font.Label, "霞鹜文楷")
	}
	if font.Filename != "霞鹜文楷.woff2" {
		t.Fatalf("StoreUpload() filename = %q, want %q", font.Filename, "霞鹜文楷.woff2")
	}
}

func TestStoreListsSelectsServesAndDeletesBundledFonts(t *testing.T) {
	bundledDir := t.TempDir()
	writeBundledFont(t, bundledDir, "SourceCodePro-Regular.woff2", "source")
	writeBundledFont(t, bundledDir, "FiraCode-Regular.woff2", "fira")
	writeBundledFont(t, bundledDir, "Hack-Regular.woff2", "hack")
	store := Store{Dir: t.TempDir(), BundledDir: bundledDir}

	state, err := store.State()
	if err != nil {
		t.Fatalf("State() error = %v", err)
	}
	if len(state.Fonts) != 3 {
		t.Fatalf("bundled font count = %d, want 3: %+v", len(state.Fonts), state.Fonts)
	}
	for index, want := range []string{"Source Code Pro", "Fira Code", "Hack"} {
		if state.Fonts[index].Label != want {
			t.Fatalf("font[%d].Label = %q, want %q", index, state.Fonts[index].Label, want)
		}
		if !state.Fonts[index].Builtin {
			t.Fatalf("font[%d].Builtin = false, want true", index)
		}
		if state.Fonts[index].MIME != "font/woff2" {
			t.Fatalf("font[%d].MIME = %q, want font/woff2", index, state.Fonts[index].MIME)
		}
		if !strings.Contains(state.Fonts[index].URL, "?v=") {
			t.Fatalf("font[%d].URL = %q, want cache version", index, state.Fonts[index].URL)
		}
	}

	selectedID := state.Fonts[1].ID
	if err := store.SaveSelection(selectedID); err != nil {
		t.Fatalf("SaveSelection(bundled) error = %v", err)
	}
	state, err = store.State()
	if err != nil {
		t.Fatalf("State() after SaveSelection error = %v", err)
	}
	if state.TerminalFontID != selectedID {
		t.Fatalf("TerminalFontID = %q, want %q", state.TerminalFontID, selectedID)
	}

	file, err := store.File(selectedID)
	if err != nil {
		t.Fatalf("File(bundled) error = %v", err)
	}
	if file.MIME != "font/woff2" || filepath.Base(file.Path) != "FiraCode-Regular.woff2" {
		t.Fatalf("File(bundled) = %+v, want FiraCode woff2", file)
	}

	if err := store.Delete(selectedID); err != nil {
		t.Fatalf("Delete(bundled) error = %v", err)
	}
	state, err = store.State()
	if err != nil {
		t.Fatalf("State() after Delete(bundled) error = %v", err)
	}
	if state.TerminalFontID != "" {
		t.Fatalf("TerminalFontID after Delete(bundled) = %q, want empty", state.TerminalFontID)
	}
	if fontExists(state.Fonts, selectedID) {
		t.Fatalf("deleted bundled font %q is still listed: %+v", selectedID, state.Fonts)
	}
	if _, err := store.File(selectedID); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("File(deleted bundled) error = %v, want os.ErrNotExist", err)
	}
	if err := store.SaveSelection(selectedID); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("SaveSelection(deleted bundled) error = %v, want ErrBadRequest", err)
	}
}

func writeBundledFont(t *testing.T, dir, name, data string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o644); err != nil {
		t.Fatalf("write bundled font %q error = %v", name, err)
	}
}
