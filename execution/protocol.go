// Package execution implements the versioned native execution wire protocol.
package execution

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

const ProtocolVersion = 2
const ServiceName = "cloud.lazycat.pty.v1"
const MaxFrame = 512 << 10
const OutputWindow = 4 << 20

// Scope is immutable for the lifetime of an executor.
type Scope struct {
	BoxID     string `json:"box_id"`
	AccountID string `json:"account_id"`
	DeviceID  string `json:"device_id"`
	Epoch     string `json:"execution_epoch"`
}
type Config struct {
	Scope    Scope  `json:"scope"`
	StateDir string `json:"state_dir"`
}
type Descriptor struct {
	Scope    Scope  `json:"scope"`
	Secret   string `json:"secret"`
	Protocol int    `json:"protocol_version"`
	Home     string `json:"home"`
	OS       string `json:"os"`
}
type Size struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
	X    int `json:"x,omitempty"`
	Y    int `json:"y,omitempty"`
}
type Request struct {
	ConnectionBound bool              `json:"connection_bound,omitempty"`
	Execute         bool              `json:"execute,omitempty"`
	Sessions        []string          `json:"sessions,omitempty"`
	ID              string            `json:"request_id"`
	Op              string            `json:"op"`
	Epoch           string            `json:"execution_epoch"`
	Controller      string            `json:"controller_generation"`
	Session         string            `json:"session_id,omitempty"`
	Key             string            `json:"logical_session_key,omitempty"`
	Offset          uint64            `json:"input_offset,omitempty"`
	Sequence        uint64            `json:"event_sequence,omitempty"`
	Checkpoint      *uint64           `json:"checkpoint_sequence,omitempty"`
	Data            []byte            `json:"data,omitempty"`
	Size            Size              `json:"size,omitempty"`
	Command         string            `json:"command,omitempty"`
	CWD             string            `json:"cwd,omitempty"`
	Term            string            `json:"term,omitempty"`
	Modes           map[uint8]uint32  `json:"modes,omitempty"`
	Environment     map[string]string `json:"environment,omitempty"`
	Path            string            `json:"path,omitempty"`
	Path2           string            `json:"path2,omitempty"`
	Flags           int               `json:"flags,omitempty"`
	Mode            uint32            `json:"mode,omitempty"`
	Position        int64             `json:"position,omitempty"`
	Length          int               `json:"length,omitempty"`
	Network         string            `json:"network,omitempty"`
	Address         string            `json:"address,omitempty"`
	Signal          string            `json:"signal,omitempty"`
}
type Event struct {
	Sequence uint64 `json:"event_sequence"`
	Kind     string `json:"kind"`
	Data     []byte `json:"data,omitempty"`
	Size     Size   `json:"size,omitempty"`
	Exit     *Exit  `json:"exit,omitempty"`
}
type Exit struct {
	Code   int    `json:"code"`
	Signal string `json:"signal,omitempty"`
	Error  string `json:"error,omitempty"`
}
type SessionInfo struct {
	ID            string `json:"session_id"`
	Key           string `json:"logical_session_key"`
	InputOffset   uint64 `json:"input_offset"`
	FirstSequence uint64 `json:"first_sequence"`
	NextSequence  uint64 `json:"next_sequence"`
	Exit          *Exit  `json:"exit,omitempty"`
	PID           int    `json:"pid"`
	ForegroundPID int    `json:"foreground_pid"`
}
type FileInfo struct {
	UID     uint32    `json:"uid"`
	GID     uint32    `json:"gid"`
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	Mode    uint32    `json:"mode"`
	ModTime time.Time `json:"mod_time"`
	Link    string    `json:"link,omitempty"`
}
type Response struct {
	ErrorCode string          `json:"error_code,omitempty"`
	ID        string          `json:"request_id"`
	Error     string          `json:"error,omitempty"`
	Session   string          `json:"session_id,omitempty"`
	Offset    uint64          `json:"input_offset,omitempty"`
	Event     *Event          `json:"event,omitempty"`
	Sessions  []SessionInfo   `json:"sessions,omitempty"`
	Data      []byte          `json:"data,omitempty"`
	Files     []FileInfo      `json:"files,omitempty"`
	Info      *Descriptor     `json:"info,omitempty"`
	Exit      *Exit           `json:"exit,omitempty"`
	Address   string          `json:"address,omitempty"`
	Value     json.RawMessage `json:"value,omitempty"`
}

func randomID() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (s Scope) Validate() error {
	if s.BoxID == "" || s.AccountID == "" || s.DeviceID == "" || s.Epoch == "" {
		return errors.New("incomplete execution scope")
	}
	return nil
}

// File flags are protocol bits, never the service host's syscall constants.
const (
	FileRead = 1 << iota
	FileWrite
	FileCreate
	FileTruncate
	FileExclusive
	FileAppend
	FileSync
)
