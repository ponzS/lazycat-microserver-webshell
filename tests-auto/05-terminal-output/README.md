# 终端 Output 真实环境回归

## 场景元数据

- 状态：active
- 类型：PC / mobile / multi-device / lifecycle
- 真实依赖：真实 Provider、persistent agent、PTY、Unified WebSocket、Chrome 和 Ghostty WASM
- 相关模块和源码入口：`runtime/static/terminal/transport/session_protocol_controller.js`、`runtime/static/terminal/output/`、`runtime/static/terminal/rendering/`、`runtime/static/terminal/resize/`

## 触发条件

在真实 WebShell workspace 中，对同一 pane 依次执行普通输出、约 1.5 MiB 大块输出、持续输出期间切换隐藏 tab，以及持续输出期间改变 viewport/resize。测试使用两个独立窗口，并把当前工作区的版本化前端资源映射到页面。

## 用户可见问题

历史回放或持续输出期间可能出现首次显示慢、Canvas 中间帧暴露、resize 后黑屏、输出丢失或 Unified physical WebSocket 被重复创建。移动端已确认另一类表现：`history_replay_complete` 和 `replay_output_drained` 均已完成，但初始 presentation 在 `resize_applied` 后没有及时提交；用户聚焦、调整字体或下一次 resize 触发 full render 后，之前已应用的历史内容才显示。调整字体或窗口大小期间还可能看到终端内容暂时明显模糊，当前优先怀疑 presentation hold 使用 CSS 尺寸 backing canvas、在高 DPR 下被 `image-rendering: auto` 平滑放大。`queue_turn_complete` 还可能触发重复 full render，放大持续输出期间的主线程调度压力。

## 预防的回归

- 输出最终到达当前 Ghostty 内存状态。
- replay、resize、隐藏 tab 和恢复期间不暴露不稳定的中间 Canvas。
- output queue 不发生 overload 或 stale output drop。
- 输出压力前后每个页面仍只有一条 Unified physical WebSocket。
- `queue_turn_complete` 不直接启动新的 presentation full render。

## 修复前基线

- 2026-09-02 真实 `05-terminal-output` 基线通过，但观察到移动端 `rejected stale resize ACK` warning。该 warning 表示旧 resize ACK 被 generation fence 拒绝，符合旧 ACK 不得覆盖新 geometry 的安全语义，不应作为测试失败。
- 基线测试覆盖约 1.5 MiB 实时输出，不覆盖初始打开时的 350KB 历史 replay，也不直接统计 `queue_turn_complete` 与 full render 的关联。
- 基线的 presentation observer 在终端已经打开后启动，不能证明首次 replay 阶段的用户可见 Canvas commit 次数为零。

## 已确认根因

修复前，`session_protocol_controller.js` 在收到 Unified `queue-turn-complete` 后直接调用 `terminalPresentation.ensure()`，可能为每个 queue turn 启动 presentation 检查和 full render。该路径与真实日志中的重复 `full_render_*` 事件相符。

## 实施方案

移除 `queue-turn-complete` 处理中的直接 `terminalPresentation.ensure()` 调用。queue turn 仍由 `terminalOutput.completeQueueTurn()` 校验和 drain；output flush 在实际写入后通过既有的 presentation validation 进行合并调度。保留 queue turn ACK、cursor、channel generation 和错误恢复语义。

P0-1 的本地 Go 实现将相邻 history chunk 合并到有界的 `historyReplayChunk` 后再发送，保留 replay control frame、绝对 cursor、fast integrity sequence 和 replay/live 顺序。该实现需要部署到真实 Provider 后，才能通过 `tests-auto` 验证浏览器实际收到的 frame 数变化。

## 验证结果

2026-09-02 修复后验证：

- `node --test tests/terminal_session_protocol_controller_test.mjs tests/terminal_output_controller_test.mjs tests/terminal_presentation_controller_test.mjs tests/terminal_resize_controller_test.mjs tests/terminal_unified_transport_controller_test.mjs tests/app_runtime_recovery_controller_test.mjs`：54 项通过。
- `node --test tests/*.mjs`：396 项通过。
- `go test ./...`：通过；新增 Go 测试验证相邻 history chunk 合并后内容顺序保持不变，原有 frame 上限和 fast integrity 测试通过。
- 真实 `05-terminal-output`：通过；`unsafe=0`、`overloads=0`、`staleDrops=0`，desktop/mobile 各保持 1 条 Unified physical WebSocket，`terminalOutputBytes=1,575,664`、`terminalOutputBatches=136`。该测试通过远程 Provider，不能证明本地 Go server batching 已部署生效。
- 真实测试仍观察到 mobile 的 stale resize ACK warning；旧 ACK 被 generation fence 拒绝，未改变最终 geometry，当前不作为失败处理。
- P0-1 的 server frame 数下降、P0-5 的真实 full-render 次数和初始 350KB replay 仍需部署后端改动并补充真实场景断言。


```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/05-terminal-output/test.mjs
```

## 产物与失败诊断

运行产物位于本目录的 `artifacts/<run-id>/`，包括 `events.jsonl`、截图、trace 和失败摘要。重点检查 `presentation.unsafe`、`metrics.overloads`、`metrics.staleDrops`、Unified socket 数量、console/pageerror 和相关终端时间线。

## 已知限制

- P0-4/P1-3 的移动端初始 presentation 问题尚未修复：已记录 replay drain、`resize_applied` 到最终 `presentation_commit_complete` 的长间隔，以及 focus/字体变化触发 full render 后恢复的现象。
- 已记录右上角灰色呼吸点的独立问题：首次稳定 presentation 后仍可能保持显示；后续需要验证 `data-render-ready` 在 commit、正常 output、queue turn、普通 resize 和 recovery retry 后的状态闭环。
- 已记录字号/窗口变化期间的模糊问题：当前未发现主动降低全局 DPR 的代码；待验证 hold canvas 是否因 CSS 尺寸 backing store 与高 DPR live canvas 不一致而被浏览器平滑放大。
- 当前测试没有在初始历史 replay 之前安装 observer，不能单独证明 replay 期间用户可见 Canvas commit 为零。
- 当前测试使用实时 1.5 MiB 输出，不等价于重新 attach 时的 350KB 历史 replay。
- 当前测试允许并记录 stale resize ACK warning；后续应继续确认 warning 对应旧 ACK 且不会改变当前 geometry，而不是简单删除 warning 或放宽断言。
- P0-5 当前已有 Node 协议回归断言和真实 output 安全回归，但仍需要采集 full render 次数，才能完成端到端验收。
