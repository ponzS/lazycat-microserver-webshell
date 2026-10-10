# Remote native execution

Versioned process, PTY, filesystem, networking and host-signing adapter for a native execution target. It imports Core interfaces and uses a single authenticated WebSocket; it never launches local target commands or falls back to the server filesystem.

The caller supplies trusted device discovery and short-lived grants. TLS verification is mandatory. Raw output is journaled in private storage before acknowledgement. Target sessions are addressed by immutable execution scope and logical creation identity.

Protocol v2 carries raw PTY bytes. This adapter reuses `localtools` for output encoding and saves incomplete characters with the parser checkpoint; command and file streams remain binary. Target nano runs directly without a shim or file conversion.

Protocol v3 queries target shell metadata and uses the shared Core launch policy. Only prepared arguments and allowed environment overrides cross the wire; target PATH, user rc files and profile loading remain native. Recovery reuses the committed launch intent.

Verify with real executors, detached transports, server restarts, native file/network operations and original SSH host fingerprints. Compilation is separate from real-device acceptance.

File transfers reuse the target file service over transient execution streams. Target system adapters are compiled into the host executable.
