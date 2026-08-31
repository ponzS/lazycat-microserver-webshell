# WebShell 终端 resize 原子性与画面残留修复方案

状态：历史方案，已被当前 resize epoch 与服务端权威 snapshot 架构取代

最后更新：2026-08-21

> 2026-08-31 更正：本文描述的 Cache API v2、cache preview 和浏览器历史回放方案已经移除，不得再作为当前实现依据。当前普通容器只通过 Unified WebSocket 消费 persistent agent 的权威 `snapshot + live`；`client:` 仅保留隔离的 IndexedDB 兼容路径。本文只保留 resize 问题的历史分析证据，现行边界以 `docs/FIX_HISTORY.md` 和 `docs/FRONTEND_MODULE_MAP.md` 为准。

本文是针对“调整窗口大小后字符位置错乱、出现难以解释的乱码、偶尔显示旧会话历史行”问题的修复设计与执行计划。它补充 [FIX_HISTORY.md](FIX_HISTORY.md) 和 [WEBSOCKET_CONNECTION_MULTIPLEXING_PLAN.md](WEBSOCKET_CONNECTION_MULTIPLEXING_PLAN.md)，不替代现有历史同步、Ghostty 渲染和连接调度约束。

## 1. 结论摘要

问题不是 `.env`、Vim 或单纯的字符编码问题。当前链路存在两个相互放大的一致性缺口：

1. 浏览器先切换 Ghostty 的本地字符网格，再异步向 Provider 和 persistent agent 发送 PTY resize；没有带 epoch 的“已应用”确认，也没有把 resize 与 PTY 输出建立有序边界。
2. 浏览器的 presentation hold、旧 Canvas、Cache preview 和实时 Ghostty 状态是不同对象。hold 可以保留旧像素，但不能证明旧像素对应的尺寸、PTY 状态和当前历史 generation 仍然有效。

因此可能出现以下时序：

```text
浏览器 fit -> Ghostty.resize(新 cols/rows)
             -> Provider 收到 resize
             -> agent 调用 pty.Setsize
             -> shell/TUI 仍在旧尺寸下输出或输出正在排队
             -> 浏览器按新网格解析旧/新混合字节
             -> hold/Canvas 继续覆盖旧帧
```

“旧会话历史行”首先应视为同一 persistent PTY 的旧 scrollback 或旧 presentation frame；当前 Cache v2 已按账号、selector、workspace、tab、pane 和 history generation 隔离，尚无证据证明是缓存键直接跨会话串读。但历史回放还存在一个更深层的确定性问题：原始 PTY 字节历史没有记录 resize 时间线，跨多个尺寸的历史只靠当前尺寸重放并不严格可复现。

最终修复目标是：**同一个 pane 的尺寸、PTY 输出、历史回放和 Canvas 呈现必须由同一个可验证的 resize epoch 驱动；任何迟到或身份不匹配的数据都不能写入当前 Ghostty 状态。**

## 2. 目标与非目标

### 2.1 目标

- resize 请求、PTY `Setsize`、后续输出和浏览器显示具有明确的先后关系。
- 浏览器能区分“本地已请求尺寸”和“服务端已确认尺寸”。
- 跨 PC/手机或多个浏览器连接同一 pane 时，不发生无声的尺寸互相覆盖。
- resize 中保留 last-known-good frame，但不会把尺寸不匹配的旧 Canvas 当作当前终端已就绪。
- 历史回放能表达 resize 时间线；无法表达时必须采用明确的 snapshot/fallback 语义，而不是静默产生不确定画面。
- Fast/Queue WebSocket 切换与 resize epoch 解耦：通道 generation 解决数据归属，resize epoch 解决终端几何归属。
- 继续保留现有 `history_generation`、绝对 byte cursor、Cache API v2、`writeReplay()`、最终 full render 和输入锁机制。

### 2.2 非目标

- 不引入 `tmux`、`xterm.js` 或新的终端解析器。
- 不通过清空终端、杀掉 PTY、重建 pane 或丢弃历史来掩盖问题。
- 不把 presentation hold 延长为固定等待时间，也不依赖“输出安静窗口”判断 resize 完成。
- 不把浏览器的 `lastSentCols/Rows` 当作共享 PTY 的权威尺寸。
- 不在没有协议升级和兼容策略的情况下把 `client:` PC target 套用 LightOS 实例的历史假设。

## 3. 当前链路与已确认缺口

### 3.1 当前 resize 链路

- 浏览器在 `resizePane()` 中调用 `fitAddon.proposeDimensions()`，必要时立即执行 `term.resize()`，并把新的 `cols/rows/pixel_width/pixel_height` 发给 WebSocket。
- Provider/agent 收到 `resize` 后调用 `pane.resizeWithPixels()`，最终执行 `pty.Setsize()`。
- PTY 的输出由 `readLoop()` 直接追加到 pane history，并向所有 attach client 广播；输出字节没有携带 resize epoch。
- 浏览器收到输出后按当前 Ghostty 状态解析；当前实时输出和历史回放虽已分流，但 resize 与输出没有共同序列号。

涉及的当前边界：

- 浏览器：`runtime/static/main.js` 的 `resizePane()`、`sendTerminalSize()`、presentation hold、replay/render generation。
- Provider/agent：`workspace.go` 的 WebSocket 控制、`agent.go` 的 attach 控制、`terminalPane.resizeWithPixels()`、`readLoop()/appendOutput()`。
- 浏览器终端：`runtime/static/ghostty-web.js` 的 `Terminal.resize()`、renderer canvas resize 和 viewport materialization。
- 历史缓存：`runtime/static/terminal/history/terminal_cache_v2.js` 及 `main.js` 的 cache-v2 replay。

### 3.2 已确认缺口

1. **请求与确认混淆**：前端发送 resize 后即更新 `serverCols/serverRows`，但真实 PTY 是否已应用只能通过后续 workspace/activity 观察。
2. **跨客户端最后写入者获胜**：多个 attach 共享同一个 PTY window size；当前客户端的去重字段只反映本浏览器曾发送的尺寸，无法单独证明共享 PTY 仍保持该尺寸。
3. **输出缺少 resize 边界**：PTY 字节广播没有携带“该字节在何种尺寸下产生”的 epoch，resize 前后字节可以在浏览器队列中交错。
4. **本地画面与终端状态分离**：presentation hold 保存的是 Canvas 像素，不是 Ghostty buffer snapshot；旧 frame 可能在新尺寸生效前继续可见。
5. **历史重放缺少尺寸时间线**：只保存原始 PTY bytes 和 history cursor 时，包含 TUI 重绘/换行的历史无法严格按原窗口尺寸重建。
6. **当前队列化改动有额外边界**：Fast/Queue 的 `channel_generation` 只能防止通道迟到数据写入错误 session，不能防止 resize 控制和输出跨 epoch 混合。

## 4. 设计原则

### 4.1 两个独立 generation

必须同时维护：

| 标识 | 解决的问题 | 生命周期 |
| --- | --- | --- |
| `channel_generation` | 数据来自哪个 Fast/Queue 逻辑通道 | 每次通道建立、提升、降级或替换递增 |
| `resize_epoch` | PTY 与 Ghostty 使用哪个几何版本 | 每次 pane 尺寸声明递增，跨通道保持 |

任何输出帧必须至少能验证当前 `channel_generation`；任何 resize 控制和 resize 确认必须能验证当前 `resize_epoch`。两者不能互相替代。

### 4.2 请求、应用、呈现三态分离

每个 pane 至少保留以下状态：

```text
requestedSize      浏览器最近一次测量并请求的尺寸
appliedSize        Provider/agent 已确认写入 PTY 的尺寸
presentedSize      Ghostty 最近一次成功 full render 的尺寸
requestedEpoch     最近请求的 epoch
appliedEpoch       服务端确认的 epoch
presentedEpoch     Canvas 已呈现的 epoch
```

输入就绪和 `renderReady=true` 必须要求 `requestedEpoch == appliedEpoch == presentedEpoch`，并且 replay、content、canvas backing store 都是当前 generation。

### 4.3 单一有序输出边界

对同一 pane，Provider/agent 必须让以下事件进入同一条有序序列：

```text
resize-request(epoch, size)
  -> pty.Setsize(size)
  -> resize-applied(epoch, size)
  -> output(epoch, bytes)
```

实现上不要求每个 PTY 字节都单独 flush，但必须保证：标记为 `epoch=N+1` 的输出不会先于 `resize-applied(N+1)` 被浏览器写入新终端状态；旧 epoch 的迟到输出只能被排空、丢弃并触发 resync，不能静默混入。

### 4.4 last-known-good 只用于展示，不用于状态推断

旧 Canvas、Cache preview 和 hold frame 可以作为网络或 resize 期间的视觉占位，但不能：

- 推进 `presentedEpoch`；
- 解锁输入；
- 代替 Ghostty buffer replay；
- 作为新尺寸的首帧；
- 在身份、history generation 或 resize epoch 不匹配时继续显示。

## 5. 建议协议

以下字段是设计要求，最终 wire 格式应在实现前单独冻结；字段名可按现有 JSON 风格调整。

### 5.1 浏览器 -> Provider/agent

```json
{
  "type": "resize",
  "resize_epoch": "42",
  "cols": 120,
  "rows": 32,
  "pixel_width": 960,
  "pixel_height": 640,
  "client_id": "..."
}
```

要求：

- `resize_epoch` 在同一 pane 单调递增；页面重载或 session 重建时可从 1 重新开始，但必须带新的 attach/session generation。
- Provider 不得仅按 `client_id` 信任尺寸，必须验证 pane、workspace、账号 scope 和当前 attach。
- 同一个 epoch 的重复 resize 必须幂等。
- 更旧 epoch 的 resize 必须拒绝或记录为 stale，不得回退 PTY 尺寸。

### 5.2 Provider/agent -> 浏览器

```json
{
  "type": "resize-applied",
  "resize_epoch": "42",
  "cols": 120,
  "rows": 32,
  "pixel_width": 960,
  "pixel_height": 640,
  "selector": "...",
  "pane_id": "pane-1",
  "channel_generation": "7"
}
```

后续 binary PTY 输出必须能关联到 `resize_epoch=42`。有两种可选实现：

1. 给每个 binary output frame 增加轻量 envelope，携带 epoch 和 byte cursor；
2. 在同一可靠有序流中使用 `resize-applied` 作为边界，约定其后的 binary frame 属于该 epoch。

优先选择第二种以减少每个输出帧开销，但必须在 Provider 队列 relay、Fast 通道和重连 replay 中保持一致；不得让不同通道采用无法互相验证的隐式规则。

### 5.3 历史回放中的 resize 记录

历史协议需要增加可选控制记录：

```json
{
  "type": "history-resize",
  "resize_epoch": "41",
  "cols": 96,
  "rows": 28,
  "pixel_width": 768,
  "pixel_height": 560,
  "history_cursor": "123456"
}
```

该记录表示从指定 cursor 之后开始，历史字节按新的尺寸解释。记录必须与 history generation 绑定，并参与 Cache v2 的连续性校验。

如果当前 agent 版本无法提供历史 resize 记录，不能假装历史可精确重建。兼容策略应为：

- 继续使用当前 snapshot/delta 字节协议；
- 将该次回放标记为 `geometry_unknown`；
- 保留 last-known-good frame，回放期间不显示中间帧；
- 回放完成后按当前确认尺寸执行一次 full render；
- 记录诊断事件，待 agent 支持 resize timeline 后再消除该降级。

## 6. 端到端状态机

### 6.1 正常 resize

```text
MEASURED
  -> REQUESTED(epoch=N+1)
  -> HOLD_OLD_FRAME（仅当尺寸或 canvas backing store 真正变化）
  -> PROVIDER_APPLYING
  -> APPLIED(epoch=N+1)
  -> REPLAY/OUTPUT_DRAIN
  -> FULL_RENDER_SUCCESS
  -> PRESENTED(epoch=N+1)
  -> INPUT_UNLOCKED / renderReady=true
```

### 6.2 resize 期间继续输出

- 旧 epoch 的实时字节进入 old-epoch queue；不能写入新尺寸 Ghostty。
- `resize-applied` 到达后，先按既定顺序排空或丢弃 old-epoch queue 并验证 cursor。
- 如果无法证明连续性，立即走现有 `requestSessionHistoryReplay()`，优先 delta，trim 后 snapshot。
- 新 epoch 字节只能在 Ghostty 已完成必要 resize 且 replay 状态一致后写入。

### 6.3 新尺寸请求失败

- Provider/agent 返回 `resize-error`，带 epoch、当前 applied size 和 retryable 标志。
- 浏览器不得把 requested size 当作 applied size；旧 frame 可以继续显示。
- 可恢复错误沿用连接重试；不可恢复错误保持输入锁并保留错误诊断。

### 6.4 跨客户端尺寸竞争

推荐默认策略是“单一交互尺寸所有者”：

- 当前获得输入/指针焦点的客户端成为 owner；其 epoch 递增并广播。
- 其他客户端收到 `resize-applied` 后更新本地 `server size`，但不自动把自己的本地尺寸写回 PTY，除非用户明确激活该客户端。
- 用户在另一设备点击 pane 时，先 fit 当前设备，再发新 epoch，并等待确认后解锁输入。

如果产品必须允许多个客户端同时交互，则需要 lease/TTL 和明确仲裁规则；不能继续使用最后写入者获胜的隐式语义。

## 7. 实施边界

### 7.1 Provider/agent

预计涉及：

- `workspace.go`：`terminalControlMessage`、`handleTerminalControlMessage()`、`terminalPane.resizeWithPixels()`、输出广播和 history metadata。
- `agent.go`：attach 请求、resize 控制转发、版本能力协商、`resize-applied` 回执。
- `terminal_queue.go`：队列 pane 的 resize 控制、边界帧、epoch/generation 校验。
- 可能新增独立的 `terminal_resize_protocol.go`，集中做 epoch 验证、幂等和状态转换，避免把协议逻辑继续散落在 WebSocket 分支。

约束：persistent agent 必须向旧 Provider 兼容；能力不足时明确降级到 `geometry_unknown`，不能把未知字段当已确认。

### 7.2 浏览器

预计涉及：

- `runtime/static/main.js`：拆分 requested/applied/presented size，resize ACK 处理，old/new epoch 输出队列，跨客户端 claim，presentation hold 门禁。
- `runtime/static/terminal/resize/terminal_size_sync.js`：从单客户端去重扩展为 epoch/owner/服务端确认判断。
- `runtime/static/terminal/transport/terminal_queue_connection.js`：保留 channel generation，同时透传 resize epoch 和控制帧顺序。
- `runtime/static/terminal/history/terminal_cache_v2.js`：manifest/chunk metadata 增加可选 geometry timeline fingerprint；发现 generation/epoch 不连续时拒绝拼接。
- `runtime/static/style.css`：仅调整旧 frame/preview 的显示门禁，不增加新的视觉 fallback。

### 7.3 Ghostty renderer

优先不修改 Ghostty 核心。先利用已有：

- `writeReplay()` 的解析但不渲染能力；
- renderer 在修改 Canvas 前物化 viewport；
- full render、render retry 和 canvas size 校验。

只有在验证中发现 `Terminal.resize()` 在应用 epoch 边界时无法阻止中间 render，才考虑增加一个明确的 presentation transaction API；不能通过取消 RAF 作为长期协议替代。

## 8. 分阶段执行计划

### 阶段 0：契约冻结与现场基线

1. 新增并评审精确的 resize wire protocol：字段、错误码、幂等、旧 epoch 行为、ACK 时序和能力协商。
2. 在真实设备记录窗口拖拽、手机/PC 交替激活、分屏、持续 Codex/TUI 输出时的日志：requested/applied/presented size、epoch、history cursor、channel generation。
3. 确认当前 agent 是否能提供 resize timeline；若不能，先冻结 `geometry_unknown` 兼容语义。
4. 明确 feature flag、旧 agent 兼容窗口和回退方式。

完成标准：至少得到一次可复现的最小时序，或明确记录“无法复现但协议缺口已被测试证明”。

### 阶段 1：服务端 resize epoch 与 ACK

1. 在 Provider/agent 增加 epoch 验证、幂等和 `resize-applied`/`resize-error`。
2. 将 resize 应用与输出广播串入同一有序发送边界。
3. 为 Fast 和 Queue 通道补充 channel generation 校验；旧通道控制帧不得改变新 epoch。
4. 保持旧客户端兼容：未提供 epoch 的客户端走明确 legacy 模式，并禁用新客户端的强一致门禁。

完成标准：服务端单元测试证明旧 epoch 不回退、重复 epoch 幂等、ACK 顺序稳定、resize 错误不伪装成功。

### 阶段 2：浏览器三态尺寸与呈现门禁

1. 将 `sendTerminalSize()` 的本地字段拆成 requested/applied/presented。
2. resize ACK 前保持旧 frame 或 preview；ACK 后执行当前 Ghostty full render。
3. old epoch 输出进入受控 replay/resync，不直接写入当前 Ghostty。
4. `renderReady`、输入解锁、Cache preview capture 均要求 epoch/generation/canvas 尺寸一致。
5. 继续保持“只有真实 geometry 变化才开始 presentation hold”的既有 guard。

完成标准：连续 resize 和持续输出下不会出现混合网格；旧 frame 不会推进 presented generation。

### 阶段 3：历史 geometry timeline 与兼容降级

1. agent history 增加 resize timeline 控制记录或等价 cursor metadata。
2. Cache v2 保存并验证 geometry metadata；timeline 缺失时进入 `geometry_unknown`。
3. snapshot/delta/current 三分支覆盖：同 generation 同 epoch、同 generation 跨 epoch、generation 不匹配。
4. 回放期间始终使用 `writeReplay()`，完成后一次 full render；禁止第一批字节成为首帧。

完成标准：刷新、断线重连、服务端 trim、跨设备切换后，历史画面要么可确定重建，要么明确降级并保留 last-known-good，不出现静默错位。

### 阶段 4：跨客户端 owner/lease

1. 实现当前交互客户端的尺寸 owner 记录和 epoch 广播。
2. 非 owner 客户端只更新观察状态，不自动反写 PTY。
3. 用户激活另一设备时执行 fit -> request epoch -> ACK -> full render -> unlock input。
4. owner 断线、页面隐藏、网络离线和客户端关闭时定义 owner 释放与接管规则。

完成标准：PC/手机交替点击同一 pane 不会因本地尺寸去重而停留在另一设备尺寸；不会出现双方 resize 振荡。

### 阶段 5：灰度、压测与发布

1. 默认关闭 feature flag，先在问题设备和 WebView 灰度。
2. 覆盖单 pane、双分屏、四分屏、12 pane、持续 TUI、ANSI/UTF-8、Kitty Graphics、窗口拖拽、旋转、后台恢复和离线重连。
3. 记录 resize ACK 延迟、epoch mismatch、resync 次数、Canvas presentation 延迟、主线程长任务和 PTY 输出丢弃/重放量。
4. 任何 cursor 不连续、epoch 倒退、双写、输入误投递或历史跨身份事件都立即关闭 flag 并回退。

## 9. 自动化测试计划

### 9.1 服务端/协议测试

- `resize_epoch` 严格单调；旧请求拒绝，重复请求幂等。
- `resize-applied` 必须晚于实际 `pty.Setsize` 调用；失败不得发送成功 ACK。
- ACK 与后续 output 的顺序固定；Fast/Queue 迟到 generation 不得改变当前 pane。
- 多客户端竞争时 owner/lease 规则稳定；无 owner 时拒绝隐式抢占。
- resize 与 history snapshot/delta/current、trim、agent 重启、Provider 重启交错时 cursor 连续。
- Queue broker 公平轮转、过载 resync、逻辑流替换和关闭期间 epoch 不串写。

### 9.2 浏览器状态机测试

- requested/applied/presented 三态不能互相越级。
- ACK 前旧 frame 可见但 input locked；ACK 后必须经过 full render 才显示新 frame。
- resize 连续合并只保留最新 epoch，旧 epoch 的 output 被隔离或触发 resync。
- Fast/Queue handoff 同时验证 `channel_generation` 和 `resize_epoch`。
- hidden pane、tab 切换、Canvas context lost/restored、移动方向变化和 IME resize 不会释放错误 hold。
- Cache v2 geometry metadata 缺失、损坏、跨 workspace/tab/pane 或 history generation 不匹配时拒绝使用。

### 9.3 真实设备验收

- Chromium desktop：拖拽窗口边缘时持续输出 `watch`, `top`, Codex/TUI。
- 手机 WebView：横竖屏切换、软键盘打开/关闭、同 pane 先 PC 后手机再 PC。
- 多 pane：4/12 分屏持续输出，验证可见 pane 无需点击即可更新，浏览器物理终端 WebSocket 不超过 3 条。
- 网络：resize ACK 延迟、WebSocket 断开、Provider 重启、agent preparing、离线/在线恢复。
- 画面：不得出现半行拼接、旧尺寸换行、乱码、旧 tab/pane 行或 hold 覆盖错误位置。

## 10. 可观测性与验收门槛

调试日志记录以下结构化事件即可：

```text
resize requested: pane, channel_generation, resize_epoch, size
resize applied: pane, resize_epoch, applied_size, owner
resize rejected/error: pane, resize_epoch, reason
output epoch mismatch: pane, frame_epoch, applied_epoch, cursor
history geometry: generation, timeline_present, mode
presentation committed: resize_epoch, presented_epoch, replay_generation
```

不得记录 PTY 内容、命令文本、账号 scope 或完整票据。建议指标：

- resize ACK 延迟 p50/p95；
- epoch mismatch 和 resync 次数；
- requested/applied/presented 长时间不一致数量；
- resize 后首次正确 full render 延迟；
- 跨设备 owner handoff 成功率；
- 历史 geometry timeline 缺失率；
- 旧 frame 实际显示时长和错误帧拦截次数。

发布前最低门槛：

- 相关 Go/Node 测试全部通过，`go test -race ./...` 通过；
- `node --check`、`git diff --check` 通过；
- 真实桌面和移动设备完成上述验收矩阵；
- 没有未解释的 epoch mismatch、cursor gap、双写或跨身份数据；
- 新协议能力不足时能明确降级，不能静默伪装为已确认尺寸。

## 11. 风险与回退

| 风险 | 影响 | 缓解/回退 |
| --- | --- | --- |
| 旧 agent 不理解 epoch | 新客户端无法获得 ACK | 能力协商后进入 legacy/geometry_unknown；保留旧通道 |
| PTY 输出无法精确标记 resize 边界 | 仍可能需要重放 | 由 Provider 串行化 ACK/输出；不连续时强制 delta/snapshot |
| 历史缺少 resize timeline | 历史 TUI 不能严格复现 | 隐藏中间帧，按当前确认尺寸最终 full render，并记录降级 |
| 多客户端频繁抢尺寸 | TUI 反复重绘 | owner/lease、激活才抢占、短时间内去重并显示诊断 |
| Queue handoff 与 resize 同时发生 | 双写或迟到数据 | 双 generation 栅栏；旧通道关闭确认前不接收新流 |
| Canvas hold/preview 覆盖层残留 | 视觉上像旧会话 | 所有覆盖层绑定 epoch/generation，呈现提交时一次性销毁 |

回退只能关闭新 resize-epoch feature flag，回到当前已存在的单 pane 通道和连接调度；不能回到无限 WebSocket 或清屏重建 pane 的临时方案。

## 12. 实施完成后的文档要求

代码修复完成后必须：

1. 在 `docs/FIX_HISTORY.md` 末尾新增条目，记录现象、触发条件、根因、协议变更、guard 和真实设备验证结果。
2. 若 resize epoch 或 geometry timeline 成为稳定协议，更新 `AGENTS.md` 的架构基线和长期 guard。
3. 若 Queue 协议字段发生变化，同步更新 [WEBSOCKET_CONNECTION_MULTIPLEXING_PLAN.md](WEBSOCKET_CONNECTION_MULTIPLEXING_PLAN.md) 和独立 protocol spec。
4. 发布前确认静态资源、Service Worker、WASM、字体和 LPK 内容寻址版本均已更新并通过构建校验。

## 13. 本轮执行状态（2026-08-23）

已完成阶段 1 的兼容最小闭环及阶段 2 的前端呈现门禁：

- 服务端/agent 支持字符串 `resize_epoch`、单调校验、重复幂等、冲突/过期错误、`resize-applied` ACK，以及 ACK 与后续输出的有序发送边界。
- 历史启动帧声明 `resize_protocol=epoch-v1` 并携带当前几何；旧 agent 或 `client:` 目标缺少声明时，浏览器进入明确 legacy 模式，不永久等待 ACK。
- 浏览器区分 requested/applied/presented epoch；ACK 前不更新 server size、不解锁普通输入、不提交新 presentation frame，ACK 后必须经过 full render 才推进 presented。
- 增加 Go 协议/顺序测试和浏览器静态 guard；`go test ./...`、`go test -race ./...`、`node --check` 和 `git diff --check` 已通过。

尚未完成的阶段保持原计划：PTY 历史 resize timeline、Cache v2 geometry metadata、跨 PC/手机尺寸 owner/lease，以及真实桌面/WebView 持续输出验收。当前实现不能把原始历史字节跨多种尺寸严格重建的能力表述为已解决。
