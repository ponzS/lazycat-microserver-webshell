# LightOS WebShell 接入层

本包维护既有 Linux Provider：实例发现、鉴权、HTTP 路由、容器 agent 接入及外部资源。它不是供 PC 直接嵌入的终端核心。

## 入口与文件

- `server.go`：`Run(*core.Runtime)`、HTTP 监听与路由。根入口负责创建 Runtime。
- `instances.go`、`authorization.go`、`admin.go`、`publish.go`：实例列表、账号可见性、LightOS Admin 对接及服务发布。
- `assets.go`、`static_compression.go`：前端资源、缓存策略、内容版本和旧 Service Worker 兼容。
- `container_backend.go`、`container_activity.go`：实现 Core 的目标/队列后端接口，集中 `lightosctl` 命令与远程活动扫描。
- `agent_runtime.go`、`agent_protocol_update.go`：agent 安装、版本检查、复用、更新和原 attach 路径。
- `terminal_queue.go`：Unified WebSocket 的 HTTP 鉴权、升级、准备与控制分派；队列算法属于 Core。
- `workspace.go`、`workspace_recovery.go`：工作区 HTTP 接口与按账号/实例保存的可选重启恢复描述。
- `client_terminal.go`、`client_recovery.go`：PC 票据/Unified 转发与可选布局恢复，共用账号隔离的文档存储，不引用容器安装逻辑。
- `attachments.go`、`settings.go`、`devices.go`：原文件、设置和设备接口。
- `dependencies.go`：显式列出沿用原调用形式的 Core/Unix/日志接口别名，便于审查跨包依赖。

## 边界与约束

本包依赖 Core、Unix 适配和内部公共模块；不得引用 lightos-admin 的内部 Go 包或私有实现。Core 不反向导入本包。

保留原账号、selector 与票据验证次序；HTTP 路径、头、状态码和 WebSocket 消息不因文件迁移改变。容器的用户名选择与用户切换脚本保持原有规则。

v35 显式兼容 v34/v33/v32/v31/v30/v29/v28/v27 及原容器兼容版本，版本升级不自动终止兼容的容器 agent。客户端的可选按需指标接口不改变容器入口和 v30 的 Local `queue-ready` 握手。二进制名、`agent` 子命令及 LPK 内的 `runtime/` 布局保持不变；Provider 不编入独立 SSH module。

版本是否最新、是否可 attach、是否支持工作区恢复、是否可导入内存快照是不同判断：v27/v28/v29/v30/v31/v32/v33/v34 继续提供标签排序和工作区恢复，v26/v27/v28/v29/v30/v31/v32/v33/v34/v35 使用同一快照 WASM；更早的兼容 agent 沿用字节回放。以后升级不能只修改版本常量而漏掉这些能力边界。

## 验证

根目录执行 `go build .`、`go vet ./...`、`npm run build`。既有 `lzc-build.yml` 和 lightos-admin 的 `lightos-build.sh` 继续使用同一构建入口及内嵌校验。

实际功能回归按 `spec-tests/ENVIRONMENT.md` 绑定设备/账号，检查容器列表、授权、工作区、文件、统一连接和重连；未在真实环境执行的内容不能标记通过。

当前推荐 Agent 协议为 v47，显式保留 v46/v45/v44/v43/v42/v41/v40/v39 及既有版本的 attach 兼容和工作区恢复能力。v44 固定 Zig 0.15.2，并隔离完整 WebShell 补丁的编译缓存；干净构建的 WASM 指纹与 v39–v43 不同。容器启动 attach 时仅与 v44 协商内存快照；浏览器也按物理连接报告的 Agent 版本限制快照请求，旧容器和 PC Agent 继续使用原始字节回放，不自动替换或停止旧进程。v40 的物理机服务发布隧道、v41 的客户端运行时代码归属、v42 的浏览器光标设置和 v43 的认证持续通道能力均保留，终端帧和 checkpoint 格式不变。后续 Agent 版本或 WASM 指纹变更时，需同步核对本文件中的兼容列表、attach 快照门禁及前端 `checkpoint_transport.js` 的快照版本列表。

`settings.go` 的 `GET /api/settings` 返回 `terminal_cursor_style`；既有字段级更新入口 `PUT /api/settings` 接受 `block`、`bar`、`underline`，未提供或传入 `null` 时不修改该字段，其他值返回 400。设置沿用字体目录内的原子存储，光标样式不下发 PTY、不触发重放。手工验证样式保存、刷新、修改其他设置后保留样式，以及无效值不会覆盖已有配置。

容器 Unified 转发复用 Core 的 `LogCheckpointDiagnostic`；原 attach 转发也在收到结构化故障时调用同一去重入口，因此首次解析故障进入应用汇总日志，不要求浏览器开启调试。不转发整个 Agent 日志文件，也不更改消息、ACK、尺寸边界或 PTY 生命周期。

客户端 launcher v4 通过公开的限实例接入 API 自行注册、发心跳与准备更新，宿主管理首次安装和应用入口授权。Agent v47 在缓存启动时先准备目标版本，再创建 worker；私有 Unix IPC 和原版 SDK 扩展点保持。终端帧与 checkpoint 格式保持兼容，显式保留 v46/v45/v44 及已有兼容版本。

客户端票据响应可含 terminal_certificate；存在时通过 clienttransport 在原 SDK gRPC 流内建立固定 worker 证书的 TLS 连接，保持现有终端和文件 API。没有证书字段的旧客户端继续 HTTP 路径。

当前 Agent 协议为 v51，原生运行时状态使用 LightOS LPK 版本并保留产物摘要；launcher v5、host_protocol 1、终端帧、SSH/发布及 checkpoint 格式不变，显式保留 v50/v49/v48 和既有 attach 兼容列表。
