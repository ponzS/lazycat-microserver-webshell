# 静态运行时入口

`runtime/static/` 是 WebShell 页面静态资源根目录。页面脚本只从 `main.js` 开始加载：`main.js` 负责导入并调用 `global-runtime.js` 的 `startGlobalRuntime()`，不实现业务逻辑。

## 根目录职责

- `main.js`：唯一页面脚本入口，保持为极小的 import/call 文件。
- `global-runtime.js`：全局运行时唯一 owner。声明全局状态，创建 feature controller，编排启动、恢复、页面级 listener 接线和销毁顺序；不应新增具体业务算法。
- `service-worker.js`：版本化 app-shell 预缓存、静态资源缓存和网络边界；新增模块必须同步加入资源契约。
- `index.html`、`style.css`：页面外壳和样式，不承载跨模块运行时状态。
- `ghostty-web.js`、`ghostty-vt.wasm`：随包分发的终端运行时资源。
- `vendor/`：第三方宿主适配，仅通过明确的公开 API 接入。

## 模块目录

业务和责任域必须放在对应目录，并由目录根的 `README.md` 说明状态 owner、公开入口、文件职责、生命周期和验证方式。当前主要目录包括：

`app/`、`workspace/`、`terminal/`、`appearance/`、`settings/`、`diagnostics/`、`instances/`、`devices/`、`attachments/`、`service_forwarding/`、`ui/`。

模块外部只能通过各目录的 `index.js` 使用公开 API。不得从 `main.js` 或其他模块深度导入内部实现，不得把全局状态复制到 feature 模块，也不得在任何路径显示历史 replay、snapshot、resize 或重连中间过程。

## 最小验证

修改入口或静态模块后至少执行：

```sh
find runtime/static -name '*.js' -print0 | xargs -0 -n1 node --check
go test . -run '^TestRuntime' -count=1
git diff --check
```
