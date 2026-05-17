package main

import "testing"

func TestCachedAgentRuntimeArchiveReusesSuccessfulBuild(t *testing.T) {
	agentRuntimeArchiveCache.Lock()
	previousReady := agentRuntimeArchiveCache.ready
	previousPayload := agentRuntimeArchiveCache.payload
	previousManifest := agentRuntimeArchiveCache.manifest
	agentRuntimeArchiveCache.ready = false
	agentRuntimeArchiveCache.payload = nil
	agentRuntimeArchiveCache.manifest = ""
	agentRuntimeArchiveCache.Unlock()
	t.Cleanup(func() {
		agentRuntimeArchiveCache.Lock()
		agentRuntimeArchiveCache.ready = previousReady
		agentRuntimeArchiveCache.payload = previousPayload
		agentRuntimeArchiveCache.manifest = previousManifest
		agentRuntimeArchiveCache.Unlock()
	})

	firstPayload, firstManifest, err := cachedAgentRuntimeArchive()
	if err != nil {
		t.Fatalf("first cachedAgentRuntimeArchive() returned error: %v", err)
	}
	secondPayload, secondManifest, err := cachedAgentRuntimeArchive()
	if err != nil {
		t.Fatalf("second cachedAgentRuntimeArchive() returned error: %v", err)
	}

	if firstManifest == "" {
		t.Fatal("expected non-empty manifest")
	}
	if firstManifest != secondManifest {
		t.Fatalf("expected cached manifest %q, got %q", firstManifest, secondManifest)
	}
	if len(firstPayload) == 0 {
		t.Fatal("expected non-empty payload")
	}
	if len(firstPayload) != len(secondPayload) || &firstPayload[0] != &secondPayload[0] {
		t.Fatal("expected second call to reuse cached payload")
	}
}
