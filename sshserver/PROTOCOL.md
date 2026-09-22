# Managed SSH 内部接入协议 v1

仅供受信任 LightOS 服务端与客户端终端装配使用；当前未提供用户侧票据签发接口。不得将设备 token、终端 secret、gateway credential 或 SSH 票据交给浏览器。

沿用 `/s/cloud.lazycat.lightos.client-terminal.managed.<instance>.<epoch>/` 路由。hportal 先核对 Device API token 的微服身份，再在同一连接上确认本地 listener 掌握该代凭据，最后覆盖注入 gateway credential 和可信微服头。SSH 不新增绕过此流程的公开监听器。

| 路由（去掉 service 前缀后） | 用途 | 行为 |
| --- | --- | --- |
| `GET /ssh/status` | `ssh-status` | 返回开关、revision、主机指纹和连接数，不返回校验材料。 |
| `PUT /ssh/config` | `ssh-config` | 应用指定版本配置；先断开旧 SSH，会话回收失败保持禁用。 |
| `GET /ssh/connect` | `ssh-tunnel` | 当前启用版本的单次入场票据，升级到 WebSocket 承载 SSH 字节流。 |

票据只放在 `X-Lightos-SSH-Ticket` 请求头，不接受 URL ticket。格式为 `base64url(payload).base64url(HMAC-SHA256(terminal_secret, payload))`，Base64 不带 padding。payload 是以下 11 项以单个 LF 连接的 UTF-8 字节，末尾不加 LF：

```text
lightos-client-ssh-v1
purpose
instance_id
account_id
box_id
device_id
epoch
revision
expires_unix_seconds
nonce_base64url
body_sha256_hex_or_dash
```

- nonce 是随机 32 字节。期限须在当前时间之后、90 秒以内；隧道票据最多使用一次，当前代最多保留 256 个未过期 nonce。
- `ssh-config` 的 revision 大于零，最后一项是实际发送的 HTTP body 的 SHA-256 十六进制摘要；签名后不可重新格式化 body。`ssh-tunnel` 的 revision 必须等于当前已启用版本；`ssh-status` 可使用零。非配置请求的最后一项固定为 `-`。
- 配置 body 上限 4096 字节：`{"revision":1,"enabled":true,"password_hash":"<password verifier>"}`。无明文密码字段；未知字段拒绝。禁用使用新 revision、`enabled:false` 及空 verifier。
- 状态字段：`enabled`、`revision`、`host_key_fingerprint`、`connections`。200 表示本地应用/读取成功，不表示微服 TCP 入口已可达。401 表示授权拒绝，409 表示配置冲突或未生效，503 表示本地 SSH 存储不可用。错误不泄露私钥路径、密码或 verifier。
- 完全相同的配置版本可幂等重试；旧版本或同版本不同内容拒绝。版本空间属于本次 epoch，启动新的终端进程必须用新 secret 和 epoch，重新验证账号后再下发期望配置。

## 密码校验值（终端 v33 起）

新校验值固定为 `$pbkdf2-sha256$600000$<salt>$<key>`，salt 与 key 使用无 padding 的标准 Base64（非 URL 编码）。使用 Go 标准库 PBKDF2-HMAC-SHA256，600,000 次迭代，密码为原始 UTF-8 字节，随机盐恰好 16 字节、结果恰好 32 字节。接收端只接受这些固定参数和规范编码，比较结果使用常量时间比较，不接受调用方自选计算成本。参数依据 [OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2)。

密码只要求非空，不裁剪、不做 Unicode 归一化、不截断，支持超过 72 字节的密码；HTTP/SSH 包仍有资源上限。旧的 60 字符 bcrypt 校验值（成本 10–14）继续接受，以便升级后保留已保存密码；旧格式认证仍拒绝超过 72 字节的输入，防止截断后误接受。空密码一律不能登录。

密码设置、验证分别由管理端和客户端按此格式实现，不能为共享内部代码让独立 provider 依赖 LightOS 的 Go 包。管理端需要 v33+ 客户端，不能向 v32 发送新格式并误报成功。

SSH 从接收连接到认证完成的总时限是 120 秒，包含用户确认指纹和输入密码；成功认证后请求 shell 的时限仍为 30 秒。最多 32 个连接、每实例每分钟 30 次密码计算和每连接 3 次认证尝试保持不变。增大交互等待时间不会延长授权租约或允许旧账号继续认证。

WebSocket 必须协商 `lightos-client-ssh.v1`，不允许 Origin 头；仅支持二进制消息、不开启压缩，每消息不超过 64 KiB。消息边界不是 SSH 数据边界，按字节流拼接。服务端每 15 秒 ping，45 秒未收到 pong 会关闭，写入限时 10 秒。客户端转发器必须持续读取并响应 ping，不能只在用户键盘输入时读取。

票据期限用于入场；已建立连接受父进程的 35 秒账号授权租约、managed 路由的 45 秒租约、配置版本及连接心跳约束，不因为入场票据过期每 90 秒断线。父管道关闭、账号切换导致的旧生命周期结束，或配置撤销会关闭 SSH 并回收其 PTY/任务。

此协议不决定微服端口分配或离线设置行为。第四阶段须提供持久化的配置真源、目的受限的票据签发和后台 Device API token 获取，不能通过伪造用户头或降低门禁来接入。
