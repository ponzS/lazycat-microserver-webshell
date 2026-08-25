# Terminal Reliability Execution Plan

## Current Incident

The current runtime fails before bootstrap because `runtime/static/main.js` has a syntax error near line 23410:

```text
Uncaught SyntaxError: Unexpected token ')'
```

This prevents the module from loading and causes the terminal UI to appear black or remain uninitialized.

## Product Boundary: Configured Scrollback Is the Contract

The terminal history setting is the authoritative user-visible bound. If the user selects `N` scrollback lines, the terminal must retain no more than `N` scrollback lines, and history persistence/replay must target the same configured window rather than an unrelated fixed history size. References to extremely large histories are performance stress examples, not a requirement to load or store an arbitrary number of lines.

The implementation must therefore prioritize:

- applying the configured scrollback value consistently to Ghostty, replay, and Cache v2;
- preventing cache/replay byte budgets from silently expanding beyond the configured line window;
- treating byte budgets as a secondary safety limit, not as a replacement for the line setting;
- preserving the configured history window across reload, reconnect, resize, and tab/pane restoration;
- using full-history replay fallback when semantic checkpoint support is unavailable.

A semantic checkpoint/window protocol is only required if it improves startup for the configured history limit or avoids excessive work at high configured limits. It is not required to support an unbounded or arbitrary million-line history.


### Phase 0: Restore Startup

- [x] Repair the malformed `instancesPromise` bootstrap promise chain.
- [x] Run `node --check runtime/static/main.js`.
- [x] Run the focused runtime source-contract tests.
- [x] Run `go test ./... -count=1` and `git diff --check`.
- [ ] Verify the page module reaches bootstrap and the terminal is no longer black in a browser/host environment.

### Phase 1: Stabilize Replay Failure Handling

- [x] Preserve the last valid presentation frame when a replay reset or reconnect occurs.
- [x] Add replay progress checkpoints that are presentation-only and identity-bound.
- [x] Ensure partial replay checkpoints never mark replay committed, history ready, input ready, or cache manifest complete.
- [x] Add a bounded replay retry policy so repeated replay failure cannot loop forever.
- [ ] Verify Fast, Queue modern, Queue legacy, and old-agent fallback behavior.

### Phase 2: Make Large Replay Backpressured End to End

- [x] Keep server-side Queue high-water backpressure.
- [x] Add client consumption acknowledgements for Queue turns where protocol negotiation permits it.
- [x] Bound browser output queue and Ghostty write batches by both bytes and elapsed time.
- [x] Ensure cache failure is an optimization failure and does not clear a usable presentation or force an endless reconnect loop.
- [x] Add high-output and replay-interruption tests.

### Phase 3: Windowed/Checkpoint Replay

- [x] Define a negotiated checkpoint-window replay capability.
- [x] Define and validate a semantic terminal checkpoint schema, including VT modes, screen state, geometry, identity, and a bounded contiguous tail window.
- [ ] Add a semantic terminal checkpoint producer/consumer to Ghostty, not only a raw byte offset.
- [ ] Start with the latest checkpoint plus a bounded tail window.
- [x] Keep full-history replay as an explicit legacy fallback when semantic checkpoint capability is absent.
- [x] Keep input locked until the requested terminal state is fully committed.
- [ ] Explore paged scrollback loading only after Ghostty supports safe history-range materialization.

### Phase 4: Host and Device Validation

- [ ] Validate cold startup and reload in Lazycat host.
- [ ] Verify configured scrollback is the single history-window contract for Ghostty, replay, and Cache v2; the cache byte limit must remain a secondary guard and must not silently define a different effective line window.
- [ ] Validate desktop browser, mobile WebView, and high-output PTY behavior.
- [ ] Record diagnostics for replay progress, checkpoint cursor, queue pressure, retry count, and presentation commit.

## Invariants

- A syntax error must never reach a deployable runtime asset.
- A partial replay frame is visual fallback only; it is never terminal readiness or cache truth.
- Identity, connection epoch, replay generation, cursor, sequence, and checksum guards remain strict.
- Cache v2 is an optimization layer; cache failure must not make the terminal unusable.
- Old Fast/Queue/legacy protocols remain supported through explicit fallback paths.
- Never reset or discard unrelated user changes in the working tree.
