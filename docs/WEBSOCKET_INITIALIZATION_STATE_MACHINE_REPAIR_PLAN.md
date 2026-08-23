# WebSocket 初始化状态机修复方案

状态：已实施，待目标设备真机验收。

本文记录目标设备在单 tab、32 分屏及多 tab 场景下的初始化失败修复方案，补充 [连接复用总体方案](WEBSOCKET_CONNECTION_MULTIPLEXING_PLAN.md)。浏览器端初始化的状态归属和迁移规则以本文为准，优先于首版实现说明。

实施状态（2026-08-23）：浏览器已引入页面级 `TerminalTopologyController` 作为容器目标 Fast/Queue 拓扑的唯一所有者；当前为单 Fast transport + 单 Queue transport，Queue physical transport 支持空 logical stream 保活，Queue pane 启动使用有限 latch 结算，后台 tab pane 在 replay/cursor 连续后不等待不可测量 Canvas，未测量 pane 通过有限布局确认链自动进入初始化。自动化验证已覆盖严格 Fast -> Queue 顺序、跨 tab 全局 FIFO、tab 切换不重建物理 transport、32 pane、延迟测量、陈旧回调、Fast 提升、Queue FIFO 超时和稳定监视器 slot。尚未完成目标 Android WebView、Lazycat WKWebView 与桌面浏览器的 3/12/32 分屏实机验收。

> 本文早期关于 Fast B、两条直连和 3 条物理连接的描述是历史方案。当前普通容器目标只允许 `Fast -> Queue`，`client:` 独立目标仍使用自己的直连调度。

## 1. 已确认边界

故障发生在浏览器端初始化编排，不在 persistent agent 的会话归属，也不在 Fast/Queue 的基础回放能力。

- 点击某个 pane 后，它可以快速升入直连通道、回放、渲染并接受输入，说明基础 WebSocket、缓存、回放和渲染链路本身可用。
- 首次初始化时，直连通道 1/2 会在已启用、已关闭、连接中之间反复切换；这是浏览器真实关闭，不是监视器单纯显示错误。
- 32 个可见 pane 时，只有少数 Queue pane 达到首帧，后续 pane 可以永久黑屏，且直到点击前都没有独立的连接状态。
- persistent agent 保持不变。普通容器浏览器最多保留一条页面级直连物理 WebSocket和一条页面级队列物理 WebSocket；tab 切换只替换逻辑 stream，不引入 HTTP 轮询或周期性重建 pane WebSocket。

## 2. 根因

### 2.1 连接拓扑没有唯一所有者

当前全局 demand reconcile 可由 pane 测量、回放完成、最终渲染、激活、焦点和连接健康检查触发。每次 reconcile 都会更新 generation，并可能释放当前未被选为 Fast 的 pane。稳定 slot 变量只能减少候选重排，不能拥有整个生命周期。

因此一个异步中间状态可以用 bootstrap 原因关闭仍有效的 Fast lease，另一个回调又开始或更新另一条 Fast lease，形成观测到的直连 1/2 反复抖动。

### 2.2 Queue FIFO 会被一个未结算 pane 永久阻塞

当前 Queue FIFO 的单个任务从缓存准备开始，一直持有到逻辑订阅、PTY 回放和最终 Canvas 首帧完成。后续任务只有在当前 pane 的 startup waiter 结算后才会开始。

只要某个 pane 没有触发最终渲染回调，同时也没有关闭或抛错，该任务就永远不会结算。后续 pane 没有逻辑 Queue 流，也没有独立的重试机会。这是队首阻塞，不是服务端公平轮转问题。

### 2.3 测量不是一级初始化状态

只有已完成 fit generation 的 pane 才能成为 Queue 候选。大分屏布局仍在稳定时，host 可能错过首次可用测量；该 pane 既未入队，也没有稳定的 `awaiting_measurement` 状态和灰点。点击恰好会触发布局、尺寸确认和 Fast 提升，从而掩盖了缺失的初始化事件。

### 2.4 当前监控不能追溯关闭来源

网络监视器能确认物理连接状态，却没有记录拓扑阶段、slot 身份、lease/attempt 身份和释放原因。其通道编号按附着顺序分配，不是 controller 归属的稳定直连 1/2 身份，无法区分正常交接与初始化竞态。

## 3. 不变量

1. 普通容器浏览器终端物理 WebSocket 始终不超过 2 条：直连通道 1、队列通道。
2. 首次初始化严格为 `Fast -> Queue`。Fast 未完成当前逻辑启动前不能创建 Queue；Fast 物理 socket 确认 `OPEN`、逻辑 replay ready 且工作区存在额外 pane 后，才能创建 Queue、提交订阅或开始 Queue 本地缓存任务。
3. Fast 启动失败只重试当前阶段和当前 pane，不能跳过阶段或静默替换其他 pane。
4. Queue 已运行后，普通输出、一次 render pending 或 Fast 槽位交接都不能关闭 Queue 物理 WebSocket。
5. 单个 Queue pane 失败只影响其逻辑流，不得关闭其他逻辑流或 Queue 物理 WebSocket。
6. 每个 Queue 启动任务必须只有一次有限结果：`ready`、`cancelled`、`failed` 或 `timed_out`；所有结果都必须经 `finally` 释放 FIFO。
7. Cache API v2 继续优先，manifest 读取和 warm replay 继续串行；不得以无条件服务端 snapshot 替代缓存命中。
8. 每个可见 pane 都必须有明确初始化状态，禁止无状态黑屏。
9. persistent agent、PTY 所有权、history/cursor 协议和服务端持续 drain 行为均不修改。

## 4. 目标 Controller

新增仅在浏览器端运行的 `TerminalTopologyController`。它是 Fast lease、两条 Fast 逻辑绑定、Queue 物理传输、Queue 逻辑成员和启动阶段迁移的唯一所有者。

### 4.1 Context

每个当前 target 页面包含：

- `epoch`：仅在 target 变化、离线或页面重置时递增；活动 tab 变化不重建物理 transport。
- `phase`：`idle`、`awaiting_measurement`、`fast_starting`、`fast_ready`、`queue_starting`、`running`、`suspended`。
- 两个稳定 Fast slot：pane ID、lease ID、启动 attempt ID 和状态。
- 一个 Fast transport 和一个 Queue transport：物理 socket 状态、transport attempt ID 以及当前逻辑绑定。
- 每 pane 启动记录：状态、channel generation、Queue attempt、重试次数和最后状态原因。

WebSocket、Cache API、resize、Ghostty render、超时和用户操作的回调必须携带 epoch/attempt ID。不匹配当前记录的旧回调直接丢弃，不能改变连接拓扑。

### 4.2 外部事件

其他模块只能向 controller 提交事件：

- target 或活动 tab 切换；
- pane 变为可测量、隐藏、删除或重新可见；
- Fast lease 打开、回放完成、最终渲染、失败或关闭；
- Queue 物理传输打开、失败或关闭；
- Queue pane 缓存、回放或渲染达到终态；
- 用户明确操作 pane；
- 浏览器离线/在线、页面挂起/恢复。

resize、render、健康检查、`setActivePane` 和回放处理不能再直接分配、释放或全局 reconcile 物理连接。

### 4.3 首次初始化迁移

| 当前阶段 | 必需事件 | 下一动作 | 禁止动作 |
| --- | --- | --- | --- |
| `awaiting_measurement` | 首个 pane 可测量 | 分配并启动 Fast | 启动 Queue |
| `fast_starting` | Fast 当前最终呈现且物理 socket `OPEN` | 创建 Queue transport并入队 Queue pane | 因后续测量释放 Fast |
| `queue_starting` | Queue 物理传输 ready | 运行 Queue 启动 FIFO | 创建第二条 Queue socket |
| `running` | 普通输出或 render pending | 保持现有拓扑 | 重建 Fast 或 Queue |

必需 Fast 失败时，controller 留在当前 Fast 阶段，仅按退避重试该 pane。只有它完成当前最终呈现，或 tab/target context 被替换，才允许离开该阶段。

## 5. Queue pane 启动

### 5.1 Pane 状态

活动 tab 内的可见 pane 在获得传输资格前先被登记：

`awaiting_measurement -> waiting_fast_gate -> queued -> cache_preparing -> attaching -> replaying -> rendering -> ready`

失败分支为 `retrying`、`failed` 和 `cancelled`。`awaiting_measurement`、`waiting_fast_gate`、`queued`、`cache_preparing`、`attaching`、`replaying`、`rendering` 显示呼吸灰点；只有实际重试显示呼吸红点。

### 5.2 FIFO 规则

Queue 启动 worker 的缓存 manifest 访问和 warm replay 并发度恒为 1。单个 pane 依次：

1. 校验 controller epoch 和可测量尺寸。
2. 读取、校验 Cache API v2 manifest，并完成串行 warm replay 准备。
3. 在已运行的 Queue 物理 WebSocket 上创建或加入该 pane 的逻辑流。
4. 活动 tab pane 等待回放和最终渲染；后台 tab pane 在 replay/cursor 连续后结算，待激活时再按当前尺寸提交最终 Canvas。
5. 所有路径只结算一次，并释放 worker。

worker 使用分阶段 deadline，不使用轮询。缓存无进度、attach、replay 或 render 超时只把当前 pane 移入 `retrying`，移除它的逻辑流，并把重试追加到已排队 pane 之后；下一任务立即开始。任何超时都不得遗留未结算 waiter。

未测量 pane 不得占据 FIFO 队首，只能停留在 `awaiting_measurement`，等待布局事件。

### 5.3 Queue 物理故障

物理 Queue 故障由 controller 只处理一次：标记 transport 不可用、废弃受影响的逻辑 attempt、按退避重连一条物理 Queue WebSocket，并重新排入未完成 pane。不得为每个 pane 创建物理重试，也不得关闭健康 Fast 通道。

## 6. 测量与呈现

controller 只在活动 tab 布局已挂载、且有限布局稳定序列完成后接收测量：布局挂载、`ResizeObserver` 和有上限的 `requestAnimationFrame` 确认链。它不是网络轮询，也不是无限定时器。

host 确实不可测量时，pane 保持灰点和明确等待状态；一旦可测量，自动进入当前初始化阶段，不需要点击。一次普通 Canvas render 只能推进发起该 render 的当前启动 attempt，不能自行改变连接拓扑。

## 7. 运行期 Fast/Queue 交接

初始化进入 `running` 后，点击或输入 Queue pane 的流程为：

1. 请求提升为 Fast。
2. controller 选择唯一 LRU Fast 受害者，保留另一条 Fast。
3. 仅废弃被提升 pane 的 Queue 逻辑 generation。
4. 关闭受害者的旧 Fast logical stream，在同一条仍保持开启的物理 transport 上绑定被提升 pane，并等待其当前回放/渲染 generation。
5. Queue 物理传输和其他 Queue 逻辑流持续运行；被淘汰 Fast pane 通过新逻辑 generation 在合适时加入 Queue。

任何 focus、pointer、renderer 或健康检查回调都不得绕过 controller 独立执行交接。

## 8. 调试可观测性

仅在调试日志启用时记录关键事件：

- `epoch`、阶段迁移、触发事件和选中的 pane；
- Fast slot、lease ID、启动 attempt ID、open/ready/close 原因；
- Queue transport attempt ID 和真实物理状态；
- Queue pane 状态迁移、重试次数、超时类别和 FIFO 位置；
- 被忽略的旧回调及其不匹配身份。

禁止记录 PTY 内容、ping/pong、普通 Queue 轮次或每个输出帧。网络监视器改为显示 controller 归属的稳定直连 1 和队列通道，并在调试模式中显示关闭原因。

## 9. 实施顺序

1. 新增 controller 状态和确定性单元测试，不修改 persistent agent 或 Queue wire protocol。
2. 将 tab 激活、pane 测量、Fast lease 回调、Queue 物理回调和 pane 回放/渲染结果接入 controller。
3. 移除全局 demand sync、测量、replay-ready、render-ready、pointer/focus 和健康检查中的直接拓扑变更。
4. 用拥有有限 outcome 的 FIFO worker 替换现有 Queue startup waiter，保证隔离重试。
5. 增加明确测量状态和有限布局稳定事件。
6. 增加按需拓扑调试日志和稳定网络监视器归属。
7. 只有在行为测试证明 controller 覆盖所有迁移后，才删除废弃 reconcile 路径。

## 10. 自动化覆盖

- 32 pane 且测量顺序随机：Fast 逻辑启动完成前 Queue 不启动；物理 WebSocket 不超过 2。
- Fast bootstrap 期间反复 render/resize/replay 回调：不存在 `fast_bootstrap_wait` close 和 slot 抖动。
- Queue 第 5 个 pane 永不发出最终 render：它超时，pane 6 继续启动；pane 5 独立重试，Queue 物理传输不关闭。
- 延迟测量 pane 不点击也能进入 ready；不可测量期间显示灰色等待状态。
- Queue 提升 Fast：只关闭一个 Fast 受害者，保留另一 Fast 与 Queue 物理连接，拒绝旧 generation 迟到帧。
- Queue 物理故障：只重试一条 transport，并重新排入未完成 pane；不产生每 pane 物理 socket。
- tab/target 切换和离线/在线：旧 epoch 回调不能修改新 context。

## 11. 真机验收

在目标设备用单 tab 的 3、12、32 分屏测试。初始化期间禁止任何操作，顺序必须可观察为：Fast 启动、Fast 物理通道和逻辑回放完成后开始 Queue；后台 pane 的不可见 Canvas 不得让 Queue 长时间保持未启用。

验收要求：每个可测量 pane 都达到首帧，或处于可诊断的重试/错误状态；禁止无状态黑屏。点击 Queue pane 最多替换唯一 Fast；直连 1 和 Queue 不得一起重连。全程物理终端 WebSocket 不超过 2 条。
