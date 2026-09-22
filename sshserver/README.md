# 客户端 SSH 协议适配

本模块负责标准 SSH 协议与独立 Core shell 的连接，不单独开放 SSH 端口、不安装系统 sshd、不操作浏览器工作区。`StartManaged` 将 SSH 挂到现有 localserver 监听器，由 hportal managed HTTP 通道转发。PC/CLI 已装配本模块；LightOS 独立管理设置、票据及微服 TCP 入口，启用并确认配置后才可通过实例命令连接。

## 入口和依赖

- `server.go`：`New` 绑定微服、账号、设备和启用代次，初始关闭；`Apply` 接收递增版本的配置；`Status` 返回状态与主机指纹；`Close` 撤权并回收。
- `transport.go`：`ServeConn` 接管上层交付的连接，核对完整绑定和配置版本，执行 SSH 握手及密码认证。
- `session.go`：独立交互 shell、PTY、窗口调整及退出；通过 `core.ShellSessions` 复用注入的平台实现。
- `password.go`：PBKDF2 密码校验材料生成/验证与固定计算成本、旧 bcrypt 兼容；`hostkey.go`：客户端本地 Ed25519 主机密钥。
- `managed.go` / `ticket.go` / `config_http.go`：账号作用域私有存储、用途隔离的短期票据、签名内容绑定的配置更新和不含密码的状态。
- `tunnel.go` / `websocket_stream.go`：仅供服务端调用的二进制 WebSocket 隧道、单次入场票据、心跳与有界流量缓冲；不提供任意目标地址。

依赖方向是装配入口 → SSH adapter → Core → 注入的平台接口。Core 不导入本模块。使用 [Go SSH](https://pkg.go.dev/golang.org/x/crypto/ssh)、标准库 `crypto/pbkdf2` 和 [bcrypt](https://pkg.go.dev/golang.org/x/crypto/bcrypt) 兼容旧密码，不自行实现加密算法。

这是独立 Go module，当前 `x/crypto v0.57.0` 需要 Go 1.26。桌面和 CLI 的 terminal-core 子模块显式引用它；根模块及既有容器、移动端的依赖和 Go 要求不变。根目录 `go build ./...` 不会自动构建此模块，完整客户端产物使用各自的 terminal-core 构建脚本。

## 安全与生命周期约束

- `Apply` 和 `ServeConn` 不是外部鉴权接口。调用方必须先验证受管理的设备通道、当前账号及用途受限的短期票据，再传入 `Access`；不得直接把外部请求字段当作可信绑定。服务的 context 必须受上层授权租约约束。
- 每个生命周期固定绑定，账号或启用代次改变时关闭旧服务，重新创建。配置版本只能递增，相同版本只接受完全相同的配置；更新先撤销旧 SSH 连接，回收失败则保持禁用，不回滚恢复旧密码。
- 初始关闭；用户名必须等于绑定账号，密码只能使用独立校验材料。密码非空即可，不裁剪或截断；新校验值使用固定参数 PBKDF2-HMAC-SHA256（600,000 次、随机 16 字节盐、32 字节结果），按原始 UTF-8 完整验证，结果常量时间比较。兼容成本 10–14 的旧 bcrypt 校验值，旧格式不允许超过 72 字节的输入以防截断误认证。不记录、回显或持久保存明文密码，详见 `PROTOCOL.md`。
- 主机私钥保存在传入的绝对配置目录下 `ssh-host-ed25519`。managed 入口按微服/账号/设备的摘要隔离子目录，不包含 epoch，以便正常重启保留指纹；不持久保存密码校验材料，重启默认关闭，等待当前授权下重新应用配置。Unix 文件权限 0600、目录创建权限 0700；Windows 为专用目录及文件设置受保护 DACL，仅允许当前用户和 SYSTEM，失败只禁用 SSH。已有损坏密钥不自动替换；Windows ACL 仍需实机核验。
- 仅允许每连接一个交互式 session，要求 PTY；拒绝 exec、子系统、环境注入、信号请求及全部转发。Ctrl-C 等控制键通过终端输入传递。PTY modes 检查格式，实际模式沿用平台默认值；不承诺完整 OpenSSH 终端模式覆盖。
- 最多 32 个连接；从连接到完成认证限时 120 秒（包含确认主机指纹和手动输入密码），每连接最多 3 次认证尝试；认证后请求 shell 仍限时 30 秒，每实例每分钟最多 30 次密码计算。上层入口还需执行入口级连接限流；本模块不提供任意目标转发。
- SSH 拥有自己的 shell 集合；断线或撤权只关闭所属 PTY/进程，复用 Unix 会话清理和 Windows Job Object，不调用浏览器 `Local.Close`。关闭整个客户端接入时，由上层同时关闭浏览器和 SSH 生命周期。
- managed 入口的私有父管道和 35 秒授权租约沿用 hportal；SSH 配置错误、密钥存储错误或远端未接入不重启健康浏览器终端。没有设置/隧道专用票据时，普通 Webshell 票据不能使用 SSH 路由。

内部接口约定见 [PROTOCOL.md](PROTOCOL.md)。它不是公开 LightOS API，后续管理端接入前还需核验后台用户授权及设备 token 签发。

## 验证

在本目录执行 `go build ./...`、`go vet ./...`；根目录另行构建现有 Provider/Core。交叉编译只能验证依赖和编译，不是 macOS/Windows 真机验收。

Linux 隔离验证使用临时配置、临时回环端口、真实 SSH 协议与真实 PTY，不触碰生产端口、已有账号或系统 SSH 服务。完整端到端场景见 `../spec/terminal/client-ssh/`，尚待接入微服通道和真实平台手测，保持 draft。
