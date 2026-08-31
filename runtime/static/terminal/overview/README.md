# 终端总览模块

## 职责

本目录负责标签总览的打开/关闭、卡片渲染、分屏 Canvas 缩略图、标签选择/关闭/拖拽排序、移动端边缘手势和浏览器历史 guard。

总览只观察工作区 tab/pane，并通过显式命令请求新建、激活、关闭和移动标签。它不建立 WebSocket、不修改 history cursor、不读取 Cache API/IndexedDB、不恢复 Ghostty 状态，也不决定输入是否 ready。

## 公开入口与契约

外部只能从 `terminal/overview/index.js` 导入：

- `createTerminalOverviewController()`：唯一编排入口，公开 `start()`、`open()`、`close()`、`isOpen()`、`scheduleRender()`、`consumeHistoryBack()`、`updateWorkspaceLocation()` 和 `dispose()`。
- `createTerminalOverviewView()`、`createTerminalOverviewLifecycle()`：内部组合与测试入口。

controller 独占打开状态、render/focus RAF、拖拽/长按/placeholder/自动滚动、重排 timer、移动边缘手势和历史 guard。view 独占 DOM/Canvas 绘制，lifecycle 独占永久与临时 listener。

总览 preview 只能作为总览缩略图。缩略图来源只允许是已完成提交的 live Canvas，或 identity 仍有效的 `terminal-frame-hold`。未激活且从未呈现的 pane 显示空缩略图，不得通过历史 replay 或浏览器缓存补图。

## 状态所有权

## 生命周期与清理

`start()` 幂等注册 listener；`dispose()` 取消所有 RAF/timer、结束拖拽、移除 listener 并关闭总览。迟到回调不得修改 UI。

## 文件清单

- `index.js`：单一公开入口。
- `overview_controller.js`：状态 owner、缩略图来源选择、拖拽排序、历史 guard 和移动端手势。
- `overview_lifecycle.js`：DOM listener 注册和幂等清理。
- `overview_view.js`：DOM 查询、卡片构建、响应式网格和分屏 Canvas 绘制。

## 依赖与验证

允许依赖浏览器 DOM、工作区只读视图、presentation frame 查询和显式工作区命令；禁止依赖 transport、history store、replay、resize controller 或输入状态机。

相关测试为 `terminal_overview_controller_test.mjs` 和 `TestRuntimeTerminalOverviewModuleBoundary`。最小回归包括有/无已呈现帧时打开总览、切换/关闭/新建标签、桌面拖拽、触摸长按拖拽、双侧边缘打开、浏览器返回键和 dispose 资源清理。

任何路径都不得显示历史 replay、snapshot、resize 或重连中间过程。
