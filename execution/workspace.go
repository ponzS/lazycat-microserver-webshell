package execution

import (
	"os"
	"path/filepath"
)

func (b *Backend) LoadWorkspace() ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(b.dir, "workspace.json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	return raw, err
}
func (b *Backend) SaveWorkspace(raw []byte) error {
	return atomicPrivateFile(filepath.Join(b.dir, "workspace.json"), raw)
}

func (b *Backend) InitialWorkspaceGeneration() (string, error) {
	path := filepath.Join(b.dir, "generation")
	raw, err := os.ReadFile(path)
	if err == nil {
		return string(raw), nil
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	generation := randomID()
	if err = atomicPrivateFile(path, []byte(generation)); err != nil {
		return "", err
	}
	return generation, nil
}
