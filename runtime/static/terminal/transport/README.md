# 终端传输模块

## 职责与边界

本目录负责 session 连接生命周期、WebSocket 协议事件接线、重连策略、logical membership、pane retry、`client:` 直连调度、Fast 完整性帧、Queue/Unified 协议、Unified 物理连接 owner 和健康检查。普通容器只能有一条 Unified 物理 WebSocket；pane 只拥有 logical stream。`client:` target 继续最多三条独立直连，不能套用容器缓存或 Unified 假设。

传输层不拥有历史权威、Canvas 可见性、resize 提交或输入展示；`session_protocol_controller.js` 只负责把连接事件路由到注入的 history/output/resize/presentation 命令，不持有这些模块的状态。单 pane 的协议、sequence、checksum 或 resync 错误不得关闭物理 Unified 连接或影响兄弟 stream。`websocket_url.js` 只提供无状态 URL 转换，不创建 socket。

## 公开入口与状态

外部只能从 `terminal/transport/index.js` 导入 API。`unified_transport_controller.js` 是页面唯一 Unified 物理连接、target、close fence、恢复任务和 watchdog 的 owner；`transport_runtime_controller.js` 独占 logical membership、channel generation、pane retry、可视顺序、direct demand generation 和 scheduler lease 编排；`transport_runtime_lifecycle.js` 独占 priority/retry timer、measurement RAF 和 logical sync microtask；`session_connection_controller.js` 是 pane 健康与失败分流 owner，`session_connection_lifecycle.js` 独占 connect、health、attach-ready、resume-probe 和 reconnect timer。所有 socket、timer 和迟到回调必须按 close fence、generation、target 和 logical identity 清理或拒绝。异常断线建立的 close fence 在旧 socket 真正关闭或 fence 超时前不得清除，也不得创建替代物理连接。

## 文件

- `index.js`：唯一公开入口。
- `session_connection_controller.js`：pane 连接健康判断、direct/unified 重连分流和 scheduler 协作。
- `session_connection_lifecycle.js`：connect/health/attach/resume/reconnect timer、默认 ping JSON serializer 与迟到 socket guard。
- `session_protocol_controller.js`：建立当前 lease/logical stream 的 WebSocket、绑定 open/message/close/error 生命周期，并把 history、binary output、Queue ACK 和进程状态事件路由到显式依赖；不拥有跨模块状态。
- `transport_runtime_controller.js`：logical membership、pane retry、Unified stream generation、可视优先级和 `client:` direct scheduler 编排。
- `transport_runtime_lifecycle.js`：连接优先级衰减、logical retry timer、测量 RAF、sync microtask 和 session 清理。
- `unified_transport_controller.js`：页面级 Unified 物理连接、target、close fence、watchdog 和恢复生命周期。
- `terminal_connection_scheduler.js`：`client:` 独立连接配额调度。
- `terminal_fast_integrity.js`：Fast frame 编解码与校验。
- `terminal_queue_connection.js`：Queue/Unified 共享帧协议和连接实现。
- `terminal_unified_connection.js`：单物理连接与 logical stream API。
- `terminal_unified_health.js`：物理连接 watchdog。
- `terminal_unified_membership.js`：workspace pane membership 与 priority。
- `websocket_url.js`：页面 endpoint 到 `ws:`/`wss:` 的 URL 解析和协议校验纯函数，以及 Unified endpoint 的 transport query 构造；不创建 socket。
- `theme_controller.js`：校验已打开的 session socket 并发送 appearance 提供的终端主题 payload；不拥有主题状态或连接生命周期。

## 验证

行为测试包括 `terminal_session_connection_controller_test.mjs`、`terminal_transport_runtime_controller_test.mjs`、`terminal_unified_transport_controller_test.mjs`、`terminal_connection_scheduler_test.mjs`、`terminal_queue_connection_test.mjs`、`terminal_unified_health_test.mjs`、`terminal_unified_membership_test.mjs`、`terminal_fast_integrity_test.mjs`、`terminal_websocket_url_test.mjs` 和 `terminal_theme_controller_test.mjs`。最小回归是同容器创建多个 pane、关闭一个 pane、断网恢复，以及 `client:` 四 pane 争用三条直连；确认旧物理 close fence 完成前不会创建替代连接、普通容器始终只有一条物理连接且兄弟 pane 不受影响。
