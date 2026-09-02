# WebShell 终端初始化、Replay 与黑屏问题总结和执行清单

状态：诊断基线已建立；P0/P1 中部分机制已经存在，等待按代码审计后的剩余缺口实施
最后更新：2026-09-02
适用范围：`lazycat-microserver-webshell` 普通容器 WebShell，包含 PC 和移动端

本文是当前终端首次加载变慢、持续输出放大、跨设备/分辨率切换后黑屏问题的审计基线。后续 Agent 应从对应 `tests-auto` 场景的用户可见现象、自动化断言、截图/trace/JSONL 产物和真实运行日志出发，结合本文记录的事实证据定位问题，再阅读相关模块 README 和源码。本文不是替代场景文档的全局执行计划，也不要求恢复或阅读已经删除的旧计划文档。

相关架构与事实入口：

- [`docs/ARCHITECTURE_AND_MODULE_MAP.md`](./docs/ARCHITECTURE_AND_MODULE_MAP.md)：当前后端/前端数据流、状态 owner、模块职责和文档路径导航。
- [`tests-auto/README.md`](./tests-auto/README.md)：真实 Provider、persistent agent、PTY、WebSocket、浏览器/设备运行方式。
- `tests-auto/<编号>-<场景名>/README.md`：具体场景的触发条件、基线、根因、方案、验证结果和已知限制。
- 对应场景目录的 `artifacts/`：失败截图、trace、JSONL 事件和错误摘要。
- 本文第 2 节及后续更新的真实日志证据：只作为已确认事实基线，不能替代目标场景的最新回归数据。

## 1. 已确认的架构边界

```text
浏览器
  -> 页面级 Unified physical WebSocket
  -> 每个 pane 一个 logical stream
  -> persistent agent / PTY / history
```

- persistent agent、PTY、history 和绝对 byte cursor 是权威来源。
- 页面级 Unified WebSocket 保留，不切换到 xterm.js。
- Ghostty WASM 保留，前端只维护解析和呈现副本。
- replay、resize、recovery 和 presentation 必须绑定当前的 `connectionEpoch`、`channelGeneration`、`historyGeneration`。
- 旧回调、旧 ACK、旧 timer 不得覆盖当前 pane 状态。
- 当前不采用 quick-resume tail。
- 当前不采用服务端 screen checkpoint。
- 当前不引入 target 级长连接 broker。
- 历史容量由终端设置控制，历史字节数本身不是当前首要优化对象。

## 2. 日志证据摘要

### 2.1 页面初始化和连接

已有日志和本次 Mac 日志均显示基础启动较快：

- 页面模块启动到 workspace/bootstrap 完成约 `0.43~0.72s`；本次 Mac 为 `0.68s`。
- Ghostty WASM 通常在 `0.05~0.46s` 内就绪；本次 Mac 为 `47ms`。
- WebSocket open 通常在页面启动后约 `0.61~1.06s`；本次 Mac 在 `+943~955ms`，socket open latency 约 `250~256ms`。
- 本次 Mac 的 agent ensure 为 `0~6ms`，已有一次 persistent agent ping 为 `333ms`。

结论：目前没有证据证明页面初始化、Ghostty WASM、WebSocket upgrade 或 agent readiness 是接近 10 秒延迟的主因。agent ping 仍需作为端到端时间线的一段单独记录，但不能把一次 `333ms` ping 解释为 4~6 秒的主要来源。

### 2.2 PC 日志：较小历史和 350KB 历史

第一份 PC 日志包含三个 pane：

| pane | 历史字节 | chunks/frames | replay 时间 | 备注 |
| --- | ---: | ---: | ---: | --- |
| pane-2 | 25,432 | 40 | 约 1.52s | 首个活动 pane 较早显示 |
| pane-4 | 88,895 | 88 | 约 1.60s | 后续 presentation 受 hidden/measure 影响 |
| pane-1 | 109,792 | 102 | 约 2.93s | replay 期间有 live output |

第二份 PC 日志中两个 pane 都是 `350,000 bytes`：

| pane | chunks/frames | replay 时间 | output 计数 | 结果 |
| --- | ---: | ---: | ---: | --- |
| pane-1 | 961 | 3.407s | `output_queued x1114`、`flush x142` | 最终稳定提交约 7.3s |
| pane-2 | 81 | 1.646s | `output_queued x81`、`flush x11` | 数据较早处理完，但 presentation 仍可能被隐藏状态挡住 |

两者历史字节相同，但 frame 数相差约 12 倍，replay 时间相差约 2 倍。这里的 `serverReplayDurationMs` 只表示 agent replay 写入其 attach 连接的耗时，不能代表 Provider queue、WebSocket 发送或浏览器 output drain 的端到端耗时。

### 2.3 移动端日志：350KB 历史

移动端两个 pane 同样都是 `350,000 bytes`：

| pane | chunks/frames | replay 时间 | output 计数 | 结果 |
| --- | ---: | ---: | ---: | --- |
| pane-1 | 1,641 | 3.562s | `output_queued x1779`、`flush x223` | presentation 最终约 6.9s 才稳定提交 |
| pane-2 | 88 | 179ms | `output_queued x88`、`flush x12` | queue 很早 drain，但到约 6.7s 仍 `presentedCursor=0` |

移动端 pane-1 的 cursor 在 replay 后又增加约 `49,881 bytes`，说明 replay 期间或紧接着存在持续 live output。

### 2.4 新增 Mac 日志：三 pane 的对照证据

本次 Mac 日志中三个 pane 都是 `350,000 bytes`，并且 `serverHistoryChunks` 与 `serverReplayFrames` 一致：

| pane | history chunks/frames | 客户端 replayDuration | serverReplayDuration | completion 时 output queue |
| --- | ---: | ---: | ---: | ---: |
| pane-2 | 488 | 1,394ms | 42ms | 41,207 bytes |
| pane-3 | 1,313 | 3,691ms | 116ms | 20,487 bytes |
| pane-1 | 1,617 | 4,481ms | 135ms | 4,651 bytes |

本次日志进一步支持 frame 碎片化与客户端 replay 时间相关：350KB 历史从 488 个 frame 增加到 1,617 个 frame 时，客户端 replay 时间从约 1.4s 增加到约 4.5s。它也确认 `history_replay_complete` 到达时浏览器 output queue 仍未完全 drain。

pane-1 是活动 tab 的 pane，首次 Canvas 显示约为 `startupElapsed=5.55s`；之后 focus/resize 在约 `7.50s` 再次进入 `presentation_wait_resize`，最终约 `8.29s` 完成一次 full render。pane-2 和 pane-3 当时属于非活动 tab，`presentedCursor=0` 且 `presentation_deferred ... hidden` 只能证明隐藏 pane 被延迟，不能单凭这份日志证明它们已经永久黑屏；必须在切换到 tab-2 后验证最终 presentation commit。

`xN` 日志必须按 `server_log_seq` 或事件 identity 去重。`x3` 的同一服务端日志表示 Unified fan-out 可能被三个 logical stream 观察到，不等于服务端执行了三次。

### 2.5 最关键的 cursor 证据

`history_replay_complete` 发生时，数据经常仍未处理完：

```text
receivedCursor > appliedCursor > presentedCursor
```

典型例子：

```text
pane-1:
receivedCursor=464752
appliedCursor=451594
presentedCursor=0
outputQueueBytes=13158
```

```text
pane-2:
receivedCursor=447429
appliedCursor=207761
presentedCursor=0
outputQueueBytes=239668
```

移动端 pane-2 后续已经满足：

```text
receivedCursor == appliedCursor
remainingBytes=0
remainingEntries=0
drained=true
```

但仍然：

```text
presentedCursor=0
presentation_deferred reason=...hidden:hidden
```

这证明 replay 数据处理和最终画面提交是两个独立问题。

### 2.6 新增移动端日志：replay 已 drain 但初始 presentation 未提交

2026-09-02 18:20 的移动端日志将问题从“可能的 replay 缺失”进一步收敛为 presentation 唤醒/收敛问题：

- pane-1：`history_replay_complete` 在 `+1,402ms`，`replay_output_drained` 在 `+1,414ms`，`resize_applied` 在 `+1,509ms`；之后没有初始 `presentation_commit_complete`，直到约 `+6,328ms` 才出现提交。
- pane-2：`history_replay_complete` 在 `+1,177ms`，`replay_output_drained` 在 `+1,221ms`，`presentation_wait_resize` 在 `+1,231ms`，`resize_applied` 在 `+1,252ms`；直到约 `+6,397ms` 才出现提交。
- pane-3：`replay_output_drained` 在 `+1,077ms`，之后持续 `presentation_deferred`/`presentation_retry_scheduled`，原因为 `presentation_wait_measure:hidden`；该 pane 未激活，不能据此判定永久黑屏。
- 三个 pane 的 `350,000 bytes` 都是 `serverReplayFrames=1`，并且 `receivedCursor == appliedCursor`、output queue 排空，排除本次历史字节未收到或未应用。
- pane-1/pane-2 在约 `+6.3s` 出现 `focus` 触发的 resume、resize/presentation 事件以及 `full_render_* x36~x40`；这与用户调整字体或主动聚焦后历史内容显示的现象一致，说明用户操作可能只是重新唤醒了 pending presentation。
- “真实终端 Canvas 已显示”仍早于真实 `presentation_commit_complete` 数秒，不能作为稳定帧指标。

当前问题记录：**初始 replay 已完成且 output 已 drain，但有效 geometry 已 `resize_applied` 后，presentation 没有被及时、唯一地唤醒并提交；focus、字体变化或后续 resize 可以强制触发 full render，从而显示此前已存在的历史状态。** 后续统一在 P0-4/P1-3 处理，暂不把它归因于 replay batching 或服务端历史丢失。

### 2.7 新增异常：健康终端永久显示灰色呼吸点

当前观察到右上角灰点持续处于呼吸显示状态。该指示器的期望语义是：

- 首次打开终端、加载 Ghostty、等待 replay 或等待首次稳定 presentation commit 时显示。
- 首次有效 `presentation_commit_complete` 后隐藏，并保持隐藏在正常输出和 queue turn 期间。
- 明确进入 reconnect、recovery 或 presentation retry 异常状态时重新显示；恢复提交成功后隐藏。
- socket 已 open、replay output 已 drain、普通 resize 或正常 live output 不能单独让灰点长期保持显示。
- `data-connection="open"` 与 `data-render-ready="false"` 必须能够区分“仍在首次呈现/异常重试”和“健康终端已稳定提交”的状态，不能让健康 pane 永久显示灰点。

后续处理归入 P0-4，验收需要同时记录状态字段、`presentation_commit_complete`、重试终态和灰点 DOM/CSS 状态；不能只用 WebSocket open 或 Canvas 元素存在作为隐藏条件。

### 2.8 新增异常：字号/窗口变化期间终端画面模糊

当前观察到调整字体大小或窗口大小时，终端内容会暂时明显模糊。代码审计暂未发现 resize 事件主动把全局 DPR 降低：Ghostty renderer 使用 `options.devicePixelRatio ?? window.devicePixelRatio`，live Canvas 的 backing width/height 按该 DPR 设置，`renderer.resize()` 也按同一 DPR 重建物理画布。

更直接的高置信度线索在 presentation hold：

- 字体变化和 resize 会先执行 `presentation.beginHold()`，并在新几何/full render 完成前显示旧帧 hold canvas。
- `presentation_view.js` 的 `holdFrame()` 将 hold canvas 的 `width`/`height` 设置为 CSS 宽高，而不是 CSS 宽高乘以 renderer DPR；虽然读取了 `ratio`，但没有用于 hold backing store 的尺寸。
- `runtime/static/style.css` 对 `.terminal-frame-hold` 设置 `image-rendering: auto`，低分辨率 backing canvas 会被浏览器平滑放大到高 DPR 显示尺寸，形成模糊旧帧。
- 因此当前更像是“hold frame 的有效 DPR 为 1 + presentation/resize 等待过长”，而不是主动降低 live renderer 的 DPR。正常 presentation commit 后应恢复 live 高 DPR canvas；如果 commit 被延迟，模糊会持续更久。

后续需要在真实高 DPR 设备上同时记录 `window.devicePixelRatio`、`term.renderer.devicePixelRatio`、live canvas 的 CSS/backing 尺寸、hold canvas 的 CSS/backing 尺寸，以及 hold 显示到 release 的持续时间，确认该假设并与浏览器缩放、宿主合成和字体本身的抗锯齿效果区分。该问题与 P0-4/P1-3 的 presentation hold、resize 收敛一起处理。

## 3. 当前已经确认的根因

### A. Replay frame 碎片化造成前端调度放大（高置信度）

同样数量级的历史字节，chunk/frame 数可以从几十增长到上千。每个 binary frame 都可能触发：

- WebSocket message 回调；
- output queue 入队；
- queue turn；
- flush 调度；
- Ghostty 写入/解析；
- ACK 或 presentation 检查。

连续输出会让历史 replay 和 live output 进一步交错，放大这些任务的总数。

### B. Unified 多 pane 之间存在潜在调度竞争（待验证）

PC、移动端和本次 Mac 日志都显示不同 pane 的 frame 数和 replay 时间差异，但这只能证明 frame 规模不同，不能单独证明一个 logical stream 阻塞了另一个 stream。当前 Go broker 已经有按 stream 的 priority/order、`512KiB`/`8ms` round budget 和 turn ACK。

因此当前可确认的是 frame 碎片化；stream 竞争仍是需要通过多 pane 压测和等待时间指标验证的假设。后续不能只根据 frame 数差异宣称存在公平性缺陷。

### C. Replay receive complete 早于 output drain（高置信度；代码已有部分修正）

`history_replay_complete` 是 agent/transport 的接收完成通知，不等于浏览器 output queue 已 drain，也不等于 presentation 已 commit。当前代码已通过 `replayCompletionPending`、`finishIfReady()`、`receivedHistoryCursor`/`appliedHistoryCursor` 和 output flush 做了部分隔离。剩余工作是审计所有 legacy、Unified、resize 和恢复路径，并让诊断名称明确区分 receive、drain 和 presentation commit。

### D. Presentation 被 hidden/measure 门控卡住（高置信度；永久黑屏仍需激活场景确认）

至少一个 pane 在 queue 已排空、cursor 已追平后，仍然持续：

```text
presentation_retry_scheduled delay=250
presentation_deferred reason=...hidden:hidden
```

这与跨 tab、移动端页面可见性、分辨率切换和折叠屏恢复后的永久黑屏高度相关。

### E. Full render 被重复触发（高置信度；当前代码存在直接触发路径）

日志出现：

```text
full_render_request x64~x73
full_render_start x64~x73
full_render_complete x64~x73
presentation_ensure x64~x73
```

这些请求通常和 `queue_turn_complete`、`history_validation` 或 resume generation 相关，说明 queue turn、resume 和 presentation 之间仍然存在重复触发。

### F. 移动端 focus/resize 会在已有稳定画面后重新进入等待（高置信度）

移动端在 pane-1 已经达到：

```text
receivedCursor == appliedCursor == presentedCursor
```

之后仍出现：

```text
resume_signal source=focus
resize_request
render_blocked reason=resize
presentation_watchdog_probe
presentation_wait_resize
```

这条路径必须保留 last-known-good frame，不能在 resize 等待期间清空 Canvas。

## 4. 已排除或暂不优先的方向

以下方向目前没有日志证据支持作为第一批优化：

- Ghostty WASM 初始化慢：启动阶段约几十到几百毫秒。
- WebSocket 建连慢：open 延迟约 `100~230ms`。
- agent readiness 不是首要延迟方向：本次 Mac ensure 为 `0~6ms`，但 ping 出现 `333ms`，因此只能排除“当前证据中的主要瓶颈”，不能排除所有环境下的 attach/Provider 延迟。
- agent replay 写入阶段较短：本次为 `42~135ms`，但该指标不覆盖 `lightosctl`、Provider queue、WebSocket 发送和浏览器 drain，不能据此排除端到端服务路径。
- 单纯减少历史字节：本次核心差异来自 frame/chunk 数，且历史容量由设置控制。
- quick-resume tail：明确不采用。
- screen checkpoint：明确不采用。
- target 级长连接 broker：在证明 `lightosctl exec` 是主瓶颈前不采用。

## 5. 执行清单

状态标记：`[ ]` 待执行，`[~]` 已有部分机制但仍有剩余缺口，`[x]` 已验证完成。

### P0-0：补齐端到端时间线和诊断语义

状态：`[~]`（receive/drain 语义已补充；Provider/queue/WebSocket 分段指标仍待补齐）

本项必须在继续用日志排除 Provider/queue/attach 瓶颈前完成，或至少与首轮真实回归并行完成。

要求：

- 明确区分 `canvas_element_visible`、`terminal_frame_committed` 和 `stable_presentation_complete`。
- `history_replay_complete` 事件已补充 `replayPhase="receive_complete"`、`stableReady=false` 和 `presentationCommitted=false`；`replay_output_drained` 事件已在 output queue 追平并通过 cursor 边界后记录。
- `agent_replay_write_duration_ms` 只描述 agent 向 attach 连接写 replay 的局部耗时；在 Provider queue、WebSocket 和浏览器分段指标补齐前，不得用它排除服务端端到端路径。
- `provider_queue_wait_ms`、`websocket_send_duration_ms`、`client_first_replay_frame_ms`、`client_last_replay_frame_ms` 用于定位 Provider/queue/WebSocket 端到端分段耗时。
- `client_output_drain_duration_ms`、`presentation_commit_duration_ms` 用于定位浏览器 drain 和最终呈现耗时。
- hidden 原因拆分为结构化字段。
- `history_replay_complete` 改名或补充 receive/drain 语义。
- `xN` 聚合计数必须说明是诊断层去重，不直接等于服务端执行次数。
- 服务端日志以 `server_log_seq` 去重；Unified fan-out 不应被误判为多个服务端请求。
- 保留 `connectionEpoch`、`channelGeneration`、`historyGeneration`、`resizeEpoch` 和 cursor 字段。

### P0-1：Replay frame batching

状态：`[~]`（本地 server batching 和 Go 回归已完成；真实 Provider 部署回归待执行）

目标：在不改变权威 cursor 和 replay/live 语义的情况下，减少碎片 binary frame 数量。当前 Go broker 已有每个 stream 的 priority/order、`512KiB`/`8ms` round budget 和 turn ACK；stream 公平性单独作为 P1-1 测量，不在本项中假设为缺陷。

要求：

- 服务端将多个小 history chunk 合并为有界大小的 replay frame。
- 保留每个 frame 的绝对 cursor、history generation 和连续性。
- replay frame 不得与 live output 混淆。
- 不要把整个历史一次性合并成无界消息。

重点模块：

- `terminal_queue.go`
- history/replay 相关 Go 模块
- `terminal_queue_connection.js`
- `unified_transport_controller.js`

验收：

- 当前 Go 单元测试已验证多个相邻小 history chunk 合并后内容顺序保持不变，并继续满足单 frame `historyReplayChunk` 上限；真实 `tests-auto` 使用远程 Provider，尚未验证部署后的 server frame 数下降。
- 持续输出时 replay 仍保持 cursor 连续。
- replay 期间用户不可见中间 Canvas；初始 replay 必须单独观察，不得只用稳定打开后的持续输出测试代替。

### P1-1：Unified stream 公平性测量

状态：`[ ]`

当前 broker 已有按 stream 的 priority/order、`512KiB`/`8ms` round budget 和 turn ACK。现有日志只能证明不同 pane 的 frame 数和 replay 时间不同，不能证明 stream 竞争；本项只在真实多 pane 压测后决定是否需要调整调度器。

要求：

- 记录每个 stream 的首次服务延迟、最大连续占用时间、live output 最大等待时间和 queue turn 到 ACK 的耗时。
- 让至少一个 pane 持续产生高频 replay/live output，同时观察其他 pane 的首帧、控制帧和 live output 延迟。
- 区分 frame 数造成的单 pane 处理时间与 physical writer 跨 stream 阻塞。

验收：

- 有明确的多 pane 压测结果，能够判断现有 `512KiB`/`8ms` 调度是否满足目标。
- 如果确认存在竞争，再单独调整 writer；如果未确认，保留现有调度并把 frame batching 作为独立优化。

### P0-2：拆分 replay receive、output drain 和 presentation commit

状态：`[~]`（receive/drain 门控已有；状态命名和边界待审计）

目标：明确当前 `history-replay-complete` 只是接收完成通知，避免把它误认为 output drain 或 presentation commit。当前代码已通过 `replayCompletionPending`、`finishIfReady()`、`receivedHistoryCursor`/`appliedHistoryCursor` 和 output flush 做了部分隔离，不应重复创建另一套并行状态机。

目标状态至少为：

```text
replay_receiving
replay_receive_complete
replay_output_draining
replay_output_drained
presentation_pending
presentation_committed
```

要求：

- `replay_receive_complete` 只表示网络数据接收结束。
- 只有 `receivedCursor == appliedCursor` 且 output queue 排空，才进入 `replay_output_drained`。
- presentation、history validation 和最终 ready 状态等待 drain。
- 所有状态转换绑定 `connectionEpoch`、`channelGeneration`、`historyGeneration`。
- 旧 generation 的 drain/ACK/render 回调直接丢弃。

重点模块：

- `session_replay_controller.js`
- `session_replay_lifecycle.js`
- `output_controller.js`
- `session_protocol_controller.js`
- `session_state.js`

验收：

- 不再出现 replay 已完成但 `appliedCursor` 明显落后于 `receivedCursor` 的最终完成状态。
- 不再把 `history_replay_complete` 事件本身当作 stable ready；最终 ready 必须同时满足 replay commit、output drain、有效 geometry 和 presentation commit。

### P0-3：Per-pane single-flight output flush

状态：`[~]`（有界 flush 和单调度 handle 已实现；并发/指标仍待审计）

目标：确认 replay 和 live output 使用同一有序、有界的 drain 调度器，并修复仍可绕过该调度器的调用路径。当前 `output_lifecycle.js` 已为每个 pane 保存 RAF/timer handle，`output_controller.js` 已实现 bytes、entries、time budget 和连续数据合并；本项重点是补齐边界测试，不是重新建设基础 flush 架构。

要求：

- 每个 pane 同时最多一个 in-flight flush。
- 后续 output 只更新 pending 状态，不重复创建 timer/Promise。
- flush 使用明确的 bytes、entries 和时间预算。
- replay 和 live output 使用同一有序队列。
- 不允许单个 binary frame 直接触发独立完整 render。
- 明确 `maxBytes=0`、`maxEntries=0`、`maxTimeMs=0` 的语义；不依赖未初始化的隐式默认值。

重点模块：

- `output_controller.js`
- `terminal_queue_connection.js`
- `session_protocol_controller.js`

验收：

- `output_queued` 和 `output_flush_enter` 数量与 frame 数不再线性一一放大。
- 持续输出时主线程不会被大量小任务长期占用。
- queue drain 后没有遗留 flush timer。

### P0-4：Presentation 强制闭环和 last-known-good frame

状态：`[~]`（hold/commit/retry 已实现；隐藏原因、重试终止和灰点闭环待修复）

目标：修复数据已 drain 但 presentation 未提交的黑屏路径，并区分隐藏 pane 的预期延迟与活动 pane 的异常停滞。当前已经存在 last-known-good frame hold、resize fence 和 presentation watchdog，但 `hidden`/`measure` 原因仍有合并，presentation retry 仍可能持续调度，需补充明确的 stalled/error 终态。

要求：

- 将 `document.hidden`、tab inactive、pane hidden、Canvas zero size、fit pending、resize pending 分开记录。
- replay drain、resize applied、tab active、page visible 后合并为一次 presentation transaction。
- 同一 generation 内只允许一个 in-flight full render。
- retry 必须有明确终止条件，不能无限每 250ms 重试。
- presentation 等待期间保留 last-known-good frame，不清空 Canvas。
- hold frame 的 backing dimensions 必须按 CSS 尺寸乘以当前 renderer DPR 分配，字号/窗口变化期间不得用 1x canvas 平滑放大旧帧造成模糊；live canvas 与 hold canvas 的 CSS/backing 尺寸需分别记录。
- 从 hidden/measure 恢复后必须明确执行 `fit -> resize -> full render -> commit`。
- 新增移动端证据要求：`replay_output_drained` 后若已经 `resize_applied`，必须在同一 generation 内产生唯一的 `presentation_commit_complete`；不能依赖 focus、字体变化或下一次 resize 才唤醒 pending presentation。

重点模块：

- `presentation_controller.js`
- `presentation_view.js`
- `session_recovery_controller.js`
- `resize_controller.js`
- `session_connection_controller.js`

验收：

- 出现 `receivedCursor == appliedCursor` 后，最终一定能得到 `presentation_committed` 或明确错误。
- tab 切换、页面恢复和设备旋转后不会永久停留在 `presentation_deferred`。
- resize 等待期间不出现主动清屏。
- 健康 socket、有效 replay 和有效 Canvas 的 transport/presentation 状态必须可独立判断；`data-connection="open"` 不能掩盖 `data-render-ready="false"` 长期未收敛，也不能遗留灰色呼吸点。灰点只允许出现在首次稳定 presentation 尚未提交或明确异常恢复重试期间，`presentation_commit_complete` 后必须清除，正常输出、queue turn 和普通 resize 不得重新留下灰点。

### P0-5：禁止 queue turn 直接触发重复 full render

状态：`[~]`（协议路径已修复；真实 full-render 次数断言待补）

现状：修复前 `queue-turn-complete` 处理会在 replay committed 后直接调用 `terminalPresentation.ensure()`，这是日志中重复 full render 的直接候选路径。当前已移除该直接调用；queue turn 仍由 `terminalOutput.completeQueueTurn()` 校验和 drain，output flush 负责后续合并的 presentation validation。

要求：

- `queue_turn_complete` 只设置 pending presentation，不直接启动 full render。
- 同一 pane/generation 只允许一个 full render transaction。
- 新 cursor 到达时更新 pending target，不能复制 render 任务。
- render 完成后只在 cursor/geometry 仍未追平时再执行一次。

验收：

- 同一初始化事务的 `full_render_*` 不再出现几十次重复计数。
- render 次数与 geometry/generation 变化相关，而不是与 queue turn 数量相关。
- 当前已通过 queue-turn Node 协议回归、全量 Node 测试 `396` 项、`go test ./...` 和真实 `05-terminal-output` 安全回归；真实场景尚未直接采集 full render 次数，因此本项仍不能标记为完成。

### P1-2：限制 resume deadline 的副作用

状态：`[~]`（latest-only resume 和 deadline guard 已存在；副作用仍待真实场景验证）

要求：

- 当前 `onResumeDeadline()` 主要记录诊断并更新 pending UI 状态；必须验证它不会间接启动 recovery、重新 attach、resize 风暴或清空 Canvas。
- deadline 超时后的动作必须绑定当前 generation。
- 长 replay 场景应在 drain 后再判断是否真的需要恢复。
- pageshow、focus、online 和宿主 resume 进入同一个 latest-only resume transaction。

重点模块：

- `runtime_recovery_controller.js`
- `session_recovery_controller.js`
- `transport_runtime_controller.js`

验收：

- 大 replay 不再无故增加 resume generation。
- 不会因为 2 秒 deadline 把正常 replay 标记为连接失败。
- resume 不会制造额外 attach 或 render 风暴。

### P1-3：移动端 focus/resize/viewport 收敛

状态：`[~]`（latest-only geometry、resize epoch 和 ACK guard 已存在；移动端真实回归待完成）

要求：

- focus、软键盘、设备旋转、折叠屏开合和 viewport resize 使用 latest-only geometry。
- 同一 resize epoch 只允许一个等待和一个最终提交。
- 旧 resize ACK 不得覆盖新 geometry。
- resize 等待期间保留稳定旧帧。
- resize applied 后执行一次最终 fit/render/commit。
- `presentation_watchdog_probe` 必须能区分 resize 未发送、未 ACK、ACK 过期和 Canvas 不可测量。

重点模块：

- `resize_controller.js`
- `presentation_controller.js`
- `session_connection_controller.js`

验收：

- 移动端 focus 后不会长期停留在 `presentation_wait_resize`。
- 分辨率切换后不需要点击字号或手动触发其他操作才能恢复。
- 旧 geometry ACK 不会导致黑屏或错误尺寸。

### P1-4：合并 agent readiness 请求

状态：`[~]`（ensure single-flight 已存在；physical attach 的重复 ping 仍待评估）

当前不是主要延迟，但本次 Mac 日志显示 ensure 为 `0~6ms`、ping 为 `333ms`。服务端 `ensurePersistentAgent` 已按 target/account 使用 single-flight；剩余问题是一次页面 attach 是否仍产生不必要的重复 ping，以及去重是否会改变错误恢复语义。

要求：

- 同一 target 的 readiness 在一次 attach transaction 内共享。
- 已确认 agent running 时避免每个 pane 重复 ping。
- 保留 single-flight 和错误恢复语义。

验收：

- 同一页面启动期间 ensure/ping 次数与实际 readiness transaction 数一致。
- 不因去重导致 agent 重启或旧 session 丢失。

## 6. 禁止的回归方向

后续实现不得：

- 用清空 Canvas 掩盖 replay、resize 或 recovery 时序问题。
- 在 replay 尚未 drain 时提交用户可见中间帧。
- 用 xterm.js 替换 Ghostty WASM。
- 引入 quick-resume tail 或 screen checkpoint。
- 把浏览器缓存重新变成普通容器的历史权威。
- 为每个 pane 重新建立独立的重复恢复架构。
- 让慢客户端或日志订阅阻塞 PTY、agent 或 `log.Printf`。
- 记录命令输入、PTY 输出、token、cookie 或认证信息。
- 为了降低日志数量而删除 generation、cursor、resize 或 presentation 关键字段。

## 7. 测试和验收矩阵

每完成一个 P0/P1 项，都需要至少验证以下场景：

| 场景 | 需要观察的指标 |
| --- | --- |
| 0~25KB，空闲输出 | open、replay receive、drain、stable presentation |
| 350KB，重新打开/重新 attach 的初始历史 | frame 数、first/last replay frame、replay receive、output drain、presentation commit、初始期间可见 Canvas |
| 350KB，持续输出 | frame 数、live/replay 交错、queue bytes、flush 次数 |
| 三 pane 或多 pane 同时启动 | 每个 logical stream 的首次服务延迟、最大连续占用时间、live output 最大等待时间 |
| 移动端 focus/软键盘 | resize epoch、ACK、presentation commit、last-known-good frame |
| PC 改变窗口尺寸 | resize request/applied、旧 ACK 丢弃、Canvas 是否保留 |
| tab 切换 | hidden/visible 原因、激活后的最终 presentation |
| 页面后台再恢复 | resume generation、是否重复 attach/recovery、最终稳定帧 |
| 网络短断 | connection state、灰点/红点归类、恢复后 cursor 连续性 |

最低验收标准：

- agent 已运行且 pane 可测量、页面可见、没有目标切换或用户操作干扰时，从 WebSocket `open` 到 stable presentation commit 的 p95 目标不超过 2 秒；350KB、持续输出、隐藏 pane 和 resize 场景必须分别报告，不能混成一个 p95。
- 初始 replay 期间用户可见中间 Canvas 提交次数为 0；现有持续输出测试不能替代初始 replay 观察。
- `receivedCursor`、`appliedCursor`、`presentedCursor` 只能按有效 generation 单调前进。
- resize 期间不主动清空当前稳定画面。
- 旧 ACK、旧 timer 和旧 Promise 回调不能改变当前 geometry、cursor 或 connection state。
- 健康终端不能永久显示灰色呼吸点。
- 同一 pane/generation 不出现无界 presentation retry 或几十次重复 full render。

## 8. 复现和审计要求

分析新日志时：

1. 先按 payload 中的 `startupElapsedMs`、`replayDurationMs` 和 cursor 排序，不要完全依赖日志行的墙上时间；异步日志和 `xN` 聚合可能导致显示顺序错乱。
2. `serverReplayDurationMs` 只代表 agent replay 写入 attach 连接的局部耗时；必须和 Provider/queue/WebSocket/浏览器分段时间一起分析，不能直接作为服务端端到端耗时。
3. 服务端日志按 `server_log_seq` 去重。
4. 先比较 `history bytes`、`chunks`、`binaryMessages`，再看 flush 和 presentation。
5. 重点检查是否存在：
   - `history_replay_complete` 时 `appliedCursor < receivedCursor`；
   - queue 已 drain 但 `presentedCursor=0`，且该 pane 当时确实是活动且可测量的；
   - `presentation_deferred ... hidden:hidden` 长时间重复；先确认是非活动 tab/不可测量状态，不能直接判定黑屏；
   - `full_render_* xN` 高于合理的 geometry/generation 变化次数；
   - focus/resize 在已有稳定 presentation 后重新阻塞；
   - 同一 Unified connection 上一个 pane 的大量 frame 影响其他 pane。
5. 任何代码改动都应在本文对应条目更新状态、涉及模块、测试结果和残留风险。

## 9. 执行顺序与阶段门槛

以下是当前唯一有效的执行顺序。排序依据是先固定可观测边界，再保证 replay/drain 前置条件，随后修复当前最直接的 presentation/resize 用户问题，最后测量调度和 readiness 优化。未完成前一阶段的门槛，不进入后一阶段，避免把 replay、presentation、resize 和 broker 问题相互误判。

### 9.1 诊断补齐、场景扩展和真实基线

范围：完成 P0-0 的剩余观测工作，并扩展 `tests-auto/05-terminal-output`。

- 记录 Provider/queue/WebSocket/browser drain/presentation 的分段时间。
- 记录 `window.devicePixelRatio`、renderer DPR、live/hold Canvas 的 CSS 与 backing 尺寸。
- 记录 hold 显示/release、灰点 DOM 状态、`presentation_commit_complete` 和真实 full-render transaction 次数。
- 覆盖初始 350KB replay、三 pane、活动 pane、隐藏 tab 激活、移动端 focus/字体/窗口变化和灰点/模糊截图。
- 先采集 PC、Mac 和移动端的当前基线，不在基线阶段修改运行时逻辑。

阶段门槛：能够区分 replay receive、output drain、resize applied、hold 显示和最终 presentation commit；能够确认模糊时显示的是 live Canvas 还是 hold Canvas；能够区分 `xN` 展示聚合和真实 render 次数。

### 9.2 P0-2：收紧 replay receive/drain 边界

- 审计 legacy、Unified、resize 和 recovery 路径。
- 确认 `history_replay_complete` 只表示 receive complete。
- 确认只有 cursor 追平且 output queue 排空后才进入 `replay_output_drained`。
- 检查所有 drain、ACK、render 回调的 `connectionEpoch`、`channelGeneration` 和 `historyGeneration` guard。

原因：presentation 必须建立在稳定的 replay/drain 前置条件上，否则后续看到的“渲染慢”可能只是 output 尚未应用完成。

阶段门槛：所有路径都满足 `receive -> drain -> presentation` 顺序，旧 generation 不再污染当前 pane。

### 9.3 P0-3：审计 per-pane output flush single-flight

- 确认每个 pane 同时最多一个 in-flight flush。
- 补齐 replay/live 共用队列、bytes/entries/time budget 和 `max*=0` 语义测试。
- 检查没有 binary frame、Queue ACK 或 resize settle 路径绕过统一 drain。

原因：需要先排除重复 flush 和旧回调，才能判断后续 full render 是必要呈现还是 output 调度放大。

阶段门槛：queue drain 后没有遗留 timer，flush 数量不再被 frame 数或 queue turn 无界放大。

### 9.4 P0-4/P1-3：修复 presentation、resize、hold DPR 和灰点闭环

这是当前最高优先级的用户可见修复，包含以下顺序：

1. 修复 `replay_output_drained -> resize_applied` 后 pending presentation 没有被唤醒的问题。
2. 拆分 `document.hidden`、tab inactive、pane hidden、zero-size、fit pending、resize pending 和 ACK pending 原因。
3. 将 replay drain、resize applied、tab active 和 page visible 合并为一次 latest-only presentation transaction。
4. 为 presentation retry 增加明确的上限、stalled/error 终态和恢复路径。
5. 修复 hold Canvas 按 CSS 尺寸分配 backing store 的 DPR 风险，验证字号/窗口变化期间旧帧不被低分辨率平滑放大。
6. 完成灰点状态闭环：首次稳定 commit 前显示，明确异常重试时显示，成功 commit 后隐藏；正常 output、queue turn 和普通 resize 不得让灰点永久显示。
7. 保留 last-known-good frame，禁止通过清空 Canvas 掩盖问题。

原因：Mac 和移动端都显示 replay/queue 已在约 0.4~1.5 秒内完成，而用户可见异常集中在 presentation/resize；模糊和灰点也属于同一 hold/ready 生命周期。

阶段门槛：活动且可测量 pane 在 replay drain 和 resize applied 后无需 focus、改字体或再次 resize 就能完成唯一的稳定 presentation commit；隐藏 pane 激活后也能收敛；hold 清晰度和灰点状态符合契约。

### 9.5 P0-5：清理剩余 full render 重复调度

- 按 `queue_turn_complete`、history validation、resize applied、presentation validation、watchdog 和 focus/resume 分类统计 full render。
- 保证同一 pane/generation 只有一个 in-flight full render。
- 新 cursor 只更新 pending target，不复制 render 任务。
- 只有 cursor、geometry 或 generation 仍未追平时才继续调度。

原因：queue-turn 直接调用已经移除，但当前日志仍有 `x36~x64` 聚合；必须先完成 presentation 原因拆分，才能避免误删必要的恢复 render。

阶段门槛：full render 数量与真实 geometry/generation 变化相关，不再与 queue turn 数量线性相关。

### 9.6 P0-1：真实 Provider batching 验收

本地 Go batching 和单元测试已经完成，本阶段只验证部署效果：

- 部署包含新 `agent.go` 的 Provider，并确认 persistent agent 使用新版本。
- 重新运行 350KB、不同原始 chunk 数、持续输出和三 pane 场景。
- 对比 `serverHistoryChunks`、`serverReplayFrames`、`binaryMessages`、replay duration、output drain 和 presentation commit。

原因：只有真实 Provider 和浏览器日志同时确认 frame 数下降，才能把本地实现标记为完成。

阶段门槛：frame batching 保持 cursor/sequence/replay-live 顺序，且不引入 output、presentation 或 Unified stream 回归。

### 9.7 P1-2：验证 resume deadline 副作用

- 验证 `resume_deadline_exceeded` 不触发额外 attach、replay、resize、清屏或 render 风暴。
- 验证 pageshow、focus、online 和宿主 resume 使用 latest-only transaction。
- 覆盖长 replay、隐藏 tab 和页面后台恢复。

原因：当前 focus/resume 可能意外唤醒 pending presentation，必须在正常 presentation 闭环之后确认 resume 不再承担错误的补救职责。

阶段门槛：deadline 超时不会把正常 replay 标记为连接失败，也不会增加无意义的 generation、attach 或 render。

### 9.8 P1-1：Unified 多 pane 公平性压测

- 让一个 pane 持续产生高频 replay/live output，同时观察其他 pane 的首帧、控制帧和 live output。
- 记录首次服务延迟、最大连续占用、live output 最大等待和 queue turn 到 ACK。
- 区分 broker/provider 等待、浏览器 drain 等待和 presentation 等待。

原因：现有 broker 已有 `512KiB/8ms` round budget、priority/order 和 ACK；只有前面的问题收敛后，公平性数据才不会被 frame 碎片化或 presentation 卡住污染。

阶段门槛：有数据判断现有 broker 是否足够。没有证据时保持当前 broker，不新增 target 级长连接。

### 9.9 P1-4：按数据评估 agent readiness/ping 去重

- 对比页面启动期间的 ensure/ping 次数与 readiness transaction 数。
- 只有确认重复 ping 或 readiness 请求仍占据明显端到端耗时，才设计去重。
- 保留现有 single-flight、错误恢复和 agent 生命周期语义。

原因：当前 ensure 多为 `0ms`、ping 为百毫秒级，不是已确认的主要瓶颈，应避免过早增加恢复复杂度。

阶段门槛：去重不会触发 agent 重启、旧 session 丢失或新的 attach 竞争。

### 9.10 全量回归和文档收口

- 运行 Go、Node、静态检查、目标 `tests-auto` 以及 PC/Mac/移动端真实回归。
- 分别报告 350KB 初始 replay、350KB 持续输出、隐藏 tab、focus/resize、灰点和模糊场景，不能混成一个总 p95。
- 每个场景回填根因、实施文件、命令、结果、限制和防回归断言。
- 代码架构、模块职责或状态 owner 变化时，同步更新架构导航和对应模块 README。

最终门槛：活动可测 pane 在无用户干扰时从 WebSocket open 到 stable presentation commit 达到目标；初始 replay 无可见中间 Canvas；灰点、模糊、resize 黑屏和 full-render 重复均有明确结果。

本节只定义执行顺序，不表示上述未完成项目已经实施。quick-resume tail、screen checkpoint 和 target 级长连接 broker 仍不在当前执行范围内，除非后续数据明确证明现有方案不足。
