# Unix 平台适配

本包实现 Core 的系统操作接口。第一阶段仅接线并验证既有 Linux 行为，不增加 macOS 功能。

## 入口与文件

- `platform_linux.go`：`Platform` 的 Linux 接线、Shell 命令环境、活动查询和 IPC/进程接口。
- `pty_unix.go`、`process_unix.go`：Unix PTY 启动、尺寸调整和既有进程结束方式。
- `ipc_unix.go`、`listener_unix.go`：agent socket、排他文件锁、权限和按文件身份清理。
- `shell_linux.go`：原 Linux Shell 环境、用户切换与会话引导脚本，原样保留其行为。
- `activity_linux.go`：Linux `/proc` 扫描、前台进程和工作目录识别；也提供 Provider 解析远程扫描结果的辅助能力。
- `agent_reconcile_linux.go`：按 socket/selector/account 核对 agent 进程身份并回收。
- `agent_signal_*`、`agent_limits_unix.go`：信号与文件句柄限制。
- `dependencies.go`：引用 Core 的共享协议类型，不维护另一份终端协议。

## 边界与约束

依赖方向为 Unix → Core；Core 不导入本包。不得放入工作区业务、历史、checkpoint 或 WebSocket 流控逻辑。容器发现和 `lightosctl` 属于 Provider。

通用 Unix 文件明确使用 `linux || darwin` 构建约束，Linux 专属实现使用 `_linux.go`。现有非 Linux 辅助片段不构成完整 macOS 适配；后续需补齐 Platform 接线并真实验证。

保留原进程归属检查、锁与 socket 清理顺序，不能按同名进程批量终止。用户切换失败继续拒绝启动，不退回更高权限账号。本次不改变既有 `Process.Kill` 范围或 Shell 引导逻辑。

## 验证

在 Linux 执行 `go build ./unix`、`go vet ./unix`，并通过真实 agent 验证 PTY、resize、断开/重连、活动识别和退出。使用隔离的测试用户或容器，Shell 引导脚本可能读取或维护该用户配置，勿使用生产会话作可清理资源。
