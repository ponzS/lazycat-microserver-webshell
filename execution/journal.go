package execution

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

func hashKey(key string) string { sum := sha256.Sum256([]byte(key)); return hex.EncodeToString(sum[:]) }
func atomicPrivateFile(path string, raw []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".commit-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

type savedCheckpoint struct {
	Sequence    uint64
	Data        []byte
	Digest      string
	TextPending []byte
	TextDigest  string
}

func (p *Process) loadJournal() error {
	raw, err := os.ReadFile(filepath.Join(p.dir, "checkpoint.json"))
	if err == nil {
		var saved savedCheckpoint
		if json.Unmarshal(raw, &saved) != nil || saved.Digest != hashKey(string(saved.Data)) || saved.TextDigest != "" && saved.TextDigest != hashKey(string(saved.TextPending)) {
			return errors.New("corrupt execution checkpoint")
		}
		p.checkpoint = saved.Data
		p.next = saved.Sequence + 1
		if p.decoder != nil {
			p.decoder.Pending = saved.TextPending
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	f, err := os.OpenFile(filepath.Join(p.dir, "events.jsonl"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	p.journal = f
	reader := bufio.NewReader(f)
	var complete int64
	for {
		line, err := reader.ReadBytes('\n')
		if err == io.EOF {
			if len(line) > 0 {
				if err = f.Truncate(complete); err != nil {
					return err
				}
			}
			break
		}
		if err != nil {
			return err
		}
		var ev Event
		if json.Unmarshal(line, &ev) != nil {
			return errors.New("corrupt execution event journal")
		}
		complete += int64(len(line))
		if ev.Sequence >= p.next {
			p.replay = append(p.replay, ev)
		}
	}
	_, err = f.Seek(0, io.SeekEnd)
	return err
}
func (p *Process) journalEvent(ev Event) error {
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if _, err = p.journal.Write(raw); err != nil {
		return err
	}
	return p.journal.Sync()
}
