# 终端历史重放可见与 resize 卡死问题执行计划

状态：阶段 0/1/3 已完成第一批实现，等待用户手动测试与真实设备验收

最后更新：2026-08-26

本文只解决两个问题：

1. pi、Codex 等 TUI 在历史恢复、重连、切 tab 或部分 resize 流程中，仍然能看到快速历史重放或中间画面。
2. 频繁拖拽窗口、调整字体大小或触发多阶段 fit 时，终端因为 resize、TUI 重绘、WASM 解析和 Canvas 分配叠加而卡死。

本计划不重新实现服务端会话托管、Agent 保活、终端历史持久化或多客户端会话模型。现有服务端 Agent/PTY、history、cursor、generation、Cache v2 和连接复用能力都是本计划必须保护的既有基础。

## 1. 方案概述

将两个问题拆成两个相互配合但职责独立的状态机：

```text
History Replay / Presentation
  负责历史恢复期间什么时候允许 Canvas 可见

Resize / Resource Control
  负责什么时候真正改变 PTY 和 Ghostty geometry，
  以及如何限制 resize 产生的输出和渲染资源峰值
```

目标流程：

```text
geometry 稳定
  -> 提交一次最终 resize
  -> 等待 PTY/Agent ACK
  -> 有界处理 SIGWINCH/TUI 输出
  -> replay 或实时输出达到连续边界
  -> 一次最终 full render
  -> presentation commit
```

历史回放和 resize 期间都允许终端模型继续按序更新，但不允许中间状态直接进入用户可见 Canvas。

## 2. 当前系统必须保持的边界

以下能力已经存在，后续修复只能围绕它们增强，不能用新状态机替代：

- 服务端 persistent Agent/PTY 不因浏览器关闭、tab 切换或 WebSocket 断开而被销毁。
- 服务端 history 是终端历史的权威来源；客户端 Cache v2 只是恢复优化。
- `history_generation`、绝对 byte cursor、sequence、checksum、connection epoch 和 channel generation 继续严格校验。
- Fast、Queue、legacy 和旧 Agent fallback 继续兼容。
- `Terminal.write()` 保持同步语义，不能破坏 echo、DSR/DA、generated response、replay commit 和输入时序。
- 继续使用当前 `ghostty-web + Canvas 2D`，不引入 `xterm.js` 或 `tmux`。
- 用户设置的 scrollback 行数仍是唯一用户可见历史窗口；byte limit 只是安全上限。
- 不能通过任意 raw PTY byte 尾部恢复 alternate-screen TUI 的 semantic state。

“前端不显示中间帧”不等于“停止服务端会话”；“暂停当前 Canvas”不等于“丢弃实时输出”。

## 3. 问题一：仍然看到历史重放

### 3.1 需要区分的现象

用户看到快速滚动或内容快速变化，不一定都是历史 replay，至少要区分：

```text
真正 history replay
  断线、cursor gap、snapshot 或重新 attach 触发 raw history replay

Cache warm replay
  客户端本地 Cache v2 字节重新驱动 Ghostty

TUI live redraw
  resize 触发 SIGWINCH，pi/Codex 自己输出整屏 ANSI/VT

普通实时输出
  Agent 正在继续产生新内容

Canvas/presentation 问题
  Ghostty 状态已更新，但中间 render 或 viewport 物化被暴露
```

不能只凭“画面变化很快”断定是历史重放。必须用事件顺序和 output source 证明：

```text
history-replay-start
write-replay
history-replay-complete
resize-request
resize-applied
term-resize
resize-output-settle-complete
full-render-start
full-render-complete
presentation-commit
```

### 3.2 目标行为

replay、snapshot、Cache warm replay、resize settle 和 Canvas recovery 都使用统一的 presentation transaction：

```text
transaction begin
  -> 保存身份匹配的 last-known-good frame
  -> 禁止中间 Canvas/render commit
  -> 按序更新当前 Ghostty 状态
  -> 保留 pending full render
  -> 等待 cursor、generation、geometry 和 viewport 条件满足
  -> 执行一次最终 full render
  -> 验证 render 结果
transaction commit
  -> 替换旧 frame
  -> 设置 renderReady
  -> 在其他输入条件满足后开放输入
```

必须满足：

- replay 未 committed 前不能显示 replay checkpoint；
- checkpoint 只能用于诊断，不能推进 history ready、input ready 或 Cache manifest；
- resize 期间的 TUI 输出可以被解析，但不能逐行显示；
- `Terminal.resize()`、内部 render loop、cursor、selection、theme 和 renderer 入口都不能绕过 render suppression；
- renderer 无 completion callback、pane 暂不可测量或单次 render 失败时，retry 状态不能丢失；
- 旧 frame、preview 和占位内容不能推进 `presented_cursor` 或 `presented_generation`。

### 3.3 不能采用的恢复方式

- 不能从任意 raw PTY byte 尾部猜测当前 TUI 状态；
- 不能为了隐藏问题而清空 PTY、重建 Agent 或重建整个 session；
- 不能把 resize 当成必然需要完整 history replay 的事件；
- 不能把第一批 replay 字节或中间 Canvas 当作最终首帧；
- 不能因为 cache miss 就丢失已有 last-known-good frame。

## 4. 问题二：频繁 resize/字号调整导致卡死

### 4.1 主要资源放大链路

当前最需要限制的链路是：

```text
ResizeObserver 高频事件
  -> 多个 geometry/fit 计算
  -> 多个 resize request 或 ACK 竞争
  -> 多次 PTY Setsize/SIGWINCH
  -> TUI 全屏 ANSI/VT 输出
  -> WASM 解析和 scrollback 更新
  -> Ghostty resize 和 Canvas backing-store 重分配
  -> full render、presentation retry、force flush 叠加
  -> 主线程长任务和内存峰值
```

低配置设备更容易复现，但根因不是简单的设备性能不足，而是一次拖拽可能被放大成多次 PTY、WASM、Canvas 和同步输出工作。

### 4.2 目标行为

窗口拖拽和字号变化应遵循：

```text
连续测量期间只记录 latest target
  -> 过滤没有改变 cols/rows/cell metrics 的像素变化
  -> geometry 稳定后只提交一次最终目标
  -> 每个 pane 只允许一个 in-flight resize 和一个 pending target
  -> ACK 后只执行一次本地终端 resize
  -> 有界处理 TUI 输出
  -> 只做一次最终 full render
```

必须满足：

- 同一目标在等待 ACK 时复用原 request，不生成新的 epoch；
- 不同目标连续到达时只保留最新 pending target；
- ACK timeout、stale ACK、connection epoch 变化和失败重试不能无限生成 resize epoch；
- PTY/Agent/Provider 层继续合并短时间内的 `Setsize`；
- resize settle 不能使用无界同步 `flushSessionOutput(session, { force: true })`；
- 输出 drain 使用字节预算和/或时间预算，并在批次之间让出主线程；
- Canvas backing store 重建、WASM resize 和 full render 都必须有计数及耗时诊断；
- 字号变化的多阶段 fit 不能让旧测量回调再次提交旧 geometry；
- resize 只改变 geometry/presentation 状态，不得无条件重置 history generation 或重新回放整个历史。

## 5. 具体实施流程

### 阶段 0：建立证据和资源基线

- [x] 保留并扩展 pane、connection epoch、channel generation、history generation、resize epoch 和相对时间诊断。
- [x] 增加 force flush 字节数、峰值和耗时指标。
- [ ] 在真实桌面浏览器、Lazycat WebView 和低配置设备采集长任务、输入延迟、Canvas backing store 与 PTY 输出数据。

先增加或完善不改变行为的诊断，确认两个问题的真实链路：

```text
ResizeObserver events
resize scheduler runs
resize requests/ACKs/stale ACKs/retries
term.resize count and duration
WASM resize/write duration
Canvas resize count and backing-store bytes
full render count and duration
output bytes after SIGWINCH
output queue/settle queue max depth
force flush bytes and duration
long task duration
input event latency
```

每条日志绑定 pane、session 摘要、connection epoch、channel generation、history generation、resize epoch 和相对时间，不记录 PTY 内容、命令文本或票据。

完成标准：一次现场问题可以判断属于真正 replay、TUI live redraw、cursor gap、presentation 泄漏或资源峰值。

### 阶段 1：resize latest-only 和单 in-flight

- [x] 复用同目标 resize request，保留一个 pending target。
- [x] resize fence 按 ACK 前队列前缀分批排空，避免旧/新 geometry 输出混合。
- [x] resize settle 使用有界 drain，持续输出不会让 barrier 永久等待。
- [ ] 完善服务端/Agent 层的 latest-only `Setsize` 合并，并完成真实低配置设备压测。

1. `ResizeObserver` 期间只更新 `latestResizeTarget`。
2. 只有 cols、rows、cell width 或 cell height 真正变化时才产生候选请求。
3. geometry 稳定后提交最终目标。
4. 每个 pane 只保留一个 in-flight request 和一个 pending target。
5. 同目标请求复用原 request identity；目标变化只替换 pending target。
6. ACK 后补发最新 pending target，但仍只保留一个 in-flight。
7. stale ACK 只记录诊断，不能修改当前 applied geometry。
8. 字号 generation、visibility、focus 和 connection epoch 失效时清理旧回调。

完成标准：连续拖拽不会生成 A/B/C/D 全部进入 PTY；同一目标不会反复创建相同 epoch。

### 阶段 2：限制 PTY/TUI/浏览器输出峰值

1. 审计 Provider、Agent、Queue broker 和 PTY 的 `Setsize`，在服务端继续做 latest-only 合并。
2. 将 resize 后输出 settle 改成有界 drain，不无界同步 force flush。
3. 为 replay、resize settle 和实时输出分别记录队列深度与预算消耗。
4. 必要时为 Fast 增加与 Queue 对等的消费确认或连接级背压。
5. 保证服务端继续接收并保存 session 输出；前端背压只能限制该连接，不得丢失服务端 history。
6. 对连续 TUI 输出使用固定字节或毫秒预算，保证输入事件和浏览器调度有机会执行。

完成标准：高输出和频繁 resize 时，队列不会无界增长，主线程不会被一次 force flush 长时间占用。

### 阶段 3：统一 replay/render presentation transaction

- [x] Ghostty 增加嵌套 render suppression，覆盖 requestRender、RAF、renderNow 和 reset 的直接 Canvas clear。
- [x] WebShell 在 replay reset、deferred resize 和最终 replay commit 中接入 suppression。
- [x] 中间 render 保持 pending，最终由已有 presentation gate 提交。
- [ ] 审计剩余辅助绘制入口，并完成 replay 泄漏与 TUI `SIGWINCH` 重绘的真实对照验收。

1. 盘点所有可能触碰 Canvas 或 renderer 的入口。
2. 让 `writeReplay()`、`Terminal.resize()`、内部 `requestRender()`、cursor、selection、theme 和 recovery 统一服从 render suppression。
3. replay 或 resize hold 期间保留旧 frame，或者显示经过完整 identity 校验的稳定占位。
4. 所有中间 render request 合并为 pending full render。
5. 统一由 `commitTerminalPresentationIfReady(session)` 完成最终提交。
6. commit 前同时校验 replay committed、output settled、geometry、canvas backing store、viewport、generation 和 renderer completion。
7. renderer 无 callback、不可测量或暂时失败时，使用事件驱动加 timer 兜底重试，不能一次失败后永久黑屏。

完成标准：用户看不到 raw replay 逐步滚动、resize settle 半帧、黑屏后点击才恢复或旧 session frame。

### 阶段 4：验证 replay 与 SIGWINCH 的差异

1. 对 pi、Codex 和普通 shell 分别执行 Cache enabled/disabled 对照。
2. 分别测试只 reconnect、只切 tab、只 resize、只改字号、只触发 full render。
3. 对比 `history-replay-start` 与 `resize-applied/term-resize` 的相对顺序。
4. 确认 resize 后产生的 TUI 输出属于当前 session live cursor，而不是被错误放入 history replay。
5. 如果仍有可见快速变化，检查是 TUI 自身重绘还是 Ghostty render suppression 泄漏。

完成标准：能用日志和 cursor/source 解释用户看到的每次快速变化。

### 阶段 5：测试、灰度和真实设备验收

1. 增加 stale ACK、pending target、timeout、connection epoch、resize/replay 并发和 renderer 无 callback 测试。
2. 增加 presentation commit 不可丢失、不可测量重试和最后有效帧保护测试。
3. 覆盖 Fast modern、Fast legacy、Queue modern + ACK、Queue legacy 和旧 Agent fallback。
4. 在低配置设备、桌面浏览器、移动端 WebView 和 Lazycat 宿主进行持续 TUI 压测。
5. 逐步打开 feature flag，观察长任务、输入延迟、resize 次数、resync 次数和内存峰值。

## 6. 验收标准

### 历史重放问题

```text
replay 期间不显示中间 Canvas
最终画面只在 commit barrier 完成后提交
Cache miss 不会丢失服务端历史或 last-known-good frame
resize 不会无条件触发完整 history replay
pi/Codex 的 TUI redraw 能与真正 history replay 区分
输入不会在 replay 或最终 render 前解锁
```

### resize 卡死问题

```text
一次稳定拖拽最多一次最终 PTY resize
一个 pane 同时最多一个 in-flight 和一个 pending target
同一目标 retry 不无限创建新 epoch
resize settle 输出有界，不执行无界 force flush
Canvas backing store 和 full render 次数受控
高输出期间输入事件仍能获得调度机会
低配置设备连续拖拽不会进入资源耗尽或永久卡死
```

### 既有会话能力

```text
关闭前端不销毁服务端 Agent/PTY/session
服务端 history、cursor 和 generation 继续有效
重连、换设备和 Cache disabled 仍可恢复当前 session
Fast/Queue/legacy 兼容路径不被新 gate 破坏
跨 pane、tab、account 和 workspace 的 identity 隔离继续有效
```

## 7. 风险与回退

| 风险 | 处理方式 |
| --- | --- |
| resize 合并导致 TUI 最终尺寸延迟 | 使用稳定窗口和最大等待时间，保证最终 geometry 一定提交 |
| TUI 依赖每次 SIGWINCH | 保留最终一次 PTY resize，不在拖拽中永久屏蔽最后通知 |
| 输出预算过小导致恢复时间变长 | 通过可配置 byte/time budget 调整，优先保护输入响应 |
| render suppression 遗漏入口 | 以 Ghostty renderer 入口审计和 Canvas capture 诊断补齐，不增加随机 timer |
| 旧 Agent/协议不支持新字段 | 能力协商后走兼容路径，不改变服务端 history 权威性 |
| cache 或 preview 失败 | 回退服务端 retained history，保留 last-known-good frame |
| 新 transaction 进入异常状态 | 由 identity/generation/cursor 校验触发当前 pane resync，不清空其他 pane/session |

回退时只能关闭新的 resize/presentation feature flag，保留现有服务端会话、历史、cursor 和兼容协议。不能通过杀掉 PTY、清空历史、销毁 session 或关闭其他 pane 来掩盖卡死和重放问题。

## 8. 修改和验证约束

- 修改 `runtime/static/main.js` 后首先运行 `node --check runtime/static/main.js`。
- 终端协议或 Agent 行为变更必须增加对应 Go/Node contract 或 unit test。
- 每次 Bug 修复同步更新 `docs/FIX_HISTORY.md`，记录现象、根因、guard 和验证结果。
- 提交时只包含本计划相关的文件，保留用户已有的 `package.yml` 或其他本地修改。
- 真实 Lazycat 宿主、移动端 WebView、低配置设备和持续高输出场景未验证前，不把自动化测试通过视为最终完成。
