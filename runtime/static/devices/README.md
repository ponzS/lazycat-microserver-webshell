# Devices 模块

## 职责

本目录负责浏览器设备在线状态：维护可选设备心跳、读取当前账号可见的短 TTL 在线设备列表、渲染在线设备面板，并在页面隐藏或销毁前发送离线 beacon。

本模块不负责账号认证、设备 TTL 的权威判断、实例发现、终端会话、WebSocket、历史回放、resize、输入或 Canvas 渲染。账号隔离和过期淘汰继续由 Provider 服务端负责。

## 公开入口

外部只能从 `devices/index.js` 导入 `createDevicesController()`，不得深度导入内部文件。

Controller 公开以下集成方法：

- `start()` / `dispose()`：幂等启动和销毁。
- `setDebugMode(enabled)` / `syncControls()`：接收 diagnostics 的只读调试总控状态并同步设置控件。
- `openPanel()` / `closePanel()` / `isPanelOpen()` / `handleEscape(event)`：管理设备面板。
- `handleResume()` / `handleResize()` / `handlePageHide()`：接收应用生命周期信号。
- `heartbeatNow()` / `refreshList()`：供测试和显式恢复路径触发受 guard 保护的请求。
- `snapshot()`：只读测试快照，不暴露可变内部状态。

## 状态所有权

`devices_controller.js` 是唯一状态 owner，独占以下状态：

- 心跳开关持久化值、active/in-flight/error、interval、timeout、AbortController 和 generation。
- 在线列表 entries、loading/loaded、内容 signature、error、request generation、in-flight 请求和刷新 interval。
- 面板打开状态、延迟 focus timer 和 dispose 状态。

diagnostics 只通过 `setDebugMode()` 控制是否允许启动，不保存或修改设备数据。`global-runtime.js` 只转发生命周期和弹层编排命令。

## 生命周期

`start()` 注册本模块 DOM listener，并在调试总控和心跳开关同时启用时启动单一心跳 interval。重复启动不会重复注册资源。

关闭调试总控会先尽力发送离线 beacon，再停止心跳和列表 interval、abort 在途请求并关闭设备面板。关闭或重开面板会递增列表 generation，旧响应不得更新新面板。`dispose()` 会移除全部 listener、清理 timer、abort 请求、关闭面板并拒绝迟到回调。

离线 beacon 仅在心跳 active、浏览器在线且支持 `navigator.sendBeacon` 时发送。服务端仍以 account ID 和短 TTL 作为在线状态权威。

## 文件清单

- `index.js`：唯一公开入口。
- `devices_controller.js`：模块编排、状态所有权、请求 generation、timer 和清理。
- `devices_api.js`：仅维护 `/api/devices`、`/api/devices/heartbeat` 和 `/api/devices/offline` Provider 路由。
- `devices_model.js`：平台/浏览器识别、设备记录归一化和列表 signature 纯函数。
- `devices_view.js`：设备设置控件、面板 DOM 和列表渲染。
- `devices_lifecycle.js`：DOM listener 注册与移除。

## 依赖方向

`global-runtime.js -> devices/index.js -> devices_controller.js -> api/model/view/lifecycle`。

模块可以接收调试状态、性能计量、错误日志、移动布局判断和终端 focus 回调，但不能反向导入 diagnostics、settings、workspace 或 terminal 实现，也不能修改这些模块的状态。

## 测试与回归

- `devices_controller_test.mjs` 覆盖心跳单 in-flight、超时/abort、调试总控关闭、迟到列表拒绝、Provider 路由、beacon 条件和 listener 清理。
- `TestRuntimeDeviceManagementStaticGuards` 固定公开入口、README、Service Worker 资源、`global-runtime.js` 集成和禁止旧实现残留。
- `devices_test.go` 继续覆盖服务端账号隔离、短 TTL、heartbeat 和 offline 行为。

最小回归：开启调试模式和设备心跳，确认在线设备面板定时刷新；关闭面板、关闭调试模式、切换页面显隐和离开页面后，确认无残留 interval、无迟到列表覆盖，且离线 beacon 只在心跳 active、浏览器在线并支持 `sendBeacon` 时发送。任何验证都不得触发或展示终端历史回放过程。
