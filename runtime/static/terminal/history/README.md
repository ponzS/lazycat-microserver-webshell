# 终端历史模块

## 职责

本目录负责 replay identity、cursor、sequence、authorization、checkpoint 和最终提交门禁。普通容器只消费同一 Unified WebSocket 上由 persistent agent 提供的权威 `snapshot + live`；本目录不再包含 Cache API、warm replay、preview、manifest、compaction 或浏览器持久化逻辑。

`client:` target 尚未升级 Unified 协议，因此继续通过独立 IndexedDB store 保存兼容历史范围。该兼容路径必须由 `isClientTarget()` 精确隔离，普通容器不得调用其 prepare/range/reset 或写入存储。

任何 replay、snapshot、resize 或重连中间过程都不得进入可见 Canvas。

## 公开入口与契约

外部只能从 `terminal/history/index.js` 导入：

- `TerminalReplayController`、`ClientTerminalReplayAdapter`：校验 request/connection identity、cursor、sequence 和完成边界。
- `createTerminalSessionReplayController()`：拥有 replay authorization、失败暂停、connect range 查询和最终 commit transaction。
- `createClientTerminalHistoryController()`：`client:` IndexedDB 历史的唯一 controller；普通容器调用必须为无副作用 false/null。
- `createTerminalHistoryCache()`：IndexedDB store 原语，仅由 client history controller 使用。
- checkpoint API：能力与 payload 校验。

普通容器 Unified open 必须携带 `workspace_generation`，不得携带 `history_generation`、`local_base_cursor` 或 `local_end_cursor`。snapshot 必须先在 render suppression 下 reset Ghostty，只有服务端 replay-complete、cursor 连续、输出队列追平且最终 full render 成功后才提交。

## 状态所有权与生命周期

`session_replay_controller.js` 是 session replay authorization、失败次数/暂停、commit phase 和最终 presentation 请求的唯一 owner；`session_replay_lifecycle.js` 独占 checkpoint timer。

`client_history_controller.js` 独占 `client:` load/reset/write/flush/touch/delete、timer 和迟到 Promise guard。session dispose 会先 flush 客户端历史，再取消其 schedule；普通容器不会创建任何浏览器历史任务。

## 文件清单

- `index.js`：唯一公开入口。
- `terminal_replay_controller.js`：现代 replay identity/cursor/sequence 校验。
- `session_replay_state.js`：cursor、authorization、commit 和 client connect range 的纯状态查询。
- `session_replay_lifecycle.js`：checkpoint timer 和 generation/dispose guard。
- `session_replay_controller.js`：replay 失败暂停和最终提交编排。
- `client_terminal_replay.js`：`client:` 原始二进制 replay 适配。
- `client_history_controller.js`：`client:` IndexedDB 历史 controller。
- `terminal_history_cache.js`：IndexedDB store 原语。
- `terminal_checkpoint.js`：checkpoint 能力和数据校验。

## 依赖与验证

history 不建立 WebSocket、不操作 Canvas、不拥有 resize 或输入状态。相关测试为 `terminal_session_protocol_controller_test.mjs`、`terminal_session_replay_controller_test.mjs`、`terminal_replay_controller_test.mjs`、`client_terminal_history_controller_test.mjs`、`terminal_checkpoint_test.mjs` 和 `TestRuntimeTerminalHistoryModuleBoundary`。

最小回归：普通容器首次进入/刷新/断线重连只走服务端 snapshot；Unified open 无本地 range；snapshot 中间帧不可见；`client:` cache/memory range 仍连续；任一迟到 generation、cursor 不连续或 identity 不匹配都拒绝提交且不影响兄弟 stream。
