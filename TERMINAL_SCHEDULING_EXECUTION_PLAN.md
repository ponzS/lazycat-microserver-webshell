# WebShell 终端调度简化与稳定性执行计划

状态：阶段 0、阶段 1 已完成；阶段 2 代码与自动化已完成，待设备验收；阶段 3-9 待执行

最后更新：2026-08-31

本文是本轮终端黑屏、恢复慢、折叠屏尺寸不收敛、跨 tab/设备串画面和输出期间抖动问题的唯一执行清单。每完成一个阶段，必须在本文更新状态、修改模块、自动化测试、真机结果、遗留问题和下一阶段入口条件。

## 1. 目标与范围

### 1.1 目标

- 稳定优先，减少调度 owner、状态门禁和隐式竞态。
- persistent Agent/PTY 是终端字节、会话和历史的唯一权威；浏览器只保存渲染副本和当前连接状态。
- 任何恢复、重连、回放、resize、切 tab、切 pane、F11、折叠屏开合或跨设备接管，都必须最终得到当前设备的正确尺寸和一帧稳定、清晰、可见的终端画面。
- 历史回放过程永远不可见；只能在回放完成、状态连续并完成最终渲染后提交画面。
- 普通连接、回放、resize、等待 ACK、逻辑重试只显示小灰点；只有明确断网或网络连接故障显示小红点。
- 用户可感知的健康恢复目标为 2 秒内完成清晰画面，且恢复期间保留有效的上一帧。

### 1.2 明确不做的事情

- 不重新实现服务端会话、PTY、Agent 保活或历史存储。
- 不把浏览器缓存作为普通容器的历史权威，不恢复 Cache API、PWA app-shell 或终端字节缓存调度。
- 不引入 `xterm.js`、`tmux` 或新的终端替代实现。
- 不通过清空 Canvas、销毁会话、重建 Agent 或重新下载无关资源来掩盖竞态。
- 不把滚动 scrollback、总览预览、Canvas 绘制完成作为 WebSocket/Agent ACK 的前置条件。

## 2. 当前问题与证据

当前故障表现包括：

- 手机进入后台后恢复慢，画面模糊，初始只显示最新一屏；滚动到历史区域为黑屏，调整字号或窗口后才出现。
- 折叠屏连续开合时，终端经常黑屏或仍使用旧屏幕尺寸，必须点击后才更新；偶尔出现灰点消失、红点短暂出现、数秒后才显示内容。
- Agent 持续输出时输入文字，终端上下抖动。
- 切 tab、切 pane、F11 或多设备尺寸接管时，当前会话偶尔出现其他会话历史或乱码；重新进入页面后消失。
- 新建 pane 曾出现稳定黑屏并伴随错误红点，表明连接/回放/呈现状态被错误归因。

现有日志和代码结构显示，几百 KB 到约 1 MB 的 PTY 数据不是主要瓶颈。更可能的放大链路是：

```text
visibilitychange/pageshow/focus/online/resize
  -> 多个恢复入口同时启动
  -> physical retry、logical retry、health probe、attach timeout、replay retry、presentation retry 并行
  -> 旧 timer 或旧 generation 迟到回调覆盖新状态
  -> replay/parsed/scrollback/presentation 门禁交叉等待
  -> Canvas/DPR/geometry 未原子收敛
  -> 黑屏、模糊、错误红点或长时间等待
```

需要重点验证的具体风险：

1. 后台冻结后 `resumeProbeTimer` 等 timer 仍被标记为 pending，恢复入口可能被短路，导致重试延迟。
2. Unified physical owner、logical pane attach、direct scheduler、health probe 和 retry scheduler 的职责边界不够单一。
3. Ghostty renderer 的 `devicePixelRatio` 主要在创建时读取，折叠屏/WebView scale 改变时 backing store 可能与 CSS geometry 不一致。
4. replay complete、terminal parsed、scrollback 可读和 presentation committed 没有完全分离，可能出现数据已进入 Ghostty 但最终 full render 未提交。
5. output flush 后重复 `resetHostViewport()`、`positionInput()` 和 validation，会把持续输出放大成布局抖动。
6. 某些普通 retry 被固定归类为 `network_retry`，导致灰点错误变成红点。
7. scrollback viewport 变化若触发 replay、resize 或 recovery，会造成“最新一屏可见、历史区域黑屏”的错误耦合。

## 3. 已完成的前置基础

以下内容以 `docs/FIX_HISTORY.md` 的当前架构基线为准，后续不能倒退：

- 页面不再注册 Service Worker，不再使用 PWA app-shell 和 Cache API 参与首屏或终端数据恢复。
- 旧 `/service-worker.js` 只作为退役迁移脚本，负责注销旧 registration 和删除已知旧缓存，不读取终端数据，也不参与正常资源调度。
- 普通容器的服务端 persistent Agent/PTY、history generation、绝对 byte cursor 和 Unified logical stream 是权威链路。
- 普通容器页面最多一条 Unified physical WebSocket；每个 pane 只能有一个有效 logical attach attempt。
- replay 和 snapshot 期间已经要求 render suppression；已提交并且身份仍有效的 Canvas 是网络故障期间的 last-known-good frame。
- 终端总览预览已独立持久化，预览不得触发 replay、恢复、输入就绪或 resize。

这些基础的意义是：本计划只收敛调度和呈现边界，不重新引入缓存状态，也不把问题扩大为协议或会话重构。

## 4. 外部参考与可借鉴设计

已对比 Ghostty Web Demo、Restty、web-terminal、Herdr Studio 及行业常见 WebShell 实现，得到以下可复用结论：

| 参考方向 | 值得采用的做法 | 对本项目的约束 |
| --- | --- | --- |
| Ghostty Web Demo | 终端状态由 Ghostty/VТ 引擎维护，DOM/Canvas 只负责呈现；resize 以最终 geometry 为目标，渲染用 RAF 合并 | 不在前端另建一份 PTY 历史，不以缓存字节驱动第二套状态 |
| Restty | WebSocket 消息先入有界队列，再按批次解析；解析和绘制分离；连接生命周期显式管理 | socket handler 不能做无界解析、Canvas 绘制或多次 recovery |
| web-terminal 类实现 | 页面恢复通过 session reconnect/handshake 重新取得权威边界；旧连接回调必须失效 | 使用 generation/attempt fence，禁止旧 close/open/retry 覆盖新连接 |
| Herdr Studio 类实现 | PTY/session 在服务端持续存在，前端重连后继续消费当前会话；前端画面不是会话权威 | 不因页面隐藏、tab 切换或设备变化销毁 PTY |
| 行业通用实践 | 单一连接 owner、单一恢复事务、latest-only resize、last-known-good frame、明确 offline 与 connecting 状态 | 把并行调度改为串行阶段，所有迟到异步任务按 generation 丢弃 |

参考代码中若出现 `tmux` 或 `xterm.js`，只作为概念参考，不能带入本项目。

## 5. 推荐目标模型

### 5.1 唯一权威和唯一 owner

```text
persistent Agent/PTY/history
        │
        ▼
页面级 Unified physical WebSocket（唯一 owner）
        │
        ▼
每个 pane 一个 logical stream/attach attempt
        │
        ▼
有界 output queue -> Ghostty 有序解析 -> pending render
        │
        ▼
一次最终 full render -> presentation commit
```

- `global-runtime.js` 是页面级生命周期和依赖接线的唯一 owner，不实现终端算法。
- transport 只拥有 physical socket、logical membership、attempt/generation 和重试；不拥有 Canvas 或 replay 可见性。
- history/session 只拥有 cursor、history generation、回放协议和 session 生命周期；不直接提交 Canvas。
- output 只拥有字节队列和有界 drain；ACK 只表示字节已按序进入 Ghostty，不等待 Canvas。
- rendering/presentation 只拥有 render suppression、last-known-good frame、full render 和 commit；不推进 cursor、不发送 WebSocket。
- resize/viewport 只拥有 geometry、DPR、latest target 和 resize ACK fence；不触发历史回放。

### 5.2 前台恢复事务

任何 `visibilitychange`、`pageshow`、`focus`、`online`、折叠屏 geometry 变化和宿主 resume 事件都只进入同一个 latest-only 恢复事务：

```text
收到恢复信号
  -> 合并为一个 resumeGeneration
  -> 取消/失效旧 attempt、timer、probe 和 presentation retry
  -> 保存身份匹配的 last-known-good frame
  -> 采集稳定 geometry、CSS size、DPR、font metrics
  -> 原子同步 Canvas backing store 与 Ghostty size
  -> 恢复或确认唯一 physical transport
  -> 执行一次 logical attach/replay
  -> 有界排空 output queue，直到 cursor 连续
  -> 执行一次最终 full render
  -> 校验 geometry、cursor、scrollback 和 Canvas
  -> presentation commit，解除输入锁
```

恢复事务未完成时：

- 不清空 last-known-good frame；没有旧帧时显示稳定的灰色占位点。
- 不允许任何 replay 中间帧进入用户可见 Canvas。
- 不允许 scrollback viewport、预览或普通 output 事件另起 recovery/resize。
- 健康网络下的 connecting、replay、resize、ACK、logical retry 均为灰点。

### 5.3 明确拆分的状态

以下状态必须分开记录，不能用一个 `ready` 或 `replaying` 字段代替：

```text
bytesReceived
terminalParsed
scrollbackRenderable
geometryCurrent
presentationCommitted
inputReady
transportHealth
```

只有 `presentationCommitted=true` 才允许把当前帧视为用户可见；只有 `transportHealth` 明确为 offline/network-fault 才能显示红点。

### 5.4 Resize 和输出规则

- ResizeObserver、VisualViewport、屏幕方向和折叠事件只更新 latest target；每个 pane 最多一个 in-flight resize 和一个 pending target。
- 同一 cols/rows/cell metrics 不重复发送；旧 ACK、旧 DPR 或旧测量回调不能覆盖新 target。
- resize 只改变 geometry/presentation，不重置 history generation，不重新回放完整历史。
- output drain 受 byte、entry 和时间预算限制，批次之间让出主线程；不得无界 `force flush`。
- 持续输出期间不反复 reset host viewport、移动输入框或触发同步全布局；布局更新使用合并后的 RAF。
- scrollback viewport 变化只请求 Ghostty render，不触发 replay、resize、reconnect 或 session reset。

## 6. 模块状态所有权

| 模块 | 唯一责任 | 明确不负责 |
| --- | --- | --- |
| `global-runtime.js` | 页面启动、恢复/挂起/销毁顺序、controller 创建和显式依赖接线 | 终端协议、队列、Canvas 算法、业务状态副本 |
| `app/` | 页面级事件监听和资源清理，将恢复信号交给 runtime | 决定终端恢复细节 |
| `terminal/session/` | pane/session 状态、创建销毁、generation 边界 | physical socket、Canvas 提交 |
| `terminal/transport/` | Unified physical socket、logical attach、attempt、重试和健康状态 | history 回放可见性、resize 几何、渲染 |
| `terminal/history/` | snapshot/replay、cursor、history generation、协议连续性 | Canvas、网络指示器视觉状态 |
| `terminal/output/` | output queue、bounded drain、turn ACK | resize、presentation、重连决策 |
| `terminal/rendering/` | Ghostty adapter、render suppression、last-good frame、full render/commit | PTY cursor、WebSocket、resize owner |
| `terminal/resize/` | geometry、DPR、font metrics、latest-only resize、ACK fence | history replay、socket retry |
| `terminal/viewport/` | scroll/viewport 机械状态和事件 | recovery、replay、resize owner |
| `terminal/overview/` | 已提交 Canvas/持久化预览 | 终端恢复、输入就绪、PTY 数据 |
| `diagnostics/` | 统一 trace、耗时和队列指标 | 改变业务状态或吞掉错误 |

跨模块通信只能通过公开入口、显式 getter/command、事件或只读快照完成。新增独立责任域必须同步增加目录 `README.md`、入口和测试边界。

## 7. 分阶段执行清单

### 阶段 0：证据、参考和目标模型（已完成）

- [x] 阅读 `AGENTS.md`、`docs/FIX_HISTORY.md`、`docs/FRONTEND_MODULE_MAP.md` 及相关模块。
- [x] 对比 Ghostty Web Demo、Restty、web-terminal、Herdr Studio 的连接、解析、渲染和恢复模式。
- [x] 确认服务端 PTY 为唯一权威，Cache API/PWA 不属于终端功能且不应回归。
- [x] 固化单一恢复事务、单一 physical owner、单 pane logical attach、last-known-good frame 和灰/红点原则。

完成条件：本文件成为后续实现和验收的入口；没有未决的目标模型分歧。

### 阶段 1：增加统一诊断 trace（不改变行为）

状态：已完成代码与自动化验证；待真实设备采集

- [x] 给每次恢复绑定 `resumeGeneration`，记录 visibility/pageshow/focus/online/host-resume 来源。
- [x] 记录 physical socket、logical attach、retry、health probe、replay、resize、output drain、render 和 commit 的相对时间。
- [x] 接入已有 output queue 峰值、drain 字节/耗时、Ghostty 写入/resize 耗时和 Canvas 尺寸事件统计；DPR/长任务/输入延迟的设备采样在阶段 4/6 继续补齐。
- [x] 记录 stale timer/callback 被丢弃的次数，不记录 PTY 内容、命令、token 或 cookie。

自动化 guard：Node 事件序列和 generation 测试；静态检查确保日志不含敏感数据。

完成日期：2026-08-31
修改模块：`diagnostics/terminal_timeline.js`、`diagnostics/diagnostics_controller.js`、`app/runtime_recovery_controller.js`、`global-runtime.js`
自动化测试：`node --test tests/*.mjs` 391/391；`go test ./...`；`go test -race ./...`；生产 JavaScript `node --check`；`git diff --check`
浏览器/真机测试：尚未执行本阶段专门的设备 trace 采集
已知遗留问题：Canvas backing-store/DPR、长任务和输入延迟需要阶段 4/6 的真实设备数据补齐
下一阶段入口条件：运行时事件 trace 可用于定位恢复竞态，进入阶段 2

阶段出口：一次现场故障可以明确归类为 transport、replay、geometry、render gate、主线程任务或错误指示器，而不是“黑屏”。

### 阶段 2：建立单一前台恢复事务

状态：代码与自动化完成；待真实设备验证

- [x] 将 visibility/pageshow/focus/online/宿主 resume 合并为一个带短窗口合并和 generation fence 的幂等入口。
- [x] 每个新恢复代次使旧在线等待回调失效，并记录 coalesced/stale 事件。
- [x] 保留既有“geometry/DPR → transport → replay/drain → full render → commit”顺序，恢复入口不再重复启动同一流程。
- [x] 后台恢复期间保留 last-known-good frame，禁止清空 Canvas 或显示 replay 中间帧。
- [x] 设置健康网络下 2 秒内的有界恢复 deadline 诊断；超时只显示灰点并继续可恢复重试，不直接标红。

自动化 guard：隐藏/显示、pageshow、focus 连发；后台冻结后恢复；旧 generation 迟到回调；恢复期间 output 和 resize 并发。

完成日期：2026-08-31
修改模块：`app/runtime_recovery_lifecycle.js`、`app/runtime_recovery_controller.js`、`global-runtime.js`、`terminal/transport/session_connection_controller.js`、`terminal/transport/unified_transport_controller.js`、`style.css`
自动化测试：`tests/app_runtime_recovery_controller_test.mjs` 9/9；连接/Unified 定向测试 13/13；Node 全量 `395/395`；`go test ./...`、`go test -race ./...`、生产 JS `node --check`、`git diff --check` 通过
浏览器/真机测试：使用当前 `runtime/static` 映射和 iPhone UA，01-05、07-11 通过；06 首次因远端桌面/移动页争用导致重载后短暂停在 `reconnecting`，单独复跑通过；11 在静态映射模式按设计跳过 Service Worker 实际迁移。12 仍失败于既有 overview preview identity 重载问题，与本阶段 Ghostty 渲染改动无关。Android Fold UA 的 04 组未进入该用例要求的 iOS 分支，改用 iPhone UA 后通过。
已知遗留问题：折叠屏和后台恢复仍需真实设备验收；overview preview identity 重载仍需单独修复；仍需阶段 3/4 的 transport/geometry 收口
下一阶段入口条件：用户确认折叠屏/后台恢复体验后进入阶段 3

阶段出口：任何恢复入口最多产生一个有效事务，且同一 pane 不存在并行 recovery。

### 阶段 3：收口 physical transport、logical attach 和 retry owner

状态：待执行

- [ ] 明确页面级 Unified physical socket 的唯一 owner；`CONNECTING`、`OPEN`、`CLOSING` 均占用物理槽位。
- [ ] 每个 pane 只允许一个有效 logical attach attempt，旧 close/open/retry 必须经过 attempt/channel generation fence。
- [ ] 合并 physical retry、logical retry、direct scheduler、health probe、attach timeout 的重复职责，保留单一 retry 入口。
- [ ] 普通 logical retry、replay retry、resize ACK 等待不关闭健康的物理 socket，也不显示红点。
- [ ] `unified pane stream is not active` 等错误必须区分 logical attach 失败和真实网络故障。

自动化 guard：快速新建 pane、快速切 tab、旧 socket close 晚到、新 socket 已打开、输入锁、单页物理连接数量。

阶段出口：单页 Unified socket 数量稳定；一个 pane 的旧回调不能关闭或覆盖新 stream；重试原因可解释。

### 阶段 4：原子收敛 Canvas、DPR、字体和设备 geometry

状态：待执行

- [ ] 从 `ResizeObserver`、`visualViewport`、屏幕方向/折叠事件和宿主事件采集最终 geometry。
- [ ] 增加 renderer 的 DPR/font metrics 更新入口，不再只在构造时读取 DPR。
- [ ] 一次性同步 CSS size、Canvas backing size、Ghostty cols/rows 和 cell metrics，并绑定 geometry generation。
- [ ] 对连续开合和多屏切换使用 latest-only target；尺寸不一致时自动 claim 当前正在使用的设备，无需点击。
- [ ] backing store 变化前保留旧帧；新 geometry 未验证前不得提交模糊或空白帧。

自动化 guard：DPR 变化、VisualViewport 变化、折叠事件连发、F11、跨设备尺寸接管、旧 measurement 回调。

阶段出口：连续开合 10 次无需点击即可切换最终尺寸；Canvas CSS/backing size 与 Ghostty geometry 一致。

### 阶段 5：拆分 replay、解析、scrollback 和 presentation 状态

状态：待执行

- [ ] 分离 `bytesReceived`、`terminalParsed`、`scrollbackRenderable`、`presentationCommitted`、`inputReady`。
- [ ] snapshot/replay/live output 全部在 render suppression 下进入 Ghostty；禁止首批字节、checkpoint 或中间帧可见。
- [ ] replay complete 后等待 cursor 连续、实时队列追平、geometry current，再执行一次 full render 和 commit。
- [ ] renderer 缺行、Canvas context 恢复或一次 render 失败时保留上一帧和 dirty 状态，事件驱动重试，不永久 pending。
- [ ] scrollback viewport 变化只触发当前 Ghostty 状态渲染，不能重播历史或重连。

自动化 guard：大 snapshot、live output 与 replay 并发、缺行、Canvas context loss、scrollback 顶部滚动、刷新恢复。

阶段出口：回放过程中用户看不到快速历史滚动；恢复后向上滚动可显示完整历史，不需要调整字号/窗口触发补画。

### 阶段 6：收口 output、resize settle 和输入布局调度

状态：待执行

- [ ] output drain 使用 byte/entry/time budget，批次间让出主线程；Queue ACK 不等待 Canvas commit。
- [ ] resize 使用 latest-only、单 in-flight、ACK fence 和失败重试；不因 resize 无条件重置 history/replay。
- [ ] 移除输出热路径中重复的 `resetHostViewport()`、`positionInput()` 和强制全布局；以 RAF 合并输入框和 viewport 更新。
- [ ] 持续 Agent 输出期间，输入框位置、终端高度和滚动条不发生无意义上下抖动。
- [ ] 记录 drain、Ghostty write/resize、Canvas resize/full render 的耗时和峰值，避免用提高硬上限掩盖问题。

自动化 guard：持续输出输入、SIGWINCH/TUI 重绘、字号变化、拖拽窗口、resize ACK 超时、单条大消息拆分。

阶段出口：1 MB 级普通会话不因调度出现秒级黑屏；输入延迟和布局位置保持稳定。

### 阶段 7：统一灰点/红点状态派生

状态：待执行

- [ ] 由一个纯状态函数根据 `transportHealth`、offline、明确 network fault 和 recovery phase 派生指示器。
- [ ] connecting、replay、resize、ACK、logical retry、presentation pending、后台恢复只显示灰点。
- [ ] 只有浏览器 offline、WebSocket 明确网络错误/异常断开或服务端确认网络不可达显示红点。
- [ ] 灰点消失不能代表画面已提交；红点消失也不能清除 last-known-good frame 或跳过最终 render。
- [ ] 指示器状态必须绑定当前 pane/session identity 和 generation，旧 pane 错误不能污染新 pane。

自动化 guard：正常新建 pane、logical retry、断网/恢复、服务端 4001、旧错误晚到、多个 pane 同时连接。

阶段出口：黑屏期间始终有灰点或有效旧帧；无网络异常时不再出现红点闪烁。

### 阶段 8：全量自动化、浏览器和真机验收

状态：待执行

- [ ] Node 行为测试：运行根目录 `tests/` 下全部 `*_test.mjs`，覆盖每个新增 generation、状态门禁和资源清理 guard。
- [ ] Go 测试：`go test ./...`、`go test -race ./...`，检查静态资源、模块入口、LPK 内容和协议边界。
- [ ] 浏览器测试：`tests-auto/` Playwright 覆盖启动、恢复、tab/pane/F11、scrollback、持续输出、错误状态和 console/page error。
- [ ] debug123 真机/客户端：确认测试安装和加载的是最新 LPK，检查单页 Unified socket、事件 trace 和最终 Canvas 像素。
- [ ] 设备矩阵：桌面多屏、Android 普通屏、折叠屏开合、Lazycat WebView、手机后台 5 秒/30 秒/数分钟后恢复。
- [ ] 多设备同一会话：谁正在使用谁立即拥有当前 geometry；切 tab、激活 pane、F11 都能重新 claim 当前设备尺寸。

阶段出口：所有验收标准通过，且没有 console error、pageerror、未处理 Promise rejection 或永久 pending 状态。

### 阶段 9：删除旧调度路径并固化回滚点

状态：待执行

- [ ] 在阶段 8 通过后删除被单一 owner 取代的重复 scheduler、旧 retry 分支和无效门禁。
- [ ] 清理只用于迁移的临时诊断开关；保留必要的低成本错误计数和 last-known-good 保护。
- [ ] 更新各模块 `README.md`、`docs/FRONTEND_MODULE_MAP.md` 和 `docs/FIX_HISTORY.md`，记录新的状态所有权和 guard。
- [ ] 保留每阶段独立提交/标签和可逆 feature flag，出现回归时只回退当前阶段，不回滚用户已有无关改动。

阶段出口：代码路径数量和调度 owner 明显减少，模块边界、测试和回滚点完整可追溯。

## 8. 验收标准

以下全部满足才算本轮完成：

1. 手机后台 5 秒、30 秒和数分钟后回前台，健康网络下 2 秒内显示清晰完整画面；恢复期间保留旧帧或稳定灰点。
2. 折叠屏连续开合 10 次，无需点击即可完成当前屏幕尺寸切换；无黑屏、模糊、旧 DPR 或旧 rows/cols 残留。
3. replay、snapshot、resize settle、logical retry 和 Canvas recovery 过程中不显示历史回放或中间帧。
4. 黑屏/等待状态只显示小灰点；只有明确网络异常和断网显示小红点；状态不会被旧 pane 或旧 generation 污染。
5. 切 tab、pane、F11、主题/字号变化和多设备接管不出现其他会话历史、乱码、旧画面串入或需要重新进入页面修复。
6. 恢复后滚动到 scrollback 顶部，全部服务端历史字节可见；不需要调字号、改窗口或点击终端触发补画。
7. Agent 持续输出时输入文字，终端 Canvas、输入框和滚动条不发生无意义上下抖动。
8. 每个页面最多一个 Unified physical WebSocket，每个 pane 最多一个有效 logical attach attempt；旧回调不能改变当前状态。
9. 所有 Node、Go、Playwright、debug123 和设备矩阵测试通过；无 console/page error、未处理 Promise rejection、永久 retry 或永久 pending。
10. Cache API、PWA app-shell、终端字节缓存和 Service Worker 不重新进入正常终端启动、恢复、回放或渲染路径。

## 9. 每阶段状态更新模板

完成阶段后，在对应阶段下补充以下内容，并同步更新本文顶部状态和本节记录表：

```markdown
完成日期：YYYY-MM-DD
修改模块：...
自动化测试：命令、通过数量、关键 guard
浏览器/真机测试：设备、场景、结果
已知遗留问题：...
下一阶段入口条件：...
```

| 阶段 | 状态 | 完成日期 | 自动化结果 | 真机结果 | 遗留/下一步 |
| --- | --- | --- | --- | --- | --- |
| 0 目标模型与参考 | 已完成 | 2026-08-31 | 文档/源码/历史记录核对完成 | 尚未执行设备测试 | 进入阶段 1 |
| 1 统一诊断 trace | 代码与自动化完成，设备待验 | 2026-08-31 | Node 391/391、Go/race、语法、diff 通过 | 待执行 | 阶段 4/6 补 DPR/长任务/输入采样 |
| 2 单一前台恢复事务 | 代码与自动化完成，设备待验收 | 2026-08-31 | recovery 9/9、连接/Unified 定向 13/13、Node 395/395、Go/race 通过；Ghostty Bun 391/391；01-05、06（复跑）、07-11 通过 | 折叠屏实体开合、后台恢复待手动；12 预览持久化仍有既有 identity 重载失败 | 手动确认 2 秒内恢复后进入阶段 3；预览问题另行跟踪 |
| 3 transport/retry owner | 待执行 | - | - | - | - |
| 4 geometry/DPR 原子收敛 | 待执行 | - | - | - | - |
| 5 replay/presentation 状态拆分 | 待执行 | - | - | - | - |
| 6 output/resize/输入调度 | 待执行 | - | - | - | - |
| 7 灰点/红点派生 | 待执行 | - | - | - | - |
| 8 全量与真机验收 | 待执行 | - | - | - | - |
| 9 旧路径清理与归档 | 待执行 | - | - | - | - |

## 10. 执行纪律与回滚边界

- 一次只推进一个阶段；阶段出口未满足时，不进入下一阶段，不用新逻辑掩盖旧阶段失败。
- 每个阶段先补自动化 guard，再改行为；无法自动化的场景必须记录可重复的最小真机步骤。
- 任何会让历史回放可见、清空 last-known-good frame、增加第二个 physical socket 或重新引入 Cache/PWA 的改动都必须拒绝。
- 新增或移动前端模块时，同一提交必须更新模块 README、公开入口、资源清单、`docs/FRONTEND_MODULE_MAP.md` 和相关静态契约测试。
- 每阶段独立提交，提交信息包含阶段编号；出现回归时只回退该阶段提交或关闭该阶段 feature flag，不回退用户其他未提交改动。
- 诊断日志只记录 scope 摘要、generation、cursor、尺寸、队列和耗时，不记录 PTY 原文、命令、账号凭据或票据。
