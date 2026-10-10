# Native execution protocol 2

The device exposes `GET /s/cloud.lazycat.pty.v1/stream`, upgraded to one multiplexed WebSocket. Control, information and stream operations share that connection. JSON envelopes use `request_id`, `op`, `execution_epoch` and `controller_generation`; responses carry the same request ID. Bytes are base64 JSON byte strings. Individual messages are bounded to 512 KiB.

Admission requires a valid device JWT in `lzc_dapi_auth_token` and a separate `X-PTY-Grant`. The grant is raw-base64url JSON plus a dot and raw-base64url HMAC-SHA256, using the decoded 32-byte hex scope secret. It binds scope (`box_id`, `account_id`, `device_id`, `execution_epoch`), purpose `execution`, method `GET`, canonical path `/stream`, controller generation and Unix deadline (at most 120 seconds ahead). Neither grant expiry nor transport heartbeats impose a fixed lifetime on an authenticated SSH session.

`claim` establishes one controller/transport owner. Persistent decimal generations advance on service replacement and remain stable across network reconnects. Old connections and generations cannot mutate sessions. `probe` is reserved for authenticated host IPC; local management and native IPC credentials are not exposed by remote information responses.

Process operations include `open_pty`, `open_command`, `open_http`, `resolve`/`query`/`list`, `read`, `input`, `generated_input`, `resize`, `signal`, `close_stdin`, `terminate` and `close_intent`. Creation is bound to an immutable logical key and launch digest. Mapped sessions are queried; a missing mapped session is an error. Input uses byte offsets and acknowledges only written bytes. Generated replies use stable event/query identities.

Each session's ordered events are output, stderr, resize and exit. `event_sequence` is the raw event cursor; it is distinct from Core's filtered byte history cursor. `ack` releases only durably handled events; its optional `checkpoint_sequence` permits deduplication compaction only after a committed parser/replay checkpoint and cannot exceed the acknowledged event cursor. Process `wait` reports real process exit separately from draining inherited output handles.

Protocol v2 sends PTY output without native encoding conversion. The server journals original bytes, decodes before terminal parsing, and checkpoints the incomplete character tail alongside parser state. Replay decodes raw events from that saved tail. Exit flushes remaining bytes before the terminal is marked exited. Command, HTTP and file bytes are unchanged. Clients and servers must use matching execution protocol versions.

Interactive PTYs survive transport loss. `connection_bound` PTYs and commands, files, sockets, listeners and temporary forwarding credentials are reclaimed with their transport. They are not replayed after reconnection. Interactive output retains at most 4 MiB unacknowledged data per session, then backpressures the producer. Browser history retains the existing rows × 350 budget.

File operations use opaque handles, paginated metadata and read/write offsets. Portable flags are Read=1, Write=2, Create=4, Truncate=8, Exclusive=16, Append=32, Sync=64; host syscall flag values never cross the protocol. Paths and metadata belong to the target system. Network operations provide target-side dial/listen/accept, half-close and deadlines. Metrics and activity are on demand. Host-key operations return only the public key or an Ed25519 signature over a bounded SSH exchange hash; existing identity is never silently replaced.

Errors use bounded messages plus symbolic codes where needed, including `not_found`, `exists`, `permission`, `timeout`, `execution_disabled`, `retry_later` and `cleanup_unconfirmed`. No token or private key is included.

`open_http` is a transient byte stream to the existing target file HTTP service. It carries a standard HTTP request and response, with streaming bodies and normal WebDAV semantics. It shares the controller ownership and cancellation of commands. Native file-handle operations retain the additional semantics needed by SFTP.
