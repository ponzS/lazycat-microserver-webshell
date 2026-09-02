package main

import (
	"bytes"
	"testing"
	"time"
)

func TestServerLogHubKeepsOrderedReplayAndLiveEvents(t *testing.T) {
	hub := newServerLogHub(&bytes.Buffer{})
	hub.publish("test", "first")
	hub.publish("test", "second failed")

	history, events, unsubscribe := hub.subscribe(1, 0)
	defer unsubscribe()
	if len(history) != 1 || history[0].Sequence != 2 || history[0].Level != "error" {
		t.Fatalf("history = %#v, want sequence 2 error event", history)
	}

	hub.publish("test", "third")
	select {
	case event := <-events:
		if event.Sequence != 3 || event.Message != "third" {
			t.Fatalf("live event = %#v, want sequence 3", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live server log event")
	}
}

func TestServerLogHubRedactsSensitiveKeyValues(t *testing.T) {
	hub := newServerLogHub(&bytes.Buffer{})
	hub.publish("test", "request token=secret authorization=Bearer-secret password=hunter2")
	history, _, unsubscribe := hub.subscribe(0, 0)
	defer unsubscribe()
	if len(history) != 1 {
		t.Fatalf("history length = %d, want 1", len(history))
	}
	if history[0].Message != "request token=[redacted] authorization=[redacted] password=[redacted]" {
		t.Fatalf("message = %q, sensitive values were not redacted", history[0].Message)
	}
}
