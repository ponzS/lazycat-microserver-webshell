package core

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"strings"
)

func handleTerminalControlMessage(pane *terminalPane, payload []byte, client *paneClient) bool {
	var message TerminalControlMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		if data, ok := strings.CutPrefix(string(payload), "input:"); ok {
			_ = pane.writeInput([]byte(data))
			return true
		}
		return true
	}
	switch message.Type {
	case "input":
		pane.updateTerminalThemeColors(message.Foreground, message.Background, message.Cursor)
		if message.Data != "" {
			if message.Generated {
				_ = pane.writeGeneratedInput([]byte(message.Data))
			} else {
				_ = pane.writeInput([]byte(message.Data))
			}
		}
	case "resize":
		if message.Cols > 0 && message.Rows > 0 {
			_ = pane.applyResize(message, client)
		}
	case "theme":
		pane.updateTerminalThemeColors(message.Foreground, message.Background, message.Cursor)
	case "input_lock":
		// Compatibility no-op for older direct clients during rolling upgrades.
	case "ping":
		data, err := json.Marshal(map[string]any{"type": "pong"})
		if err == nil {
			client.enqueue(paneOutbound{messageType: websocket.TextMessage, payload: data})
		}
	case "detach":
		return false
	}
	return true
}
