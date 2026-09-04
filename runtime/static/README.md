# 静态运行时入口

`runtime/static/` 是 WebShell 页面静态资源根目录。页面脚本只从 `main.js` 开始加载；`main.js` 仅导入并调用 `global-runtime.js` 的 `startGlobalRuntime()`。

## 根目录职责

- `main.js`：唯一页面脚本入口，不实现业务逻辑。
- `global-runtime.js`：全局运行时唯一 owner，负责全局状态声明、feature controller 创建、启动/恢复/销毁顺序和显式依赖接线。
- `index.html`、`style.css`：页面结构和样式。
- `ghostty-web.js`、`ghostty-vt.wasm`：随包发布的终端运行时。
- `vendor/`：第三方宿主适配，只能通过明确公开 API 使用。

当前页面不注册 Service Worker，不提供 Web App Manifest，也不使用 PWA app-shell 缓存。`index.html` 在版本化资源之前仅对仍被旧 Worker 控制的页面调用一次现有 registration 的 `update()`；Provider 在旧 `/service-worker.js` URL 提供一次性退役脚本，使历史 registration 能够删除已知旧缓存、注销自身并重载受控页面。该触发器不注册 Worker、不直接重载页面，退役脚本没有 fetch listener、预缓存或 client claim；干净用户没有 controller，不会请求 Worker 或增加导航。静态资源继续通过 Provider 注入的版本化 `/assets/<asset-version>/` URL 和 HTTP immutable 缓存发布；API、WebSocket 和终端历史不经过浏览器 Cache API。

## 模块目录

业务和责任域必须位于对应目录，并由目录根 `README.md` 说明职责、状态 owner、公开入口、生命周期和验证方式。主要目录包括 `app/`、`workspace/`、`terminal/`、`appearance/`、`settings/`、`diagnostics/`、`instances/`、`devices/`、`attachments/`、`service_forwarding/` 和 `ui/`。

模块外部只能通过各目录的 `index.js` 使用公开 API。不得从 `main.js` 或其他模块深度导入内部实现，不得复制全局状态，也不得显示 history replay、snapshot、原子 resize 或重连中间过程。桌面分屏/窗口及已提交终端字号/行高的 live geometry 只允许呈现当前 session 的真实 Canvas，不改变 replay 与恢复的原子提交边界。

## 最小验证

```sh
find runtime/static -name '*.js' -print0 | xargs -0 -n1 node --check
node --test tests/*.mjs
go test ./... -count=1
git diff --check
```
