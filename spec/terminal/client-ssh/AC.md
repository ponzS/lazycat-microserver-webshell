# 场景 1：标准 SSH 登录获得独立的本机终端
ID: SC-CLIENT-SSH-INTERACTIVE-SHELL
Profile: draft
Gate: required
Given 当前活动账号拥有该客户端实例，已启用 SSH 并设置独立密码，微服接入端口可达
When 用户在标准 SSH 客户端中使用实例连接命令和正确密码登录
Then 用户进入目标电脑的独立交互终端，输入输出和窗口调整正常，退出结果可被 SSH 客户端接收
And 终端使用客户端进程所属的本机用户权限，不接管浏览器已有会话

# 场景 2：SSH 配置撤销不影响浏览器终端
ID: SC-CLIENT-SSH-CONFIG-REVOKE
Profile: draft
Gate: required
Given 该实例已有 SSH 连接、所属运行任务和正常使用的浏览器终端
When 用户关闭 SSH、修改密码或成功切换接入端口
Then 旧 SSH 连接断开，所属任务被回收，旧连接配置和迟到请求不能恢复访问
And 浏览器终端及其运行任务继续可用

# 场景 3：SSH 不绕过客户端账号门禁
ID: SC-CLIENT-SSH-ACCOUNT-BOUNDARY
Profile: draft
Gate: required
Given 客户端保存多个微服账号，当前账号启用了 SSH
When 其他账号尝试连接，或原账号在关闭接入、账号切换或授权失效后再次连接
Then 未获当前授权的连接被拒绝，不创建可使用的终端

# 场景 4：手动输入密码不被过早断开
ID: SC-CLIENT-SSH-AUTH-WAIT
Profile: draft
Gate: required
Given 当前账号的 SSH 已启用且可达，用户使用标准 SSH 客户端登录
When 用户确认主机指纹并在连接开始 15 秒后、120 秒内提交正确密码
Then 用户可以进入交互终端，不因等待超过 10 秒被关闭连接
And 若超过 120 秒仍未完成认证，连接被关闭，不能继续创建终端

# 场景 5：完整非空密码验证及升级兼容
ID: SC-CLIENT-SSH-PASSWORD-VERIFY
Profile: draft
Gate: required
Given 当前账号已设置非空 SSH 密码，包括短密码、空格、中文或超过 72 字节的密码
When 用户用正确密码、错误密码或空密码登录
Then 只有完整正确的密码可以进入终端，包括只在第 72 字节之后不同的错误密码也被拒绝
And 升级前已保存的密码无需重置即可使用
