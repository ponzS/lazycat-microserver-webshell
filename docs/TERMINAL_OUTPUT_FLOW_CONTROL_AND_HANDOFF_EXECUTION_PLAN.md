# 终端输出流控与 Fast/Queue 交接执行计划

状态：阶段 0、阶段 1 和阶段 2 的不改协议格式第一批实现完成；等待完整自动化回归和真实设备手动验收

最后更新：2026-08-26（第一批输出流控实现）

## 1. 文档定位

本文只处理两类问题：

1. 高频输出或单次提交块过大时，浏览器主线程被同步解析和渲染占用，Queue ACK、WebSocket 事件、输入和健康检查停顿。
2. 切换 tab 或 pane 时，唯一 Fast 槽位被抢占，Fast 与 Queue logical stream 交接不连续，旧会话出现短暂停顿或错误显示 `reconnecting`。

本文不重新设计历史恢复、Canvas presentation transaction 或 resize 原子性。相关约束和已有实现位于：

- [TERMINAL_REPLAY_AND_RESIZE_EXECUTION_PLAN.md](./TERMINAL_REPLAY_AND_RESIZE_EXECUTION_PLAN.md)

两个计划共享以下基础，但独立验收：persistent Agent/PTY、服务端 history、绝对 cursor、generation、Cache v2、Ghostty WASM、Fast/Queue/legacy 协议和现有连接调度器。

## 2. 为什么单独处理

这不是前两个问题的简单子任务：

- replay/presentation 解决“什么时候允许用户看到终端画面”；
- resize 解决“什么时候改变 PTY geometry，以及如何限制 SIGWINCH 放大”；
- 本计划解决“数据生产速度如何受消费者控制，以及 logical transport 如何无损交接”。

三者会并发发生，但故障判据不同。输出背压不应触发 history replay，主动 Fast 抢占不应显示网络断开，Canvas 最终绘制也不应成为 Queue ACK 的条件。单独文档可以让每项改动都有明确的 owner、指标和回退开关。

## 3. 方案依据与最终决策

公开 Web 终端实现和传输协议体现了几个稳定惯例：

- 终端解析使用有限的 byte/time 工作窗口，连续数据通过后续 event loop 继续处理；渲染使用 `requestAnimationFrame` 合并刷新。
- 浏览器 WebSocket 没有足够的终端消费背压语义。`bufferedAmount` 只表示浏览器发送端积压，不能说明 Ghostty 已经解析了多少输入。
- 服务端应在消费者变慢时暂停发送或暂停该 attach 的转发，而不是销毁 PTY/session。
- SSH channel 的窗口确认机制表明，应用层 credit/ACK 适合表达“消费者已经处理到哪个 cursor”。

最终采用四层模型：

```text
persistent PTY/history
  -> Provider 按 pane 有界队列和可选 credit
  -> 稳定物理 WebSocket 上的 logical stream
  -> 浏览器 byte + time budget 有序解析
  -> RAF 合并 Canvas 绘制
```

明确不采用：

- 不提高硬上限来掩盖消费者持续落后；
- 不因为单条大消息直接关闭连接并 replay；
- 不把 Canvas 绘制完成作为传输 ACK 条件；
- 不为修复该问题替换 Ghostty、引入 `xterm.js` 或 `tmux`；
- 不让浏览器关闭、tab 切换或 Fast 抢占销毁服务端 PTY/session。

## 4. 必须保持的边界

- 服务端 Agent、PTY、history 和 cursor 是权威；浏览器队列只是传输副本。
- Queue `LCQ1` 和 Fast 原始 payload 的既有字节格式保持兼容。
- Fast modern、Queue modern 可以通过能力协商启用新 flow-control 字段；legacy 和旧 Agent 继续走原协议。
- 所有输出仍按 pane identity、connection epoch、channel generation、history generation、sequence 和 cursor 校验。
- 输出暂停、logical handoff 和浏览器 drain 不能静默丢字节。无法继续消费时必须保留服务端 history，之后通过 cursor 范围恢复。
- `Terminal.write()` 每个解析批次保持同步调用，确保 echo、DSR/DA、generated response、replay commit 和输入顺序不变。
- Canvas、held frame、render suppression 和 presentation gate 仍由 replay/resize 计划负责；本计划只产生 pending render，不绕过其提交条件。
- 错误日志不得记录 PTY 内容、命令文本、账号 scope、token、cookie 或票据。

## 5. 目标架构

### 5.1 输出数据路径

```text
Agent PTY output
  -> history append / cursor assignment
  -> Provider pane queue
  -> optional credit check
  -> fixed-size binary frame
  -> WebSocket message validation
  -> pane output queue
  -> bounded Ghostty parse drain
  -> pending render
  -> RAF / presentation commit
```

WebSocket message handler 只做协议校验和入队，不进行无界的 Ghostty 解析、Canvas 绘制或 history replay。

### 5.2 背压层次

1. **浏览器解析预算**：每次 drain 同时受 byte budget、entry budget 和约 8-12ms CPU budget 限制；批次之间通过 macrotask 或 RAF 让出主线程。
2. **Queue turn ACK**：ACK 只确认该 turn 的全部字节已按序进入 Ghostty 解析状态，不要求 Canvas 已绘制。
3. **modern credit**：客户端报告已消费 cursor/sequence 或可接受的字节额度，Provider 在额度用尽时暂停该 pane 的转发。
4. **服务端有界缓冲**：soft watermark 触发暂停或回收 credit；hard limit 只保护 Provider 内存，触发后保留 last-known-good frame 并进入可恢复 resync。
5. **底层 WebSocket/TCP 背压**：legacy 路径继续依靠现有 socket 写阻塞和 bounded buffer，不改变协议格式。

### 5.3 单帧边界

- Fast modern 和 Queue modern 的 binary payload 初始限制为 512 KiB；live output 仍以更小的 Agent/history chunk 进入队列。
- 服务端拆分必须保持 cursor、sequence、checksum 和 history generation 连续。
- Queue broker 的单轮 byte/time budget 不得被单个大 entry 绕过。
- 浏览器收到超过 batch 上限的合法消息时先拆分入队，不能因为消息本身较大就触发 replay。

## 6. Fast/Queue handoff 模型

切换 tab 或 pane 是优先级变化，不等于网络故障。每次逻辑交接包含：

```text
handoff begin
  -> freeze old logical stream boundary
  -> confirm old lease close or detach
  -> install new Fast/Queue logical stream
  -> replay/cursor fence becomes continuous
  -> enable input for current lease
  -> handoff commit
```

每次 handoff 必须绑定：

```text
handoff ID
lease ID
connection epoch
channel generation
history generation
cursor fence
```

要求：

- 旧 open、close、retry、replay complete 和 Queue reconcile 回调必须验证 handoff ID/generation。
- 旧 close 回调不得关闭或覆盖新 logical stream。
- Fast 被主动抢占时保留旧 pane 的 last-known-good frame，状态显示为 `handoff` 或 `queued`，不显示 transport `reconnecting`。
- Queue 物理 WebSocket 保持稳定，只更新 logical subscription；物理 close 确认前不得创建竞争 transport。
- 快速连续切 tab 使用 latest-only reconcile，只执行最终优先级目标。
- handoff 期间输入锁定或排队，不得写入已失效的 lease/channel generation。
- handoff 失败后才进入 transport retry 或 history resync，并保留服务端会话和历史。

## 7. 执行阶段

### 阶段 0：证据和基线

不改变行为，补齐以下指标和事件的相对时间：

```text
WebSocket message -> enqueue latency
output queue depth/peak/bytes
output drain bytes/entries/duration
Queue turn-complete -> turn-ACK latency
credit pause/resume events
long task duration
input event latency
Fast lease acquire/release
handoff begin/commit/failure duration
stale close/open/retry callback count
logical stream replay range
physical WebSocket open/close count
```

日志只使用 pane/session 摘要、connection epoch、channel generation、history generation、handoff ID 和相对时间。

完成标准：能区分主线程拥塞、Queue ACK 等待、服务端缓冲高水位、真实 WebSocket 断开和 Fast/Queue handoff 空窗。

### 阶段 1：浏览器协作式输出 drain

- [x] 将 Queue `queue-turn-complete` 从无界 `force` 排空改为有界 byte/entry/time drain，并在对应 turn 已进入 Ghostty 后再发送 ACK。
- [x] 浏览器端先拆分合法的大输出消息；达到队列硬上限时才进入 overload/resync。
- [x] 增加 ACK、输入和 drain 延迟测试，验证 `Terminal.write()` 的同步批次语义不变。

完成标准：单个 Queue turn 不再长时间阻塞输入、ACK、tab 切换和健康检查。

### 阶段 2：服务端固定分片和有界背压

- [x] Agent replay 与 Queue binary output 固定为 512 KiB 分片，保持 cursor、sequence 和 checksum 连续。
- [x] 修正 Queue broker 在单个大 entry 下绕过轮预算的边界。
- [ ] 设计并协商可选的 pane credit/consume confirmation，不改变 LCQ1/Fast legacy 字节格式。
- [ ] credit 用尽时暂停该 pane 转发，恢复后从连续 cursor 继续。
- [ ] 覆盖 modern、legacy、旧 Agent fallback 和旧客户端混合运行。

完成标准：生产速度超过消费速度时服务端会暂停或降低转发速度，而不是频繁关闭 logical stream；历史和 cursor 不丢失。

### 阶段 3：Fast/Queue handoff 原子化

- [x] 现有 topology epoch + Fast attemptID、scheduler leaseID、connection epoch 和 channel generation 已覆盖 logical handoff 的异步回调 fence。
- [x] 主动 `promote_to_fast`/`tab_priority_changed` 已与 transport `reconnecting` 分离，保留 `parked`/`connecting` 状态。
- [x] Queue physical WebSocket 在 logical subscription 交接时保持复用。
- [ ] 增加快速连续切 tab、旧 close 回调和输入锁的端到端压力测试。

### 阶段 4：与 replay/resize 计划联调

本阶段不复制前一计划的实现，只验证交叉边界：

- resize 输出 settle 使用阶段 1 的有界 drain，不得重新引入无界 force flush；
- replay 输出不能被 live output 饿死，也不能让 ACK 越过 cursor 边界；
- handoff/replay 期间继续使用已有 render suppression 和 last-known-good frame；
- resize、replay、handoff 并发时，旧 connection/channel/resize generation 的数据必须被丢弃或重新同步；
- Queue ACK 不等待 Canvas presentation，presentation commit 不推进传输 ACK。

完成标准：四类状态可以用日志独立解释，且不会互相错误推进 ready、cursor 或 presentation 状态。

### 阶段 5：测试、灰度和设备验收

1. 单条大消息拆分、单个大 Queue entry、soft/hard watermark 和 credit pause/resume。
2. Queue turn ACK 边界、ACK 超时、重复 ACK、stale ACK 和 cursor gap。
3. Fast modern、Fast legacy、Queue modern + ACK、Queue legacy 和旧 Agent fallback。
4. Fast 旧 close 回调覆盖、新 stream、快速连续切 tab、隐藏 pane 和输入锁。
5. 持续 TUI 输出、pi/Codex fullscreen、普通 shell、resize 并发和字号变化。
6. 桌面浏览器、Android WebView、Lazycat WebView、低配置设备和多设备共享 PTY。
7. 通过 feature flag 灰度，观察 long task、input latency、ACK latency、resync rate、handoff duration、memory peak 和物理连接数量。

## 8. 验收标准

### 高输出和背压

```text
单条合法大消息先拆分，不因消息大小直接 replay
Queue turn 不执行无界 force flush
每次 drain 同时受 byte、entry、time budget 限制
Queue ACK 只确认已按序进入 Ghostty 的 turn 边界
消费变慢时优先暂停/回收 credit，不丢服务端历史
4 MiB 只作为内存安全断路，不作为普通拥塞路径
高输出期间输入、ACK、心跳和 tab 切换仍获得调度机会
```

### Fast/Queue handoff

```text
主动 Fast 抢占不显示 transport reconnecting
handoff 具有 ID、lease、epoch、generation 和 cursor fence
旧 close/open/retry 回调不能覆盖新 logical stream
快速连续 tab 切换只收敛到最新目标
旧 pane 最终进入 Queue 或重新获取 Fast
物理 WebSocket 未关闭时不创建竞争 transport
```

### 兼容与会话完整性

```text
Queue LCQ1 和 Fast 原始 payload 字节格式兼容
legacy 和旧 Agent fallback 可继续恢复
关闭前端不销毁 Agent/PTY/session
history、cursor、generation 和 checksum 不丢失
跨 pane、tab、account、workspace 的 identity 隔离保持
```

### 可观测性

```text
能够区分主线程拥塞、正常背压、logical handoff 和真实网络故障
可以测量 output drain duration、Queue ACK latency、input latency 和 long task
可以测量 handoff begin/commit/failure 和 stale callback
错误日志不包含 PTY 内容或凭据
```

## 9. 风险与回退

| 风险 | 处理方式 |
| --- | --- |
| modern credit 破坏旧客户端 | 能力协商成功后才启用；legacy 保持原协议 |
| credit 暂停导致 Agent 上游阻塞 | Agent 继续保存 history；只暂停该浏览器 attach 的转发 |
| 输出预算过小导致延迟增加 | 根据 input/ACK latency 调整 byte/time/entry budget，不直接提高 hard limit |
| hard limit 仍触发 resync | 保留 last-known-good frame，记录原因，按服务端 cursor 恢复 |
| ACK 过早导致 cursor 不一致 | ACK 绑定 received/applied cursor、sequence 和 turn boundary |
| Fast handoff 误报网络故障 | 独立 `handoff`、`queued`、`output_draining`、`transport_reconnecting` 状态 |
| 旧 close 回调覆盖新 stream | 所有异步回调验证 handoff ID、lease ID、epoch 和 generation |
| 新 flow-control 状态机异常 | feature flag 关闭新流控或 handoff，仅回退逻辑，不销毁 PTY、session 或 history |

## 10. 修改和验证约束

- 修改 `runtime/static/main.js` 后运行 `node --check runtime/static/main.js`。
- 协议、Agent、Queue 或 scheduler 改动必须增加 Go/Node contract 或 unit test。
- 每次真正 Bug 修复同步追加 `docs/FIX_HISTORY.md`；本文件的方案整理本身不新增历史修复条目。
- 不改变 Queue `LCQ1`、Fast 原始 payload 和 legacy fallback 的兼容语义。
- 完整回归前不覆盖定制 `runtime/static/ghostty-web.js`，发布构建继续只自动同步已验证 WASM。
- 未完成 Lazycat 宿主、移动 WebView、低配置设备和多设备测试前，不把自动化测试通过视为最终完成。
