# WebShell 终端初始化、Replay 与黑屏问题总结和执行清单

状态：诊断阶段完成，等待按 P0 顺序实施
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

三次日志均显示基础启动较快：

- 页面模块启动到 workspace/bootstrap 完成约 `0.43~0.72s`。
- Ghostty WASM 在约 `0.05~0.46s` 内就绪。
- WebSocket open 通常在页面启动后约 `0.61~1.06s`。
- agent ensure 多数为 `0ms`，ping 约 `68~109ms`。

结论：目前没有证据证明页面初始化、Ghostty WASM、WebSocket upgrade 或 agent readiness 是接近 10 秒延迟的主因。

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

两者历史字节相同，但 frame 数相差约 12 倍，replay 时间相差约 2 倍。服务端 replay 时间只有 `2~7ms`。

### 2.3 移动端日志：350KB 历史

移动端两个 pane 同样都是 `350,000 bytes`：

| pane | chunks/frames | replay 时间 | output 计数 | 结果 |
| --- | ---: | ---: | ---: | --- |
| pane-1 | 1,641 | 3.562s | `output_queued x1779`、`flush x223` | presentation 最终约 6.9s 才稳定提交 |
| pane-2 | 88 | 179ms | `output_queued x88`、`flush x12` | queue 很早 drain，但到约 6.7s 仍 `presentedCursor=0` |

移动端 pane-1 的 cursor 在 replay 后又增加约 `49,881 bytes`，说明 replay 期间或紧接着存在持续 live output。

### 2.4 最关键的 cursor 证据

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

## 3. 当前已经确认的根因

### A. Replay frame 碎片化造成前端调度放大

同样数量级的历史字节，chunk/frame 数可以从几十增长到上千。每个 binary frame 都可能触发：

- WebSocket message 回调；
- output queue 入队；
- queue turn；
- flush 调度；
- Ghostty 写入/解析；
- ACK 或 presentation 检查。

连续输出会让历史 replay 和 live output 进一步交错，放大这些任务的总数。

### B. Unified 多 pane 之间存在潜在调度竞争

PC 日志中：

```text
pane-1: 961 frames, 3.407s
pane-2: 81 frames, 1.646s
```

移动端日志中：

```text
pane-1: 1641 frames, 3.562s
pane-2: 88 frames, 0.179s
```

这表明 frame 数量是主要因素，同时也说明高频 logical stream 可能影响同一 physical WebSocket 上其他 pane 的处理时机。后续 frame batching 必须配合 stream 公平调度，不能让一个 pane 独占物理连接。

### C. Replay receive complete 早于 output drain

当前 replay 完成事件上报过早。它可能让 resize、presentation、history validation、resume deadline 和 queue ACK 在 output 尚未追平时开始运行。

### D. Presentation 被 hidden/measure 门控卡住

至少一个 pane 在 queue 已排空、cursor 已追平后，仍然持续：

```text
presentation_retry_scheduled delay=250
presentation_deferred reason=...hidden:hidden
```

这与跨 tab、移动端页面可见性、分辨率切换和折叠屏恢复后的永久黑屏高度相关。

### E. Full render 被重复触发

日志出现：

```text
full_render_request x64~x73
full_render_start x64~x73
full_render_complete x64~x73
presentation_ensure x64~x73
```

这些请求通常和 `queue_turn_complete`、`history_validation` 或 resume generation 相关，说明 queue turn、resume 和 presentation 之间仍然存在重复触发。

### F. 移动端 focus/resize 会在已有稳定画面后重新进入等待

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
- agent 启动慢：本次 ensure 命中缓存，主要为 `0ms`。
- 服务端历史 replay 慢：服务端记录为 `2~10ms`。
- 单纯减少历史字节：本次核心差异来自 frame/chunk 数，且历史容量由设置控制。
- quick-resume tail：明确不采用。
- screen checkpoint：明确不采用。
- target 级长连接 broker：在证明 `lightosctl exec` 是主瓶颈前不采用。

## 5. 执行清单

状态标记：`[ ]` 待执行，`[~]` 执行中，`[x]` 已验证完成。

### P0-1：Replay frame batching 和 Unified stream 公平调度

状态：`[ ]`

目标：在不改变权威 cursor 和 replay/live 语义的情况下，减少碎片 binary frame 数量。

要求：

- 服务端将多个小 history chunk 合并为有界大小的 replay frame。
- 保留每个 frame 的绝对 cursor、history generation 和连续性。
- replay frame 不得与 live output 混淆。
- Unified physical writer 采用 logical stream 公平调度。
- 一个 pane 的大 replay 不得独占物理连接。
- 不要把整个历史一次性合并成无界消息。

重点模块：

- `terminal_queue.go`
- history/replay 相关 Go 模块
- `terminal_queue_connection.js`
- `unified_transport_controller.js`

验收：

- 相同 350KB 场景下 frame 数显著下降。
- 持续输出时 replay 仍保持 cursor 连续。
- 多 pane 同时启动时，其他 pane 的 live/replay 不被长时间阻塞。
- replay 期间用户不可见中间 Canvas。

### P0-2：拆分 replay receive、output drain 和 presentation commit

状态：`[ ]`

目标：修正当前 `history_replay_complete` 语义过早的问题。

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
- `presentedCursor` 未追平时不能报告 stable ready。
- replay 过程不提交用户可见中间帧。

### P0-3：Per-pane single-flight output flush

状态：`[ ]`

目标：将 replay 和 live output 收敛到每个 pane 唯一、有界的 drain 调度器。

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

状态：`[ ]`

目标：修复数据已经 drain 但 `presentedCursor=0` 的黑屏路径。

要求：

- 将 `document.hidden`、tab inactive、pane hidden、Canvas zero size、fit pending、resize pending 分开记录。
- replay drain、resize applied、tab active、page visible 后合并为一次 presentation transaction。
- 同一 generation 内只允许一个 in-flight full render。
- retry 必须有明确终止条件，不能无限每 250ms 重试。
- presentation 等待期间保留 last-known-good frame，不清空 Canvas。
- 从 hidden/measure 恢复后必须明确执行 `fit -> resize -> full render -> commit`。

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
- 健康 socket、有效 replay 和有效 Canvas 必须显示 `data-connection="open"`，不能遗留灰色呼吸点。

### P1-1：禁止 queue turn 直接触发重复 full render

状态：`[ ]`

要求：

- `queue_turn_complete` 只设置 pending presentation，不直接启动 full render。
- 同一 pane/generation 只允许一个 full render transaction。
- 新 cursor 到达时更新 pending target，不能复制 render 任务。
- render 完成后只在 cursor/geometry 仍未追平时再执行一次。

验收：

- 同一初始化事务的 `full_render_*` 不再出现几十次重复计数。
- render 次数与 geometry/generation 变化相关，而不是与 queue turn 数量相关。

### P1-2：限制 resume deadline 的副作用

状态：`[ ]`

要求：

- replay 正常进行时，`resume_deadline_exceeded` 只能记录诊断，不得直接启动 recovery、重新 attach 或清空 Canvas。
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

状态：`[ ]`

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

状态：`[ ]`

当前不是主要延迟，但日志显示同一启动事务有多次 `ensure`。

要求：

- 同一 target 的 readiness 在一次 attach transaction 内共享。
- 已确认 agent running 时避免每个 pane 重复 ping。
- 保留 single-flight 和错误恢复语义。

验收：

- 同一页面启动期间 ensure/ping 次数与实际 readiness transaction 数一致。
- 不因去重导致 agent 重启或旧 session 丢失。

### P2-1：改进诊断日志精度和语义

状态：`[ ]`

要求：

- 明确区分 `canvas_element_visible`、`terminal_frame_committed` 和 `stable_presentation_complete`。
- hidden 原因拆分为结构化字段。
- `history_replay_complete` 改名或补充 receive/drain 语义。
- `xN` 聚合计数必须说明是诊断层去重，不直接等于服务端执行次数。
- 服务端日志以 `server_log_seq` 去重；Unified fan-out 不应被误判为多个服务端请求。
- 保留 `connectionEpoch`、`channelGeneration`、`historyGeneration`、`resizeEpoch` 和 cursor 字段。

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
| 350KB，空闲输出 | frame 数、replay drain、full render 次数 |
| 350KB，持续输出 | frame 数、live/replay 交错、queue bytes、flush 次数 |
| 多 pane 同时启动 | logical stream 公平性、单 pane 是否阻塞其他 pane |
| 移动端 focus/软键盘 | resize epoch、ACK、presentation commit、last-known-good frame |
| PC 改变窗口尺寸 | resize request/applied、旧 ACK 丢弃、Canvas 是否保留 |
| tab 切换 | hidden/visible 原因、激活后的最终 presentation |
| 页面后台再恢复 | resume generation、是否重复 attach/recovery、最终稳定帧 |
| 网络短断 | connection state、灰点/红点归类、恢复后 cursor 连续性 |

最低验收标准：

- agent 已运行时，WebSocket open 到 stable presentation commit 的 p95 目标不超过 2 秒；大 replay 场景需单独记录数据量和 frame 数。
- replay 期间用户可见中间 Canvas 提交次数为 0。
- `receivedCursor`、`appliedCursor`、`presentedCursor` 只能按有效 generation 单调前进。
- resize 期间不主动清空当前稳定画面。
- 旧 ACK、旧 timer 和旧 Promise 回调不能改变当前 geometry、cursor 或 connection state。
- 健康终端不能永久显示灰色呼吸点。
- 同一 pane/generation 不出现无界 presentation retry 或几十次重复 full render。

## 8. 复现和审计要求

分析新日志时：

1. 先按 payload 中的 `startupElapsedMs`、`replayDurationMs` 和 cursor 排序，不要完全依赖日志行的墙上时间；异步日志和 `xN` 聚合可能导致显示顺序错乱。
2. 服务端日志按 `server_log_seq` 去重。
3. 先比较 `history bytes`、`chunks`、`binaryMessages`，再看 flush 和 presentation。
4. 重点检查是否存在：
   - `history_replay_complete` 时 `appliedCursor < receivedCursor`；
   - queue 已 drain 但 `presentedCursor=0`；
   - `presentation_deferred ... hidden:hidden` 长时间重复；
   - `full_render_* xN` 高于合理的 geometry/generation 变化次数；
   - focus/resize 在已有稳定 presentation 后重新阻塞；
   - 同一 Unified connection 上一个 pane 的大量 frame 影响其他 pane。
5. 任何代码改动都应在本文对应条目更新状态、涉及模块、测试结果和残留风险。

## 9. 推荐实施顺序

```text
P0-1  replay frame batching + stream fairness
  -> P0-2  replay receive/drain/presentation 状态拆分
  -> P0-3  per-pane single-flight output flush
  -> P0-4  presentation 强制闭环和 last-known-good frame
  -> P1-1  删除 queue turn 驱动的重复 full render
  -> P1-2  限制 resume deadline 副作用
  -> P1-3  移动端 focus/resize/viewport 收敛
  -> P1-4  agent readiness 去重
  -> P2-1  诊断语义和指标清理
```

第一批实施完成后，应重新采集至少一份 PC 和一份移动端的 `350KB + 持续输出` 日志，再决定是否需要进一步优化历史协议或 `lightosctl exec` 路径。
