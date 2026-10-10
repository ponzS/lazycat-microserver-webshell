package core

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/tetratelabs/wazero/api"
	"io"
	"time"
)

// Only the remote native backend uses this private recovery format. Container
// agents continue to own their state and use the existing browser checkpoints.
type executionCheckpoint struct {
	Exit                                                                      *ProcessResult
	GeneratedSources                                                          map[string][]string
	CursorSources                                                             []string
	Failure                                                                   *checkpointFailure
	Fallback                                                                  bool
	Version                                                                   int
	RawSequence                                                               uint64
	HistoryGeneration                                                         string
	HistoryBase, HistoryEnd                                                   uint64
	HistoryChunks                                                             [][]byte
	HistoryLimit                                                              int
	Checkpoint                                                                *terminalMemoryCheckpoint
	Memory                                                                    []byte
	ParserPending                                                             []byte
	ControlPending, LocalCWDPending, QueryPending, GeneratedEchoOutputPending []byte
	GeneratedInputs                                                           map[string]int
	CursorReports                                                             int
	CursorReportUntil                                                         time.Time
	Echoes                                                                    []executionEcho
	Foreground, Background, Cursor, CWD                                       string
	ResizeEpoch                                                               uint64
	Cols, Rows, PixelWidth, PixelHeight                                       int
}
type executionEcho struct{ Raw, Quoted []byte }

func (p *terminalPane) executionCheckpoint() ([]byte, error) {
	p.generatedMu.Lock()
	defer p.generatedMu.Unlock()
	p.outputMu.Lock()
	defer p.outputMu.Unlock()
	p.mu.Lock()
	defer p.mu.Unlock()
	checkpoint, err := p.checkpoint.snapshot(p.history.end)
	fallback := err != nil || checkpoint == nil
	var memory []byte
	if checkpoint != nil {
		memory = checkpoint.Compressed
	}
	saved := executionCheckpoint{Exit: p.executionExit, Version: 1, RawSequence: p.rawSequence, HistoryGeneration: p.historyGeneration, HistoryBase: p.history.base, HistoryEnd: p.history.end, HistoryChunks: p.history.chunks, HistoryLimit: p.historyLimitBytes, Checkpoint: checkpoint, Memory: memory, GeneratedSources: p.pendingGeneratedSources, CursorSources: p.pendingCursorSources, Failure: p.checkpointFailure, Fallback: fallback, ParserPending: p.checkpoint.pending, ControlPending: p.controlPending, LocalCWDPending: p.localCWDPending, QueryPending: p.terminalQueryPending, GeneratedEchoOutputPending: p.generatedEchoOutputPending, GeneratedInputs: p.pendingGeneratedInputs, CursorReports: p.pendingCursorReports, CursorReportUntil: p.pendingCursorReportUntil, Foreground: p.terminalForegroundColor, Background: p.terminalBackgroundColor, Cursor: p.terminalCursorColor, CWD: p.cwd, ResizeEpoch: p.resizeEpoch, Cols: p.cols, Rows: p.rows, PixelWidth: p.pixelWidth, PixelHeight: p.pixelHeight}
	for _, echo := range p.generatedEchoPending {
		saved.Echoes = append(saved.Echoes, executionEcho{echo.raw, echo.quoted})
	}
	return json.Marshal(saved)
}
func (p *terminalPane) restoreExecutionCheckpoint(raw []byte) error {
	var saved executionCheckpoint
	if err := json.Unmarshal(raw, &saved); err != nil {
		return fmt.Errorf("invalid terminal recovery state: %w", err)
	}
	if saved.Version != 1 || saved.Checkpoint == nil && !saved.Fallback {
		return errors.New("unsupported terminal recovery state")
	}
	if saved.Fallback {
		p.checkpoint.close()
		p.checkpoint = &terminalCheckpointEngine{err: errors.New("restored terminal uses raw history fallback"), cols: saved.Cols, rows: saved.Rows, scrollback: saved.HistoryLimit / averageHistoryBytesPerLine}
		p.checkpointFailure = saved.Failure
	} else {
		c := saved.Checkpoint
		if c.Protocol != TerminalMemoryCheckpointProtocol || c.WASMSHA256 != checkpointHash(terminalCheckpointWASM) || c.MemoryBytes == 0 || c.MemoryBytes > terminalCheckpointMaxMemory || len(saved.Memory) > terminalCheckpointMaxCompressed {
			return errors.New("terminal recovery version or WASM mismatch")
		}
		zip, err := gzip.NewReader(bytes.NewReader(saved.Memory))
		if err != nil {
			return err
		}
		memory, err := io.ReadAll(io.LimitReader(zip, int64(terminalCheckpointMaxMemory)+1))
		zip.Close()
		if err != nil || len(memory) != int(c.MemoryBytes) || checkpointHash(memory) != c.MemorySHA256 {
			return errors.New("terminal recovery memory digest mismatch")
		}
		e, err := newTerminalCheckpointEngine(c.Cols, c.Rows, c.ScrollbackLines)
		if err != nil {
			return err
		}
		fail := func(err error) error { e.close(); return err }
		current := e.module.Memory().Size()
		if uint32(len(memory)) > current {
			pages := (uint32(len(memory)) - current + 65535) / 65536
			if _, ok := e.module.Memory().Grow(pages); !ok {
				return fail(errors.New("cannot restore terminal memory"))
			}
		}
		if !e.module.Memory().Write(0, memory) {
			return fail(errors.New("cannot write terminal recovery memory"))
		}
		stack, ok := e.module.ExportedGlobal("__webshell_checkpoint_stack").(api.MutableGlobal)
		if !ok {
			return fail(errors.New("terminal recovery stack unavailable"))
		}
		stack.Set(uint64(c.Stack))
		e.handle = c.Handle
		e.capacity = c.ScrollbackBytes
		e.pending = append([]byte(nil), saved.ParserPending...)
		p.checkpoint.close()
		p.checkpoint = e
	}
	p.executionExit = saved.Exit
	p.pendingGeneratedSources = saved.GeneratedSources
	p.pendingCursorSources = saved.CursorSources
	p.rawSequence = saved.RawSequence
	p.historyGeneration = saved.HistoryGeneration
	p.history = paneHistory{chunks: saved.HistoryChunks, base: saved.HistoryBase, end: saved.HistoryEnd}
	for _, chunk := range p.history.chunks {
		p.history.bytes += len(chunk)
	}
	if p.history.base+uint64(p.history.bytes) != p.history.end {
		return errors.New("terminal recovery history mismatch")
	}
	p.historyLimitBytes = saved.HistoryLimit
	p.controlPending = saved.ControlPending
	p.localCWDPending = saved.LocalCWDPending
	p.terminalQueryPending = saved.QueryPending
	p.generatedEchoOutputPending = saved.GeneratedEchoOutputPending
	p.pendingGeneratedInputs = saved.GeneratedInputs
	p.pendingCursorReports = saved.CursorReports
	p.pendingCursorReportUntil = saved.CursorReportUntil
	for _, echo := range saved.Echoes {
		p.generatedEchoPending = append(p.generatedEchoPending, terminalGeneratedEcho{echo.Raw, echo.Quoted})
	}
	p.terminalForegroundColor = saved.Foreground
	p.terminalBackgroundColor = saved.Background
	p.terminalCursorColor = saved.Cursor
	p.cwd = saved.CWD
	p.resizeEpoch = saved.ResizeEpoch
	p.cols = saved.Cols
	p.rows = saved.Rows
	p.pixelWidth = saved.PixelWidth
	p.pixelHeight = saved.PixelHeight
	return nil
}
func (p *terminalPane) readExecutionLoop() {
	if p.executionExit != nil {
		p.markExited(p.executionExit.Err())
		return
	}
	events, ordered := p.execution.(OrderedExecutionEvents)
	if !ordered {
		buf := make([]byte, 32768)
		for {
			n, err := p.execution.Read(buf)
			if n > 0 {
				p.appendOutput(buf[:n])
			}
			if err != nil {
				break
			}
		}
		result := p.execution.Wait()
		p.markExited(result.Err())
		return
	}
	lastCommit := time.Now()
	bytesSince := 0
	for {
		event, err := events.Next(context.Background())
		if err != nil {
			p.reportExecutionFailure(err)
			return
		}
		p.mu.Lock()
		previousSequence := p.rawSequence
		p.mu.Unlock()
		if event.Sequence <= previousSequence {
			continue
		}
		if event.Sequence != previousSequence+1 {
			p.reportExecutionFailure(errors.New("terminal recovery event gap"))
			return
		}
		p.mu.Lock()
		p.rawSequence = event.Sequence
		p.generatedSequence = 0
		p.mu.Unlock()
		switch event.Kind {
		case "output":
			p.appendOutput(event.Data)
			bytesSince += len(event.Data)
		case "resize":
			p.mu.Lock()
			p.cols = event.Size.Cols
			p.rows = event.Size.Rows
			p.pixelWidth = event.Size.PixelWidth
			p.pixelHeight = event.Size.PixelHeight
			p.resizeCheckpointLocked(p.cols, p.rows, p.historyLimitBytes/averageHistoryBytesPerLine)
			p.mu.Unlock()
		case "exit":
			p.appendOutput(event.Data)
			p.mu.Lock()
			p.executionExit = &event.Exit
			p.mu.Unlock()
			checkpoint, saveErr := p.executionCheckpoint()
			if saveErr != nil {
				p.reportExecutionFailure(saveErr)
				return
			}
			if saveErr = events.Commit(event.Sequence, checkpoint); saveErr != nil {
				p.reportExecutionFailure(saveErr)
				return
			}
			p.markExited(event.Exit.Err())
			return
		}
		var checkpoint []byte
		if bytesSince >= 1<<20 || time.Since(lastCommit) >= time.Second {
			checkpoint, err = p.executionCheckpoint()
			if err != nil {
				p.reportExecutionFailure(err)
				return
			}
			bytesSince = 0
			lastCommit = time.Now()
		}
		if err = events.Commit(event.Sequence, checkpoint); err != nil {
			p.reportExecutionFailure(err)
			return
		}
	}
}
func (p *terminalPane) reportExecutionFailure(err error) {
	data, _ := json.Marshal(map[string]any{"type": "terminal-checkpoint-diagnostic", "pane_id": p.id, "error_code": "execution_recovery_failed", "message": err.Error(), "retryable": false})
	p.mu.Lock()
	defer p.mu.Unlock()
	p.executionFailure = err
	for client := range p.clients {
		client.enqueue(paneOutbound{messageType: 1, payload: data})
	}
}
