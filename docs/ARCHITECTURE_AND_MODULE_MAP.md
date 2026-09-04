# WebShell 当前架构与模块文档路径导航

状态：当前代码架构导航
最后更新：2026-09-03
维护范围：`lazycat-microserver-webshell`

本文是项目架构地图，不是 Bug 历史记录，也不是每个任务都必须全文阅读的执行计划。它回答三个问题：

1. 一个 WebShell 请求从哪里进入、经过哪些层、最终如何到达 PTY 和 Canvas。
2. 某个状态或功能由哪个模块拥有，相关实现和模块契约在哪里。
3. Agent 遇到具体问题时，应该按什么顺序加载上下文和测试。

Bug 的触发场景、失败证据、已确认根因、实施方案和验证结果，应记录在对应的 `tests-auto/<编号>-<场景名>/README.md`，不要把本文扩展成全局问题流水账。

## 1. Agent 阅读入口

### 只需要了解项目整体结构时

阅读本文到需要的章节即可，然后根据问题选择对应模块 README。不要为了了解历史而扫描整个 `docs/` 或所有 `tests-auto` 场景。

### 需要修改某个模块时

按以下顺序加载：

1. 本文对应的架构层和模块路径。
2. 目标模块目录的 `README.md`。
3. 模块 `index.js` 和本次修改涉及的 controller/API/model/view/lifecycle 文件。
4. 相关 `tests/` 行为测试和 `tests-auto` 场景 README。

### 自动测试失败时

先阅读失败场景目录的 `README.md`，再阅读其中列出的模块 README 和源码入口。只沿该场景的依赖链调查；不要默认阅读其他场景或全部历史文档。

## 2. 总体数据流

### 2.1 页面启动和静态资源

```text
Provider HTTP
  -> /webshell/ 或页面入口
  -> runtime/static/index.html
  -> runtime/static/main.js
  -> runtime/static/global-runtime.js
  -> app/workspace/instances/settings/appearance/diagnostics/terminal controllers
```

- `runtime/static/main.js` 是唯一页面脚本入口，只负责调用启动入口。
- `runtime/static/global-runtime.js` 是页面级全局 runtime owner，负责声明全局状态、创建 controller、依赖接线、启动/恢复/销毁顺序。
- `runtime/static/ghostty-web.js` 和 `runtime/static/ghostty-vt.wasm` 是终端运行时资产。
- 页面使用版本化 `/assets/<asset-version>/` 静态资源；API、WebSocket 和普通容器终端历史不经过浏览器 Cache API。
- 当前不以 Service Worker、PWA app-shell 或浏览器缓存作为普通容器终端历史来源。旧 `/service-worker.js` 只服务于一次性退役旧 registration 的迁移路径。

入口和静态资源细节：

- [`runtime/static/README.md`](../runtime/static/README.md)
- [`runtime/static/main.js`](../runtime/static/main.js)
- [`runtime/static/global-runtime.js`](../runtime/static/global-runtime.js)
- [`runtime/static/index.html`](../runtime/static/index.html)
- [`runtime/static/style.css`](../runtime/static/style.css)

### 2.2 Provider HTTP/API 和 WebSocket

```text
LightOS / browser
  -> pluginServer HTTP mux
  -> auth/account/selector boundary
  -> workspace, settings, instances, devices, attachments, publish or terminal handler
```

HTTP 路由和 Provider 总入口在：

- [`main.go`](../main.go)：`pluginServer.run()` 注册路由；`handleWebSocket()` 选择 queue/unified 或 direct attach。
- [`workspace.go`](../workspace.go)：普通容器 workspace、tab、pane、PTY、history、cursor 和尺寸状态。
- [`agent_runtime.go`](../agent_runtime.go)：服务端如何安装、启动、探测、重启和请求 persistent agent。
- [`agent.go`](../agent.go)：实例内 agent daemon、workspace action、PTY attach、history replay 和 agent frame 协议。
- [`terminal_queue.go`](../terminal_queue.go)：页面级 Unified/queue WebSocket、logical pane stream、单一 writer、队列、ACK、resize 和控制消息。
- [`client_terminal.go`](../client_terminal.go)：`client:` target 的客户端终端代理和独立直连兼容路径。
- [`server_log.go`](../server_log.go)：显式启用的服务端诊断日志 hub 和 WebSocket `server-log` 消息转发。

主要 Provider API：

| 路由 | 主要实现 | 作用 |
| --- | --- | --- |
| `/api/instances` | `main.go`、`instances` 相关逻辑 | 当前账号可见实例发现 |
| `/api/workspace` | `workspace.go`、`main.go` | 普通容器 workspace state/action |
| `/api/workspace/activity` | `workspace.go`、`main.go` | pane 活动和 busy 状态 |
| `/api/settings`、`/api/settings/fonts` | `settings.go` | 设置和字体 |
| `/api/devices*` | `devices.go` | 设备心跳、在线列表和离线通知 |
| `/api/attachments*` | `attachments.go` | 文件上传、浏览和下载 |
| `/api/publish/*` | `main.go`、`attachments.go`/发布代理逻辑 | 服务转发和发布代理 |
| `/api/agent/startup-error` | `agent_runtime.go` | agent 启动错误读取 |
| `/ws` | `main.go`、`terminal_queue.go`、`agent_runtime.go` | terminal queue/unified/direct WebSocket |
| `/assets/<version>/*` | `main.go` | 版本化不可变静态资源 |

### 2.3 普通容器终端链路

```text
Browser global-runtime
  -> terminal transport controller
  -> one page-level Unified physical WebSocket
  -> logical pane stream / subscription
  -> Go terminal queue broker
  -> lightosctl exec -i
  -> persistent agent Unix socket
  -> terminalPane PTY/history
  -> ordered binary replay + live output
  -> browser output queue
  -> Ghostty parser/state
  -> presentation commit
  -> visible Canvas
```

不可破坏的语义：

- 一个普通容器页面最多一条 Unified physical WebSocket。
- 每个 pane 是独立 logical stream，但不拥有独立的页面级 physical connection。
- persistent agent、PTY、history 和绝对 byte cursor 是权威来源。
- 浏览器保存的是渲染副本、连接状态、cursor 进度和当前 generation，不是普通容器的历史权威。
- replay、snapshot、重连和原子 resize/恢复过程中的中间画面不得提交给用户；有效旧画面应作为 last-known-good frame 保留。桌面分屏/窗口 live geometry 是明确例外，只提交当前 session 的真实 Canvas，不展示 replay 中间态。
- output ACK 表示有序字节已经进入当前 Ghostty 状态，不等同于 Canvas 已提交。
- `receivedCursor`、`appliedCursor` 和 `presentedCursor` 是不同阶段的进度，不能混用。

### 2.4 `client:` target 兼容链路

```text
Browser
  -> client terminal direct/proxy path
  -> LightOS client terminal service
  -> client-side session/history compatibility
```

`client:` target 暂时可以使用独立直连和隔离的 IndexedDB 历史兼容路径，不能把普通容器 Unified/history 假设直接套用到该链路。修改 client target 时优先阅读：

- [`runtime/static/terminal/README.md`](../runtime/static/terminal/README.md)
- [`runtime/static/terminal/history/README.md`](../runtime/static/terminal/history/README.md)
- [`client_terminal.go`](../client_terminal.go)
- [`client_terminal_test.go`](../client_terminal_test.go)

## 3. 前端模块路径地图

所有前端模块通过目录下的 `index.js` 暴露公开入口。模块外不得深度导入内部实现。每个模块 README 是该模块职责、状态 owner、生命周期、依赖和测试契约的详细说明。

### 3.1 应用和工作区

| 责任域 | 公开入口 | 模块文档 | 主要职责 |
| --- | --- | --- | --- |
| 应用生命周期和页面命令 | `runtime/static/app/index.js` | [`app/README.md`](../runtime/static/app/README.md) | 页面 listener、bootstrap、恢复、对话框、快捷键、反馈、应用命令 |
| 全局 runtime | `runtime/static/global-runtime.js` | [`runtime/static/README.md`](../runtime/static/README.md) | 全局状态、controller 接线、启动/恢复/销毁顺序 |
| workspace、tab、pane、布局 | `runtime/static/workspace/index.js` | [`workspace/README.md`](../runtime/static/workspace/README.md) | workspace API、权威 state apply、tab/pane CRUD、激活、布局、持久化；分割条拖动只拥有比例和交互生命周期 |
| 实例发现和切换 | `runtime/static/instances/index.js` | [`instances/README.md`](../runtime/static/instances/README.md) | 实例列表、默认目标、切换器和实例导航 |
| 设备在线状态 | `runtime/static/devices/index.js` | [`devices/README.md`](../runtime/static/devices/README.md) | 设备心跳、在线列表、离线 beacon |
| 设置和字体 | `runtime/static/settings/index.js` | [`settings/README.md`](../runtime/static/settings/README.md) | settings snapshot、字段 PATCH、字体、字号、scrollback、快捷键 |
| 外观和主题 | `runtime/static/appearance/index.js` | [`appearance/README.md`](../runtime/static/appearance/README.md) | 主题 catalog、主题持久化、CSS 变量和终端颜色适配 |
| 附件和文件管理 | `runtime/static/attachments/index.js` | [`attachments/README.md`](../runtime/static/attachments/README.md) | 文件选择、剪贴板导入、上传、远端浏览和下载 |
| 服务转发 | `runtime/static/service_forwarding/index.js` | [`service_forwarding/README.md`](../runtime/static/service_forwarding/README.md) | 发布记录、服务转发编辑、部署和删除 |

### 3.2 终端聚合模块

终端总体边界和普通容器/client target 差异：

- [`runtime/static/terminal/README.md`](../runtime/static/terminal/README.md)

| 责任域 | 公开入口 | 模块文档 | 主要职责 |
| --- | --- | --- | --- |
| 终端配置和阈值 | `terminal/config/index.js` | [`terminal/config/README.md`](../runtime/static/terminal/config/README.md) | 不可变超时、限制和共享配置 |
| history/replay | `terminal/history/index.js` | [`terminal/history/README.md`](../runtime/static/terminal/history/README.md) | cursor、history generation、replay 门禁、client history 兼容 |
| output queue | `terminal/output/index.js` | [`terminal/output/README.md`](../runtime/static/terminal/output/README.md) | live/replay/suppressed output、有界 drain、ACK 和过载处理 |
| transport | `terminal/transport/index.js` | [`terminal/transport/README.md`](../runtime/static/terminal/transport/README.md) | Unified/direct socket、协议、health、membership、主题和控制消息 |
| rendering/presentation | `terminal/rendering/index.js` | [`terminal/rendering/README.md`](../runtime/static/terminal/rendering/README.md) | Ghostty renderer、Canvas、presentation、Kitty graphics、frame hold |
| resize | `terminal/resize/index.js` | [`terminal/resize/README.md`](../runtime/static/terminal/resize/README.md) | geometry、DPR、resize owner、单 in-flight/latest target、ACK fence 和桌面 live geometry |
| viewport | `terminal/viewport/index.js` | [`terminal/viewport/README.md`](../runtime/static/terminal/viewport/README.md) | 移动 visualViewport、软键盘、安全偏移和方向恢复 |
| session | `terminal/session/index.js` | [`terminal/session/README.md`](../runtime/static/terminal/session/README.md) | pane identity、初始状态、resource factory、安装和销毁 |
| input | `terminal/input/index.js` | [`terminal/input/README.md`](../runtime/static/terminal/input/README.md) | textarea、输入队列、IME、generated response、focus、移动快捷键 |
| interaction | `terminal/interaction/index.js` | [`terminal/interaction/README.md`](../runtime/static/terminal/interaction/README.md) | 菜单、搜索、链接、复制粘贴和终端交互编排 |
| mouse | `terminal/mouse/index.js` | [`terminal/mouse/README.md`](../runtime/static/terminal/mouse/README.md) | mouse protocol 和终端鼠标事件 |
| selection | `terminal/selection/index.js` | [`terminal/selection/README.md`](../runtime/static/terminal/selection/README.md) | 终端选区、复制和选择浮层 |
| overview | `terminal/overview/index.js` | [`terminal/overview/README.md`](../runtime/static/terminal/overview/README.md) | tab 总览、live/hold/persisted 缩略图和拖拽 |
| screenshot | `terminal/screenshot/index.js` | [`terminal/screenshot/README.md`](../runtime/static/terminal/screenshot/README.md) | 终端 scrollback 长截图 |
| metrics | `terminal/metrics/index.js` | [`terminal/metrics/README.md`](../runtime/static/terminal/metrics/README.md) | 字体 metrics、live options 和尺寸估算 |
| policy | `terminal/policy/index.js` | [`terminal/policy/README.md`](../runtime/static/terminal/policy/README.md) | 工具识别和终端策略 |
| TUI adapters | `terminal/tui_adapters/index.js` | [`terminal/tui_adapters/README.md`](../runtime/static/terminal/tui_adapters/README.md) | Claude/工具 TUI 的隔离适配 |

终端模块的典型依赖方向：

```text
global-runtime
  -> workspace/session
  -> transport/history/output
  -> rendering/resize/viewport/input
  -> interaction/overview/screenshot/selection
```

实际 controller 之间只能通过显式依赖、公开 API、事件或只读快照交互。不要因为某个功能同时涉及多个终端域，就把状态重新放回 `global-runtime.js` 或创建新的共享大对象。

分屏条拖拽的跨模块契约是：workspace layout controller 只按 RAF latest-only 更新 flex 比例，并通过公开命令通知 resize controller begin/update/end；resize controller 独占 live session、节流/trailing timer、单 in-flight/latest target 和最终 claim。拖动中本地 Ghostty 网格/Canvas 可有界实时重排，observer 与普通 resize 不得竞争，也不得为 pointermove 创建网络 epoch；释放时 resize controller 强制最终本地 fit 并以 `claim:true` 提交稳定尺寸。presentation 在 live geometry 中不使用 hold，replay/reconnect 等恢复仍保持原子提交；overview preview 暂停编码并在稳定后补帧。`global-runtime.js` 只负责命令和只读门禁接线，不复制事务状态。

## 3.3 诊断模块

| 责任域 | 公开入口 | 模块文档 | 主要职责 |
| --- | --- | --- | --- |
| 页面与终端诊断 | `runtime/static/diagnostics/index.js` | [`diagnostics/README.md`](../runtime/static/diagnostics/README.md) | 调试开关、启动追踪、一次性初始化性能、运行时性能/网络采样和终端诊断时间线 |

初始化性能由 diagnostics controller 持有开关和生命周期，只观察 `startupDiagnostics` 与候选终端 session 的公开事件，以第一个完成 `presentation_commit_complete` 的 session 作为结果；完成后冻结，不参与终端连接、replay、resize 或渲染调度。

| 文件 | 状态/责任 |
| --- | --- |
| [`main.go`](../main.go) | Provider server、HTTP mux、认证边界、静态资源、WebSocket 入口、输入锁和发布代理 |
| [`workspace.go`](../workspace.go) | `workspaceManager`、`terminalWorkspace`、tab/pane、PTY、history、cursor、resize owner、客户端集合 |
| [`agent.go`](../agent.go) | agent daemon 命令、Unix socket、workspace state/action/activity、PTY attach、history replay frame |
| [`agent_runtime.go`](../agent_runtime.go) | agent 安装 manifest、启动/停止、reconcile、ping、ensure single-flight、`lightosctl exec` 请求和直接 attach |
| [`terminal_queue.go`](../terminal_queue.go) | Unified broker、logical subscriptions、单 writer、outbound queue、flow control、binary header、ACK 和 resize/control |
| [`client_terminal.go`](../client_terminal.go) | `client:` 目标的票据、代理请求和 WebSocket 转发 |
| [`settings.go`](../settings.go) | 服务端 settings/font API、账号隔离和字段持久化 |
| [`instances`/`devices`/`attachments` 相关 Go 文件](../main.go) | Provider API 和 LightOS/Admin 边界，不由浏览器直接接触内部凭据 |
| [`server_log.go`](../server_log.go) | 进程级 Go log 捕获、有限环形历史、非阻塞订阅、脱敏和诊断消息 |

后端修改时先确认目标是：

- Provider API 语义：看 `main.go` 和对应域 Go 文件/测试。
- workspace/tab/pane 权威状态：看 `workspace.go` 和 `workspace_test.go`。
- agent 生命周期或 `lightosctl`：看 `agent_runtime.go`、`agent.go` 和对应测试。
- Unified 协议或队列：看 `terminal_queue.go`、`terminal_queue_test.go`、前端 `terminal/transport/README.md`。
- replay/history：同时看 `agent.go` 的服务端 frame、`workspace.go` 的 history 和前端 `terminal/history/README.md`。

## 5. 诊断、测试和回归路径

### 5.1 Node 行为测试

- 目录：[`tests/`](../tests/)
- 规范：[`tests/README.md`](../tests/README.md)
- 运行：`node --test tests/*.mjs`
- 作用：验证 controller、model、协议解析、generation、lifecycle 和模块边界。
- 不替代真实 Provider/agent/PTY/浏览器回归。

### 5.2 真实浏览器/设备回归

- 总说明：[`tests-auto/README.md`](../tests-auto/README.md)
- 运行器：[`tests-auto/run-playwright.mjs`](../tests-auto/run-playwright.mjs)
- 全部场景：`./tests-auto/test-all.sh`
- 单个场景：`node tests-auto/run-playwright.mjs tests-auto/<场景目录>/test.mjs`
- 当前前端资源映射：`WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static"`
- 失败产物：对应场景目录的 `artifacts/`，包含截图、trace、JSONL 事件和错误摘要。

当前场景导航：

| 场景目录 | 覆盖范围 |
| --- | --- |
| [`tests-auto/01-multi-device-resize-sync/`](../tests-auto/01-multi-device-resize-sync/) | PC/移动端共享 pane、尺寸 claim、PTY 输出同步和跨设备 resize |
| [`tests-auto/02-terminal-input/`](../tests-auto/02-terminal-input/) | PC/移动端终端输入和输入状态 |
| [`tests-auto/03-terminal-ime/`](../tests-auto/03-terminal-ime/) | 移动端 IME、composition 和输入法交互 |
| [`tests-auto/04-terminal-viewport/`](../tests-auto/04-terminal-viewport/) | visualViewport、折叠/展开、键盘和移动 viewport |
| [`tests-auto/05-terminal-output/`](../tests-auto/05-terminal-output/) | 真实 PTY 输出、大块/持续输出、隐藏 tab、resize、Canvas 原子呈现和 Unified 连接数 |
| [`tests-auto/06-workspace-tabs/`](../tests-auto/06-workspace-tabs/) | tab/pane 创建、重命名、刷新持久化和单 Unified 连接 |
| [`tests-auto/07-workspace-retry/`](../tests-auto/07-workspace-retry/) | workspace 失败、退避重试、恢复和同一 tab 保持 |
| [`tests-auto/08-terminal-click-jitter/`](../tests-auto/08-terminal-click-jitter/) | 点击期间几何、Canvas 和连接稳定性 |
| [`tests-auto/09-terminal-interaction-jitter/`](../tests-auto/09-terminal-interaction-jitter/) | 输入、选择、滚动、textarea 和 Canvas 几何抖动 |
| [`tests-auto/10-terminal-geometry-jitter/`](../tests-auto/10-terminal-geometry-jitter/) | 几何事件、RAF 采样、backing store 和稳定尺寸 |
| [`tests-auto/11-service-worker-retirement/`](../tests-auto/11-service-worker-retirement/) | 旧 Worker 退役、缓存清理和干净页面导航 |
| [`tests-auto/12-overview-preview-persistence/`](../tests-auto/12-overview-preview-persistence/) | tab 总览缩略图、live/hold/persisted preview 和 reload |
| [`tests-auto/13-split-divider-render-isolation/`](../tests-auto/13-split-divider-render-isolation/) | 双 pane 持续输出下高频拖动、live Canvas 顶部锚定/隔离、单 in-flight 最终 resize 和页面响应性 |

### 5.3 与当前终端初始化问题相关的诊断指标

分析终端首次加载、持续输出或黑屏时，优先查看：

```text
socket_open
agent_preparing
history_replay_start
first_binary_output
history_replay_complete
output_queued
output_flush_enter / output_flush_exit
resize_request / resize_applied
presentation_deferred
presentation_retry_scheduled
full_render_*
presentation_commit_complete
resume_signal / resume_deadline_*
```

关键不变量：

```text
receivedCursor >= appliedCursor >= presentedCursor
```

但不同事件的语义必须分开：

- `receivedCursor`：浏览器收到的数据边界。
- `appliedCursor`：数据已按序进入 Ghostty 状态的边界。
- `presentedCursor`：数据已经包含在用户可见提交中的边界。
- `history_replay_complete` 不能自动假设 output queue 已 drain 或 Canvas 已 commit。
- `xN` 是诊断层聚合计数；Unified fan-out 后的同一 `server_log_seq` 不等于服务端执行了 N 次。

## 6. 修改和维护本文的规则

只有以下变更需要更新本文和受影响模块 README：

- 新增或删除架构层、公开入口、模块目录或模块 README。
- 改变状态 owner、Provider/agent/PTY/Unified/Canvas 的责任边界。
- 改变普通容器或 `client:` target 的主数据流。
- 新增或删除 `tests-auto` 场景，或改变某个场景的覆盖责任。
- 调整模块实现职责、依赖方向、公开 API、生命周期或资源清理边界。

架构、实现和模块文档必须在同一次变更中同步更新；如果调整只影响模块内部实现而不改变架构边界，也应更新对应模块 README 中的文件清单、生命周期、测试或实现说明（如有变化）。

以下内容不应写入本文：

- 单个 Bug 的完整时间线和每次尝试；写入对应 `tests-auto` 场景 README。
- 所有历史修复记录；按需维护在场景文档和模块 README。
- 与当前任务无关的模块内部实现细节；直接链接模块 README。
- 用户账号、密码、token、cookie、PTY 输出或命令输入。

更新本文时必须同步检查：

- 路径和 README 链接是否存在。
- `index.js` 公开入口是否仍然准确。
- 责任边界是否与代码和模块 README 一致。
- 相关 `tests-auto` 场景是否仍能被 `test-all.sh` 发现。
- `git diff --check` 和相关静态契约测试是否通过。
