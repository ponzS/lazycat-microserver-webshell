# 懒猫微服 LightOS WebShell

本项目是懒猫微服 LightOS 的官方 WebShell Provider，用于在浏览器中连接、管理和使用 LightOS 实例内的终端环境。

它通过 LPK Resource Export 声明 `lightos.webshell` 能力，由 LightOS Admin 发现并打开。安装后，用户可以从 LightOS 的 WebShell 入口进入目标实例，直接在网页中进行命令行操作。

## 项目目标

LightOS WebShell 的目标是为懒猫微服提供一个开箱即用的网页终端：

- 面向 LightOS 实例，而不是普通独立服务器。
- 与 LightOS Admin、实例列表、服务转发和 LPK 安装流程集成。
- 在浏览器刷新、网络短暂断开或切换页面后，尽可能保留已有终端会话。
- 提供接近桌面终端的标签页、分屏、历史回放和快捷键体验。

## 主要功能

- 自动发现 LightOS 实例，并在多个运行中的实例之间切换。
- 在浏览器中打开实例内 Shell，支持原始终端输入输出、窗口尺寸同步和 WebSocket 连接。
- 支持持久会话：刷新页面或重新打开同一个实例时，可重新连接到已有 tab 和 pane。
- 支持多标签页、上下/左右分屏、窗格关闭、标签重命名和标签排序。
- 支持终端输出历史回放，减少重连后丢失上下文。
- 支持复制、粘贴、终端搜索和当前终端链接复制。
- 支持主题切换、内置字体、自定义字体上传和滚屏行数设置。
- 支持手机快捷键和 PC 快捷键自定义，改善移动端和桌面端操作效率。
- 支持服务转发配置，可把实例内 HTTP/HTTPS 服务发布为 LightOS 应用入口。
- 支持服务端版本变化检测，升级后提示用户刷新并重新连接。

## 构建和部署

前置条件：

- Go 工具链。
- `lzc-cli`。
- 可安装 LPK 的懒猫微服环境。

构建 LPK：

```sh
lzc-cli project release
```

安装到目标设备：

```sh
lzc-cli app install dist/cloud.lazycat.webshell.lcmd-*.lpk
```

开发环境也可以直接构建并安装：

```sh
lzc-cli project deploy
```

安装完成后，在 LightOS Admin 的 WebShell Provider 列表中应能看到 `LCMD WebShell`。

## 许可证

本项目代码使用 PolyForm Noncommercial License 1.0.0 授权，SPDX 标识为 `PolyForm-Noncommercial-1.0.0`。

这意味着本项目源码允许在非商业场景下使用、复制、修改和分发，但不能用于商业目的。禁止将本项目用于商业产品、商业服务、付费交付、商业集成或其他以商业收益为目的的场景。

完整许可证条款见 [LICENSE](./LICENSE)。第三方文件保留其原始许可证声明，例如 `runtime/static/ghostty-web.LICENSE` 和 `runtime/fonts/LICENSES/` 下的字体许可证。
