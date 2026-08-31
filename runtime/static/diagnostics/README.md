# Diagnostics 模块

## 职责

本目录负责 WebShell 前端的只读诊断能力：调试总控、错误日志、启动追踪、性能任务采样、FPS/刷新率显示、终端网络流量监视和终端事件时间线。

诊断模块只观察应用状态并展示或记录结果，不得修改终端连接、历史、渲染、resize、输入、工作区或设备数据。设备心跳、强制 PC 模式等业务功能仍由各自模块维护，诊断模块只通过调试总控变更回调通知它们重新同步。

## 公开入口

外部只能从 `index.js` 导入：

- `createStartupDiagnostics()`：维护页面启动指标和启动追踪队列。
- `createDiagnosticsController()`：创建诊断模块唯一控制器。

控制器公开日志、性能记录、终端事件记录、只读开关查询、网络 socket 快照同步、`start()` 和幂等 `dispose()`。外部不得深度导入本目录中的其他文件。

## 状态所有权

`diagnostics_controller.js` 是以下状态的唯一 owner：

- 调试模式、错误日志、网络监视器、FPS 监视器和性能任务开关。
- 调试日志记录、去重索引和 console/window 捕获状态。
- 性能任务样本、FPS RAF、网络监视器动态模块 generation、采样 timer 和 socket instrumentation。
- 每个终端 session 的诊断时间线。时间线保存在模块内部 `WeakMap`，不写入业务 session 对象。

状态通过显式方法、只读查询和回调交互，不通过 `window` 可变字段共享。

## 生命周期

- `createDiagnosticsController()` 会读取持久化开关并立即恢复已启用的错误捕获，以覆盖早期启动错误。
- `start()` 绑定设置控件并启动当前已启用的采样器。
- 调试总控关闭时，FPS RAF、性能采样、网络采样 timer、socket 包装、console 包装和 window 错误监听必须全部停止。
- `dispose()` 可重复调用；所有 listener、timer、RAF、动态加载 generation 和 socket instrumentation 都必须清理。
- 网络监视器保持按需动态加载，未启用时不得进入 bootstrap 预加载或其他静态资源预取路径。

## 文件清单

- `index.js`：模块唯一公开入口。
- `diagnostics_controller.js`：状态 owner 和模块编排。
- `diagnostics_lifecycle.js`：设置事件、网络动态加载、timer 和 socket instrumentation 生命周期。
- `diagnostics_view.js`：诊断控件、日志、性能任务和网络面板 DOM 适配。
- `network_context.js`：把当前终端连接转换为只读网络快照，不修改 session 或连接状态。
- `debug_log.js`：日志去重、脱敏、console/window 捕获和复制文本生成。
- `performance_meter.js`：FPS/刷新率 RAF 与 DOM 生命周期。
- `performance_tasks.js`：无 DOM 的性能任务采样器。
- `network_monitor.js`：无业务依赖的 WebSocket 字节与速率采样器，按需加载。
- `startup_trace.js`：启动指标 owner 和追踪队列。
- `terminal_timeline.js`：终端诊断时间线和 Ghostty runtime 计数适配。

## 依赖方向

`global-runtime.js -> diagnostics/index.js -> diagnostics_controller.js/network_context.js`。控制器和快照 adapter 可以依赖本目录内部实现；内部文件不得反向导入 `global-runtime.js`，也不得导入工作区、终端 transport 或渲染实现。终端连接状态只能通过 `getNetworkContext()` 提供的只读快照进入本模块。

## 测试与回归

- `diagnostics_controller_test.mjs`：开关持久化、生命周期清理、迟到动态加载和业务回调边界。
- `terminal_network_monitor_test.mjs`：WebSocket 字节、通道、速率和 dispose 行为。
- `runtime_shortcuts_test.go`：公开入口、版本化静态资源和 `global-runtime.js` 不再持有诊断实现的静态契约。

最小回归步骤：开启调试模式后分别启用错误日志、网络监视器、FPS 和性能任务；产生一次 console error 和终端流量；关闭调试总控，确认全部面板隐藏且不再采样；重新开启后确认子开关仍保持；离开页面后确认 WebSocket 方法、console 方法和全局监听均恢复。
