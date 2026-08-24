# WebShell 两类终端问题修复方案

## 1. 当前结论：本质上是两个问题

本方案已按下述边界执行完成。文档保留原始问题分析、强制不变量和验收步骤，实际实现与验证状态见文末“执行结果”。

上一轮问题不能继续作为一个“历史字节缺口”处理。用户实际遇到的是两个独立问题：

| 问题 | 用户看到的现象 | 问题性质 | 主要修复边界 |
| --- | --- | --- | --- |
| **问题一：跨会话历史污染** | 当前 tab/pane 出现其他 tab、其他 pane 或旧会话的历史行、乱码 | 数据正确性和会话隔离 | session stream、队列、异步回调、Ghostty runtime 的身份隔离 |
| **问题二：操作时看到 PTY 重放过程** | resize、字体变化、切 tab 后，内容从顶部逐步滚到底部，像重新执行了一遍历史 | 显示原子性和用户体验 | replay/重建期间隐藏中间帧，只提交完成后的完整帧 |

问题一解决“显示的内容必须属于当前会话”；问题二解决“即使内容属于当前会话，切换过程中也不能让用户看到重放动画”。两者必须分别诊断、分别修复、分别验收。

目前不能仅凭“调整窗口大小或字体后画面发生变化”判断发生了 PTY 历史重放。需要先区分以下几种路径：

```text
本地几何变化：term.resize、字体测量、Canvas backing store 重建
PTY 实时重绘：PTY 收到窗口尺寸变化后，应用自行产生新的 live 输出
真正历史重放：断线/重新 attach/cursor 缺口触发 history replay 或 snapshot
呈现失败：字节已到达，但 Ghostty scrollback 或 Canvas 没有完整绘制
会话污染：其他 tab/pane/session 的异步数据写入当前终端
```

“resize 或刷新后丢失历史又出现”可能是问题一中的数据缺口，也可能只是问题二相关的呈现中间态。两者的修复点不同，不能继续用单一的 replay 假设直接改行为。

## 2. 两个核心问题与强制不变量

### 2.1 问题一：跨会话历史污染

#### 目标

当前 session 只能接收、排队、写入和呈现当前 session 的字节。旧 tab、旧 pane、旧 WebSocket、旧 Queue logical stream 的迟到数据不能进入当前 Ghostty。

#### 根因范围

重点检查以下边界是否复用了不应共享的状态：

```text
WebSocket/Queue 回调是否只按 tab index 或 pane index 归属
旧 attach 的异步回调是否仍能写入新 attach
Fast/Queue 切换是否复用了旧 logical stream
Cache/replay 回调是否缺少 session/generation 校验
多个 pane 是否共享 output buffer、Ghostty runtime 或 replay 标志
```

#### 修复原则

每个逻辑终端必须拥有独立的 session stream、队列、Ghostty runtime、replay 状态和呈现状态。chunk/control/异步回调只携带必要的 session、generation、cursor 元数据用于校验，不给每个字节追加标签。

收到身份不匹配的数据时必须丢弃并记录原因，不能“先写进去再判断”。只重建当前 session，不能清空其他 pane 或共享物理连接。

#### 强制不变量

```text
identity 不匹配的数据永远不能写入当前 Ghostty
旧 generation 的异步回调永远不能改变当前 session 状态
一个 pane 的 cursor gap 不能清空或重置其他 pane
Cache、Queue、Fast 和 replay 必须属于同一个 session generation
```

### 2.2 问题二：用户看到 PTY 重放过程

#### 目标

窗口大小、字体大小、主题、分屏布局和切 tab 等操作，视觉上必须像初始化时一样：用户只看到最终正确画面，不能看到 PTY 历史字节从顶部逐行滚到底部，也不能看到清空、半帧、黑块和逐步补齐。

#### 必须区分的三条路径

```text
本地几何变化：term.resize、字体测量、Canvas backing store 重建
PTY 实时重绘：PTY 收到窗口尺寸变化后，应用自行产生新的 live 输出
真正历史重放：断线/重新 attach/cursor 缺口触发 history replay 或 snapshot
```

PTY 因 `SIGWINCH`/`Setsize` 产生的输出属于当前 session 的 live output，不应被误归类为历史 replay；但在最终帧准备好之前，同样不能把 replay 中间态暴露给用户。

#### 强制不变量

几何或 tab 操作默认只允许执行本地布局和渲染流程：

```text
允许：term.resize、重新 fit、发送 PTY resize control、full render
禁止：history replay、snapshot/delta 请求、关闭或重连 WebSocket
禁止：resetTerminalForHistoryReplay、writeReplay、清空 Ghostty terminal model
```

这不是要求 PTY 停止输出，而是要求输出先进入当前 session 的受控队列，不能在过渡期间直接成为用户可见的半成品画面。

#### 统一的视觉提交策略

resize、字体变化、切 tab 和真正 replay/resync 都采用同一种“准备完成后一次性提交”策略：

```text
操作开始：保留身份匹配的 last-known-good 帧，不清空、不让画布变黑
操作期间：新字节可以接收和排队，但不直接显示逐行写入过程
没有旧帧但有可信 Cache preview：显示 preview，占位但不推进终端状态
两者都没有：隐藏 live canvas，显示稳定的非终端占位
只有几何应用完成、数据边界明确、viewport 完整物化且 full render 成功后才一次性提交新帧
```

占位、旧帧和 preview 不能推进 `received/applied/presented cursor`，不能解除 replay barrier，也不能解锁输入。

问题二的修复重点不是阻止 PTY 产生输出，而是阻止未完成的 replay/render 结果进入用户可见区域。

### 2.3 两个问题的共同约束

问题一保证“内容属于谁”；问题二保证“何时让用户看到内容”。两者不能用同一个布尔值或同一个全局队列混合处理：

```text
session identity/generation/cursor：负责数据归属和顺序
replay barrier/render gate：负责用户可见性和提交时机
```

## 3. 先做诊断，再修行为

第一阶段只增加不改变行为的结构化事件日志。每个事件至少记录：

```text
tab_id / pane_id / session identity 摘要
channel_generation / attach_generation / history_generation / resize_epoch
requested、applied、received、queued、applied、presented cursor
```

需要覆盖的事件：

```text
font_change
theme_change
term.resize
resize_request
resize_applied
history-replay-start
resetTerminalForHistoryReplay
writeReplay
history-replay-complete
socket_close
socket_reconnect
queue_recycle
full_render_start / full_render_complete / full_render_failed
viewport_materialization_failed
```

禁止记录 PTY 内容、命令文本、账号隐私和完整票据。

现场必须能根据同一 session 的时间线判断是哪条链：

```text
resize -> term.resize -> PTY live redraw
resize -> socket reconnect/queue recycle -> history replay
resize -> 前端 reset/replay 调用
resize -> render/viewport 失败但没有 replay
```

在没有这条证据之前，不修改 replay 触发条件。

## 4. 两个相互独立的状态机

### 4.1 Geometry/Presentation 状态机

只处理显示尺寸和画面提交：

```text
requested_fit -> applied_fit -> presented_fit
                     |
                 resize_epoch
```

职责：本地 `term.resize()`、PTY resize ACK、Canvas backing store、viewport 完整性检查和 full render。几何事件不得写入 history generation，也不得改变 replay cursor。

### 4.2 History Synchronization 状态机

只处理 attach、断线、cursor 缺口和 generation 不一致：

```text
detached -> attaching -> replaying -> live
                         |             |
                         +-> resync <-+
```

只有以下条件才允许从 `replaying/resync` 进入 `live`：

```text
session identity 和 generation 匹配
历史与实时 cursor 连续
队列中的输出已按序进入当前 session
目标 viewport 的可见行全部物化
full render 成功
```

任何 geometry 事件都不能直接把状态机带入 `replaying`。

## 5. 会话隔离与 cursor 规则

每个 session 保存独立的：

```text
expected_cursor
received_cursor
queued_cursor
applied_cursor
persisted_cursor
presented_cursor
channel_generation
attach_generation
history_generation
```

chunk 不需要逐字节标签，但必须能验证其所属 session 和连续区间。接受条件为：

```text
identity 匹配
history_generation 匹配
start_cursor == 当前 expected_cursor
end_cursor > start_cursor
区间长度与 payload 字节长度一致
```

不满足条件时不能静默跳过或写入 Ghostty：

1. 标记当前 session 的 `cursor_gap` 或 `identity_mismatch`。
2. 暂停该 session 的可见提交，保留 last-known-good 帧。
3. 优先请求 delta；服务端 trim 或 generation 不匹配时请求 snapshot。
4. 仅重建当前 session 的 runtime 和队列，不能清空其他 pane 或共享物理连接。

## 6. Replay、实时输出和队列边界

每次 attach/replay 使用明确的 barrier：

```text
attach identity
-> history-replay-start
-> cache/agent 历史
-> history-replay-complete
-> 解除 barrier
-> live output 按 cursor 追加
```

replay 期间到达的实时字节可以进入当前 session 的有界队列，但不能直接写入当前屏幕，也不能让第一批实时字节成为首帧。Queue/Fast 通道切换必须保留同一 session identity 和 generation，不能因为切换通道而复用旧逻辑流的回调。

## 7. 历史缓存和黑色空白区域

Cache 采用 commit-last 语义：chunk 校验完成后才写 manifest；读取时按 cursor 区间验证连续性。缺块、重叠块、重复块和跨 generation 块统一视为 cache miss，回退到 agent snapshot/delta，不拼接部分缓存继续展示。

黑色区域视为“未确认的 viewport”，不是有效终端内容。提交画面前验证：

```text
可见 scrollback 行索引连续
每一行已物化
Canvas backing store 与当前 fit 匹配
render generation 与 session generation 匹配
content generation 对应 applied_cursor
```

校验失败时保留上一帧或稳定占位，事件驱动重试 full render。失败帧不得推进 `presented_cursor`、`renderReady` 或“已完成”状态。resize、切 tab、刷新和 Canvas context 恢复必须复用同一个 render gate。

## 8. 分阶段执行计划

> 以下阶段已完成实现；真实 LightOS WebView 中的持续 TUI、拖拽 resize 和快速切 tab 仍需在目标设备上做最后的视觉验收。

### 阶段 A：诊断账本（无行为变化）

增加事件时间线、generation、cursor 和 viewport 结果日志，先确认问题属于 replay、live redraw、cursor gap、identity mismatch 还是 viewport hole。

完成标准：一次现场问题可以被归类，并能定位第一个错误事件。

### 阶段 B：会话/流隔离

为 Fast、Queue、Cache、replay 回调和 Ghostty 写入增加统一身份校验；旧 generation 的回调直接丢弃；不连续 cursor 进入当前 session 的 delta/snapshot resync。

完成标准：旧 tab/pane/channel 的数据无法写入当前 Ghostty，缺口不再静默变成黑块。

### 阶段 C：Replay 显示门禁

将 replay 生命周期与 Canvas 可见性绑定。保留旧帧或身份匹配的 preview，直到 replay 完成、数据连续、viewport 完整且 full render 成功；任何中间状态不对用户显示。

完成标准：切 tab、刷新、断线恢复期间不会显示清空画面、半帧或 PTY 重放过程。

### 阶段 D：Geometry 与 PTY resize 解耦

确认 `resizePane`、字体变化和 tab 激活只走 Geometry/Presentation 状态机。PTY resize control 单独发送并等待 ACK；ACK 后产生的内容按当前 session 的 live cursor 处理。除非诊断明确发现 replay 链，否则不触碰 history 状态。

完成标准：窗口/字体变化不会触发 replay、socket reconnect 或 runtime reset；PTY 应用自身的实时重绘仍可正常显示。

### 阶段 E：验收与性能回归

覆盖持续 `watch`/`top`/全屏 TUI、快速拖拽窗口、反复改字体、切 tab/pane、向上滚动历史、刷新、断网重连、Queue/Fast 切换、agent/provider 重启以及手机/PC 交替激活。

## 9. 性能与加载速度边界

方案不要求逐字节标签，不复制完整历史，也不要求每次 resize 重新 replay。正常几何变化只做本地 fit、一次 resize control 和必要的 full render。

诊断使用整数 cursor、generation 和短事件记录；不记录 payload。replay 阶段不做中间 Canvas render，viewport 失败使用事件驱动重试，不使用高频全局定时器。单个 pane resync 不应关闭其他 pane 共用的物理连接。

需要单独监控：

```text
首次可呈现延迟
resize ACK 延迟和 resize 后 full render 延迟
history replay 次数与持续时间
cursor_gap/cache_hole/identity_mismatch 次数
viewport/full render 失败与重试次数
replay 期间 Canvas render 次数
Queue 物理连接数和单 pane resync 次数
```

## 10. 验收矩阵

| 场景 | 必须观察到 | 禁止观察到 |
| --- | --- | --- |
| 窗口 resize | 本地 fit、resize control、PTY live redraw | replay、socket reconnect、runtime reset |
| 字体变化 | 重新测量和 full render | history replay 或旧字节混入 |
| 切 tab | 直接呈现该 tab 的有效帧或稳定占位 | 黑屏，点击后才首次显示，其他 tab 内容 |
| 向上滚动历史 | 连续历史行 | 占行高的黑色空洞 |
| 断线重连 | 当前 session 的 replay/resync，完成后一次性显示 | 显示 replay 中间态或跨 session 内容 |
| Cache 不连续 | 明确 cache miss，回退 agent | 拼接部分 cache 后显示假完整历史 |

最终必须满足：

```text
没有静默 cursor 缺口
没有跨 session 字节写入
几何变化不触发历史 replay
没有未确认 viewport 被提交为完整画面
没有因单 pane 缺口清空其他 pane
```

## 11. 执行前置条件

在阶段 A 的诊断结果出来前，不再增加“resize 后强制 replay”“resize 后清空并重建终端”或“每个字节加标签”类改动。阶段 B/C/D 应根据实际事件链选择最小改动点，并分别增加回归测试和 `docs/FIX_HISTORY.md` 记录。

## 12. 执行结果（2026-08-24）

- 阶段 A：已加入每个 pane 最多 96 条的终端事件时间线，覆盖身份、generation、cursor、resize、replay、Queue recycle 和 full-render 关键事件。
- 阶段 B：已在多路复用终端最终写入者增加 `pane_id`、`stream_id`、`channel_generation` 二次门禁；身份不匹配的控制帧和二进制帧在写入 Ghostty 前丢弃，并保留当前会话的最后有效帧后重连。
- 阶段 C/D：已加入 presentation hold 和 resize fence。epoch-aware 连接在服务端 resize ACK 前保持旧网格；ACK 后排空旧阶段输出，再切换本地网格并提交一次 full render。legacy 连接继续兼容旧路径。
- 后续补强：针对 resize ACK 后 PTY 因 `SIGWINCH` 产生的实时全屏重绘，增加 120ms 静默、800ms 最大时长的 `resize_output_settle` 屏障。期间输出正序解析但使用 `writeReplay()` 抑制中间绘制，屏障结束后只提交一次最终 full render。
- 回归验证：`node --check runtime/static/main.js`、98 项终端 Node 测试、`go test ./... -count=1`、`go test -race ./...`、`git diff --check` 均通过。
- 可测试包：已生成 `cloud.lazycat.webshell.lcmd-v1.0.33.lpk`，SHA-256：`62f6b5a990c521d1025d00ea5127e0584fe9b74fbb46a72de41b005e7417132f`；包内 content revision 为 `b61ffd07b15c04a871f8c4cbeb751b740086ca599d2d0b2c5ccf8e86933453c5`。
- 待现场验收：真实 LightOS WebView 中持续 TUI、快速拖拽 resize、反复调整字号、快速切 tab/pane、上滚长历史和刷新/重连。验收时应确认不出现跨会话内容、顶部滚到底部的 replay 过程、黑屏或点击后才显示。
