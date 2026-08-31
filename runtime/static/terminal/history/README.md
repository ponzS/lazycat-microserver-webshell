# 终端历史模块

## 职责

本目录负责终端历史身份、cursor、sequence、checkpoint、浏览器缓存、恢复指标和 replay 提交原语。容器实例使用 Cache API v2，`client:` 目标继续使用隔离的兼容历史缓存。

本模块不负责 WebSocket 物理连接、Unified membership、Canvas presentation、resize 所有权、工作区 tab/pane 编排或用户输入。

任何 history replay、snapshot、缓存恢复、resize 或重连中间过程都不得进入可见 Canvas。PTY 原始字节仍是权威；preview 只允许作为完整身份校验后的总览或 last-known-good 画面，不能作为终端状态恢复来源。

## 公开入口与契约

外部只能从 `terminal/history/index.js` 导入。

- `createTerminalCacheController()`：持有当前 workspace cache identity/epoch，判断 session 使用 Cache API v2 或 `client:` 兼容缓存，生成不可变 session identity，维护恢复指标，并编排持久化、preview 与 cache replay transaction。
- `createTerminalCacheV2()`：提供 manifest、chunk、preview、compaction、LRU 和清理等底层存储原语。
- `createTerminalHistoryCache()`：提供 `client:` 历史缓存原语。
- `TerminalReplayController` 与 `ClientTerminalReplayAdapter`：校验 replay generation、cursor、sequence 和完成边界。
- `createTerminalSessionReplayController()`：统一 session replay authorization、connect range、失败暂停、checkpoint timer 和最终 commit transaction。
- `terminalCachePreviewFingerprint()`：按稳定字段顺序序列化主题与终端外观快照，供 Cache API preview metadata 比对；不读取浏览器状态。
- checkpoint API：只负责能力与数据校验。

调用方必须提供完整账号 scope、selector、workspace generation、tab、pane 和 history generation。缺少任一身份、cursor 不连续、epoch 过期或 session 已关闭时，缓存结果不得继续应用。

## 状态所有权

`cache_controller.js` 是 workspace cache identity、epoch、协议可用性、session 恢复指标和 orphan preview cleanup 的唯一 owner。调用方只能读取副本或调用公开命令，不能直接修改 controller 内部状态。

`cache_persistence_controller.js` 是 session manifest load/reset、immutable chunk 写入队列、persisted cursor、preview capture、compaction 和 touch/delete 的唯一 owner。`terminal_cache_v2.js` 和 `terminal_history_cache.js` 只拥有各自存储引擎内部状态，不承担应用或 workspace 编排。replay controller 只拥有其协议状态，不建立或关闭 WebSocket。

`cache_recovery_controller.js` 独占 WebSocket replay identity 到 cache identity 的映射、preview prepare/decode、授权、显示和 miss 指标。`cache_replay_controller.js` 独占 warm replay、网络实时字节排队、server snapshot 原子替换及迟到 generation/socket 拒绝；它只能通过注入命令请求 output、presentation、history reset 和 transport 恢复，不建立或关闭 WebSocket，也不直接操作 Canvas。

`session_replay_controller.js` 是 session replay authorization、失败次数/暂停、history commit phase 和完成后状态切换的唯一 owner。`session_replay_lifecycle.js` 独占 replay presentation checkpoint timer；checkpoint 只记录“尚未提交”的诊断事件，绝不能提交 Canvas 或把第一批字节视为首帧。

## 生命周期

`cache_lifecycle.js` 独占 orphan preview cleanup 的 `requestIdleCallback`/timeout；`cache_session_lifecycle.js` 独占每个 session 的 write RAF/timer、preview capture timer/idle callback 和 compaction idle/timeout。workspace identity 变化会取消旧 workspace 任务并推进 epoch；session dispose 与 controller dispose 会取消对应资源并拒绝迟到回调。

session 生命周期负责 flush/取消该 session 的历史写入、preview 和 replay 资源。缓存失败只能降级为服务端权威 replay，不能阻塞兄弟 pane、关闭 Unified 物理连接或展示中间帧。

## 文件清单

- `index.js`：唯一公开入口。
- `cache_controller.js`：workspace cache identity/epoch、协议路由、恢复指标和 orphan preview 编排。
- `cache_async.js`：带取消 timer 的超时与进度超时原语。
- `cache_identity.js`：无状态的 workspace/session identity 规范化、稳定 key 和 preview fingerprint 序列化。
- `cache_lifecycle.js`：idle callback、timeout、取消和 dispose。
- `cache_persistence_controller.js`：session manifest、写入队列、reset/delete/touch、preview capture 和 compaction 编排。
- `cache_preview_view.js`：prepared/shown preview URL、图片 decode 和 Canvas Blob 浏览器适配。
- `cache_recovery_controller.js`：replay/cache 身份校验、preview prepare/reveal 授权和迟到异步拒绝。
- `cache_replay_controller.js`：warm cache replay、实时队列追平、server snapshot 原子 reset/replay 与单 pane 失败隔离。
- `cache_session_lifecycle.js`：session write、preview capture、compaction 的 RAF/timer/idle 生命周期。
- `terminal_cache_v2.js`：容器 Cache API v2 manifest、chunk、preview、compaction 与清理原语。
- `terminal_history_cache.js`：`client:` 兼容历史缓存。
- `terminal_replay_controller.js`：现代历史 replay identity、cursor、sequence 和完成校验。
- `session_replay_state.js`：cursor 解析、connect range、authorization 与 commit phase 的纯状态查询。
- `session_replay_lifecycle.js`：replay checkpoint timer、generation/epoch 拒绝和清理。
- `session_replay_controller.js`：session replay 失败暂停、cache commit 和最终 presentation 请求编排。
- `client_terminal_replay.js`：`client:` 原始二进制 replay 适配。
- `terminal_checkpoint.js`：checkpoint 能力与数据校验。

## 依赖与验证

history 可以依赖纯缓存/协议原语和浏览器 Cache API；不能反向依赖 transport、workspace、rendering、resize 或 input controller。跨模块协作只能通过注入的只读 getter 和显式命令。

相关 guard：`terminal_cache_controller_test.mjs`、`terminal_cache_persistence_controller_test.mjs`、`terminal_cache_recovery_controller_test.mjs`、`terminal_cache_replay_controller_test.mjs`、`terminal_session_replay_controller_test.mjs`、`terminal_cache_v2_test.mjs`、`terminal_replay_controller_test.mjs`、`terminal_checkpoint_test.mjs`、`TestRuntimeTerminalHistoryCacheModuleBoundary` 以及 workspace/history 协议测试。

最小回归步骤：

1. 冷启动和 cache-v2 命中均能完成最终终端呈现，replay 期间不出现中间帧。
2. workspace identity 或 history generation 变化后，旧 manifest、preview、timer 和 Promise 不能应用。
3. 断网重连保持 last-known-good frame，恢复后 cursor 连续且只在最终 full render 后替换。
4. 普通容器页面始终只有一条 Unified 物理 WebSocket，单 pane 缓存错误不影响兄弟 stream。
5. `client:` 目标继续只使用兼容历史缓存，不启用 Cache API v2。
