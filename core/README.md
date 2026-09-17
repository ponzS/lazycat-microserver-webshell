# 共用终端核心

本包拥有终端业务状态，不依赖 LightOS 设备发现、容器命令、PC UI 或平台实现。现阶段对外提供原 agent 命令与 Unified broker；独立跨平台 HTTP 服务入口留待下一阶段。

## 入口与文件

- `runtime.go`：`NewRuntime`、`Platform`、`TargetAccess`、`QueueBackend`。启动入口注入依赖，每个 Runtime/工作区持有自己的适配器，不使用可变的全局平台注册表。
- `agent.go`、`agent_cli.go`、`agent_protocol.go`、`agent_workspace.go`、`agent_attach.go`：原 `agent version/daemon/request/attach/reconcile` 入口、请求身份检查和帧协议。
- `types.go`、`workspace*.go`、`layout.go`：工作区、标签、分屏、活动状态、布局和显式重建。对外状态继续使用原 JSON 字段。
- `pane.go`、`pane_control.go`、`pane_resize.go`、`pane_replay.go`、`subscriber.go`：PTY 会话生命周期、输入、尺寸所有权、恢复与订阅队列。
- `history.go`、`queries.go`、`query_echo.go`、`private_control.go`：有界历史、主题/终端查询应答、生成输入回显过滤和私有元数据。
- `terminal_checkpoint*.go`：固定 WASM 的状态快照、gzip、诊断和原始历史 fallback。
- `terminal_queue*.go`、`queue_protocol.go`、`queue_stream.go`：逻辑订阅、身份/游标校验、公平调度、窗口 ACK 和缓冲上限。
- `scope.go`、`transport_errors.go`、`process.go`：作用域标识和平台无关辅助逻辑。

## 依赖与接口边界

`Platform` 提供 PTY、尺寸操作、进程结束、活动扫描和 agent IPC；`TargetAccess` 提供容器等目标的发现与命令接入；`QueueBackend` 提供 agent attach 子进程和诊断日志。核心保留原有调度、锁和生命周期次序，只将外部操作交给这些接口。

Core 可以使用标准库及通用协议/解析库，并依赖 `internal/pkg/fonts` 的设置定义和 `runtime` 的嵌入资产。不得导入 `unix`、`windows` 或 `provider`，不得写入 `lightosctl`、`/proc`、Unix syscall 或具体 Shell 启动逻辑。

## 关键约束

- agent 的 selector/account 绑定校验保持不变；外部身份认证由 Provider 负责，不能将目标适配接口误当作授权。
- 工作区、pane 和快照状态保持独立；字段只在原有锁保护下修改，关闭与迟到输出不能交叉访问已释放解析器。
- `snapshot + live` 的游标边界、ACK、resize epoch、回放顺序和队列上限保持不变。
- 解析失败仅让该 pane 使用有界原始历史，不重启 PTY、不自动重建解析器。
- `AgentProtocolVersion` 位于 `agent.go`。v28 保持 v27 的 wire/内存快照 ABI，兼容列表由 Provider 维护。

## 验证

在仓库根目录执行 `go build ./core`、`go build ./...`、`go vet ./...`。可交叉编译 Core 以检查平台依赖泄漏，但这不是整机平台支持验收。

运行验证使用真实 agent/PTY 和已有 REQ/AC，重点覆盖输入输出、主题查询、布局、尺寸、快照及 fallback。发布环境及浏览器手测方法见根 README 和 `spec-tests/ENVIRONMENT.md`。
