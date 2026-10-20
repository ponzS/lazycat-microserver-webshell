# LightOS WebShell 接入层

本包维护既有 Linux Provider：实例发现、鉴权、HTTP 路由、容器 agent 接入及外部资源。它不是供 PC 直接嵌入的终端核心。

## 入口与文件

- `server.go`：`Run(*core.Runtime)`、HTTP 监听与路由。根入口负责创建 Runtime。
- `instances.go`、`authorization.go`、`admin.go`、`publish.go`：实例列表、账号可见性、LightOS Admin 对接及服务发布。
- `instance_order.go`：`GET/POST /api/instance-order`，转发到管理端公开的 `/unsafe_api/instance-order`，沿用当前认证账号、Provider Origin 白名单和公开 selector，不引用管理端内部文件或 Go 包。只读/移动的是实例展示偏好，不改工作区与标签；新管理端未部署时返回真实错误，不冒充服务端保存成功。
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

当前推荐 Agent 协议为 v52，显式保留 v51/v50/v49/v48/v47/v46/v45/v44/v43/v42/v41/v40/v39 及既有版本的 attach 兼容和工作区恢复能力。v39/v40/v41/v42/v43/v44/v45/v46/v47/v48/v49/v50 共用初始化复用页面单元格的 WASM；容器启动 attach 时仅与这些版本协商内存快照，旧 Agent 使用原始字节回放，不自动替换或停止旧进程。v38 及之前的旧快照不能导入这些版本。v40 的物理机服务发布隧道不改变容器终端协议；v41 只调整客户端运行时代码归属；v42 新增浏览器光标样式设置；v43 修正物理机 activity 采集；v44 增加只读工作区查询，v45 刷新只读查询中已有 pane 的进程身份，v46 增加物理机工作区读取兼容，v47 增加历史代次和输出游标，v48 增加应用生命周期及累计完成次数。物理机采用新版终端核心后提供对应的新增元数据；终端帧、快照和 WASM 保持兼容。兼容的旧 Agent 不自动替换或停止。v49 只增加 Provider 对公开账号实例顺序接口的桥接，帧格式、工作区元数据和快照格式均不变；显式保留 v48 的 attach、恢复和 WASM 兼容，排序不要求替换旧 Agent。v50 补齐 Core 的 OSC 7501 能力应答，先于 DA sentinel 发送，使遵循该协议的 CLI 自动启用生命周期上报；不改变帧、元数据或快照格式，显式保留 v49 的兼容能力。能力应答依赖目标终端核心更新，但不自动替换或重建已有会话。v51 把终端核心升级为 Ghostty 1.4，快照改为可移植的 `ghostty-snapshot-v1`（`GHOSTSNP`）：仅当实际 Agent 版本等于当前协议时才传 `--checkpoint-protocol ghostty-snapshot-v1`；旧原生客户端请求的 `ghostty-memory-v1` 只传给 v39–v50，v51 对其回放原始字节。当前协议的 Agent 在 `agent_capabilities` 中公布 `ghostty_snapshot_v1`。

v52 在 v51 之上透传可选 `pane.agent {id,name,source}`（含通过 `di` 挂载的 agent，`source` 为 `di`；识别已安装的 Antigravity CLI `agy`）；旧客户端可忽略新增字段。身份不推断工作状态；无可靠进程身份时省略，继续显示普通命令。v52 同时撤回 OSC 133 语义区段的 agent 生命周期推断，并处理 CAN/SUB 取消控制字符串。帧、元数据和 `ghostty-snapshot-v1` 快照格式与 v51 相同，快照协商同时接受 v51 与 v52。Provider 与实例 daemon 需同时更新才有 agent 身份；已兼容的 v51 daemon 不会自动停止。只重启 Provider 不会停止独立实例 daemon；重启目标 daemon 会丢失其 shell/PTY 与内存历史，独立 DI 的 setsid daemon/子 PTY 可由 `di` 重新连接。

当前推荐 Agent 协议为 v47，显式保留 v46/v45/v44/v43/v42/v41/v40/v39 及既有版本的 attach 兼容和工作区恢复能力。v44 固定 Zig 0.15.2，并隔离完整 WebShell 补丁的编译缓存；干净构建的 WASM 指纹与 v39–v43 不同。容器启动 attach 时仅与 v44 协商内存快照；浏览器也按物理连接报告的 Agent 版本限制快照请求，旧容器和 PC Agent 继续使用原始字节回放，不自动替换或停止旧进程。v40 的物理机服务发布隧道、v41 的客户端运行时代码归属、v42 的浏览器光标设置和 v43 的认证持续通道能力均保留，终端帧和 checkpoint 格式不变。后续 Agent 版本或 WASM 指纹变更时，需同步核对本文件中的兼容列表、attach 快照门禁及前端 `checkpoint_transport.js` 的快照版本列表。

`program_status` 是可选对象，转发旧终端响应时必须保留字段缺失，不能补成零值对象，否则浏览器会误以为旧核心已经提供应用状态而关闭实时信号兼容。旧核心的当前连接由浏览器旁路观察实时生命周期控制序列；后台实例完整状态需要核心提供 v48 元数据。

`workspace_inspection.go` 提供 `GET /api/workspace?name=<selector>&inspect=1`，沿用容器/物理机的授权和账号隔离。容器使用支持检查的 Agent `inspect`，按实际版本补齐已有排序能力；物理机通过 `client_workspace_inspection.go` 优先读取 `/workspace/inspect`，仅当终端服务的这个路由确实返回 404/405 时兼容读取既有 `/workspace`。票据服务的 404/405、认证失败和其他请求错误不能被误判成客户端版本问题。

物理机兼容路径不调用重启恢复，不发送激活、尺寸、滚动历史修改或重建动作；旧核心保留原有首次读取默认工作区的初始化语义。这里只按 Provider、账号及 selector 缓存一分钟的路由选择，不缓存票据或会话内容；记录在兼容读取之前建立，避免慢请求每次重试都重复探测缺失路由。过期后重新检查专用接口，服务升级或重启后可以自行恢复。不得仅凭检查路由缺失要求更新 PC 客户端，也不自动替换正在工作的客户端进程。

`settings.go` 的 `GET /api/settings` 返回 `terminal_cursor_style`；既有字段级更新入口 `PUT /api/settings` 接受 `block`、`bar`、`underline`，未提供或传入 `null` 时不修改该字段，其他值返回 400。设置沿用字体目录内的原子存储，光标样式不下发 PTY、不触发重放。手工验证样式保存、刷新、修改其他设置后保留样式，以及无效值不会覆盖已有配置。

容器 Unified 转发复用 Core 的 `LogCheckpointDiagnostic`；原 attach 转发也在收到结构化故障时调用同一去重入口，因此首次解析故障进入应用汇总日志，不要求浏览器开启调试。不转发整个 Agent 日志文件，也不更改消息、ACK、尺寸边界或 PTY 生命周期。

v44 增加 `mobile_pre_input_enabled` 设置：GET 返回布尔值，PUT 支持字段级修改，缺失或 null 保持原值，旧配置默认关闭。它仅控制移动端预输入显示，不下发 PTY。显式保留 v43 及既有版本的 attach、工作区恢复和内存快照兼容；无须更新旧 Agent 即可使用此界面能力。

客户端 launcher v4 通过公开的限实例接入 API 自行注册、发心跳与准备更新，宿主管理首次安装和应用入口授权。Agent v47 在缓存启动时先准备目标版本，再创建 worker；私有 Unix IPC 和原版 SDK 扩展点保持。终端帧与 checkpoint 格式保持兼容，显式保留 v46/v45/v44 及已有兼容版本。

客户端票据响应可含 terminal_certificate；存在时通过 clienttransport 在原 SDK gRPC 流内建立固定 worker 证书的 TLS 连接，保持现有终端和文件 API。没有证书字段的旧客户端继续 HTTP 路径。

当前 Agent 协议为 v51，原生运行时状态使用 LightOS LPK 版本并保留产物摘要；launcher v5、host_protocol 1、终端帧、SSH/发布及 checkpoint 格式不变，显式保留 v50/v49/v48 和既有 attach 兼容列表。

合并保留主分支的物理机 activity 身份修复、活动进程命令行/目录采集及移动端 TUI 手势所需信息。运行时与 PTY 分发职责仍按本分支方案执行。
Agent v52 仅调整物理机运行时的进程内 PTY 依赖，网络与业务协议不变，显式保留 v51 的 attach 和工作区恢复。Provider 不代理 hportal PTY RPC，仍经现有应用流访问本机 Webshell 服务。
