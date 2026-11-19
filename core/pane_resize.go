package core

import (
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"time"
)

func (p *terminalPane) updateTerminalThemeColors(foreground, background, cursor string) {
	foreground = normalizeTerminalHexColor(foreground, "")
	background = normalizeTerminalHexColor(background, "")
	cursor = normalizeTerminalHexColor(cursor, "")
	if foreground == "" && background == "" && cursor == "" {
		return
	}
	p.mu.Lock()
	if foreground != "" {
		p.terminalForegroundColor = foreground
	}
	if background != "" {
		p.terminalBackgroundColor = background
	}
	if cursor != "" {
		p.terminalCursorColor = cursor
	}
	p.mu.Unlock()
}

// Called with outputMu and mu held so attaches see the grid and its epoch together.
func (p *terminalPane) resizePTYLocked(cols, rows, pixelWidth, pixelHeight int) error {
	if p.closing {
		return errTerminalPaneClosing
	}
	if p.cols == cols && p.rows == rows && p.pixelWidth == pixelWidth && p.pixelHeight == pixelHeight {
		return nil
	}
	if !p.exited && p.ptyFile != nil {
		if err := p.workspace.runtime.platform.ResizePTY(p.ptyFile, cols, rows, pixelWidth, pixelHeight); err != nil {
			return err
		}
	}
	p.cols, p.rows = cols, rows
	p.pixelWidth, p.pixelHeight = pixelWidth, pixelHeight
	p.resizeCheckpointLocked(cols, rows, p.historyLimitBytes/averageHistoryBytesPerLine)
	return nil
}

func (p *terminalPane) applyResize(message TerminalControlMessage, source *paneClient) error {
	resizeStartedAt := time.Now()
	epoch, hasEpoch := parseTerminalResizeEpoch(message.ResizeEpoch)
	if !hasEpoch || message.OwnerEpoch == "" {
		p.enqueueResizeError(source, epoch, "resize_gesture_required")
		return errors.New("missing resize ownership information")
	}

	p.resizeMu.Lock()
	defer p.resizeMu.Unlock()

	p.mu.Lock()
	currentEpoch := p.resizeEpoch
	owner := p.resizeOwner
	ownerEpoch := p.resizeOwnerEpoch
	_, attached := p.clients[source]
	currentCols := p.cols
	currentRows := p.rows
	currentPixelWidth := p.pixelWidth
	currentPixelHeight := p.pixelHeight
	p.mu.Unlock()

	cols := NormalizeCols(message.Cols)
	rows := NormalizeRows(message.Rows)
	pixelWidth := normalizeTerminalPixelDimension(message.PixelWidth)
	pixelHeight := normalizeTerminalPixelDimension(message.PixelHeight)
	if pixelWidth == 0 {
		pixelWidth = currentPixelWidth
	}
	if pixelHeight == 0 {
		pixelHeight = currentPixelHeight
	}
	// A takeover names the last server epoch observed at the actual click.
	// Owner updates name the original grant, so delayed updates cannot acquire ownership.
	sameOwner := attached && owner == source
	duplicate := sameOwner && epoch == currentEpoch
	expectedBase := formatTerminalResizeEpoch(currentEpoch)
	if currentEpoch == 0 {
		expectedBase = "0"
	}
	valid := sameOwner && !message.Claim && message.OwnerEpoch == formatTerminalResizeEpoch(ownerEpoch)
	if message.Claim {
		valid = attached && ((epoch > currentEpoch && message.OwnerEpoch == expectedBase) ||
			(duplicate && epoch == ownerEpoch))
	}
	if !valid || epoch < currentEpoch {
		p.enqueueResizeError(source, epoch, "resize_owner_active")
		return errors.New("resize ownership changed")
	}
	if epoch == currentEpoch && (cols != currentCols || rows != currentRows || pixelWidth != currentPixelWidth || pixelHeight != currentPixelHeight) {
		p.enqueueResizeError(source, epoch, "resize_epoch_conflict")
		return errors.New("resize epoch conflict")
	}
	outputWaitStartedAt := time.Now()
	p.outputMu.Lock()
	outputWaitMS := float64(time.Since(outputWaitStartedAt).Microseconds()) / 1000
	p.mu.Lock()
	if err := p.resizePTYLocked(cols, rows, pixelWidth, pixelHeight); err != nil {
		p.mu.Unlock()
		p.outputMu.Unlock()
		p.enqueueResizeError(source, epoch, "pty_resize_failed")
		return err
	}
	p.resizeEpoch = epoch
	if message.Claim {
		p.resizeOwnerEpoch = epoch
		p.resizeOwner = source
	}
	clients := make([]*paneClient, 0, len(p.clients))
	for client := range p.clients {
		clients = append(clients, client)
	}
	p.mu.Unlock()
	p.enqueueResizeApplied(epoch, cols, rows, pixelWidth, pixelHeight, clients,
		map[string]any{"apply_duration_ms": float64(time.Since(resizeStartedAt).Microseconds()) / 1000, "output_lock_wait_ms": outputWaitMS})
	p.outputMu.Unlock()
	return nil
}

func (p *terminalPane) enqueueResizeOwnerReleased(epoch uint64, cols, rows, pixelWidth, pixelHeight int, clients []*paneClient) {
	payload, err := json.Marshal(map[string]any{
		"type":         "resize-owner-released",
		"selector":     p.selector,
		"pane_id":      p.id,
		"resize_epoch": formatTerminalResizeEpoch(epoch),
		"cols":         cols,
		"rows":         rows,
		"pixel_width":  pixelWidth,
		"pixel_height": pixelHeight,
	})
	if err != nil {
		return
	}
	for _, client := range clients {
		client.enqueue(paneOutbound{messageType: websocket.TextMessage, payload: payload})
	}
}

func (p *terminalPane) enqueueResizeApplied(epoch uint64, cols, rows, pixelWidth, pixelHeight int, clients []*paneClient, timing map[string]any) {
	payload, err := json.Marshal(map[string]any{
		"type":                   "resize-applied",
		"checkpoint_diagnostics": p.checkpointDiagnostics(),
		"resize_diagnostics":     timing,
		"selector":               p.selector,
		"pane_id":                p.id,
		"resize_epoch":           formatTerminalResizeEpoch(epoch),
		"cols":                   cols,
		"rows":                   rows,
		"pixel_width":            pixelWidth,
		"pixel_height":           pixelHeight,
	})
	if err != nil {
		return
	}
	for _, client := range clients {
		client.enqueue(paneOutbound{messageType: websocket.TextMessage, payload: payload})
	}
}

func (p *terminalPane) enqueueResizeError(client *paneClient, epoch uint64, reason string) {
	if client == nil {
		return
	}
	p.mu.Lock()
	currentEpoch := p.resizeEpoch
	cols := p.cols
	rows := p.rows
	pixelWidth := p.pixelWidth
	pixelHeight := p.pixelHeight
	p.mu.Unlock()
	payload, err := json.Marshal(map[string]any{
		"type":          "resize-error",
		"selector":      p.selector,
		"pane_id":       p.id,
		"resize_epoch":  formatTerminalResizeEpoch(epoch),
		"applied_epoch": formatTerminalResizeEpoch(currentEpoch),
		"cols":          cols,
		"rows":          rows,
		"pixel_width":   pixelWidth,
		"pixel_height":  pixelHeight,
		"reason":        reason,
		"retryable":     reason == "pty_resize_failed",
	})
	if err == nil {
		p.outputMu.Lock()
		client.enqueue(paneOutbound{messageType: websocket.TextMessage, payload: payload})
		p.outputMu.Unlock()
	}
}
