# 场景 1：握手前连接关闭时显示连接原因和网络检查建议
ID: SC-CLIENT-CONNECTION-HANDSHAKE-FAILURE
Profile: draft
Gate: required
Given 用户通过 CLI 或图形客户端启用物理机接入，目标终端连接在握手前关闭
When 用户在浏览器中打开该物理机的终端
Then 页面提示“无法连接终端。请检查目标设备的网络环境后重试。”
And 详细原因显示“握手前连接关闭（EOF）。”，并保留原始错误
And 该连接失败不被显示为协议不兼容或已确定的代理故障
