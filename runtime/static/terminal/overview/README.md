# 终端总览模块

## 职责

本目录负责标签总览的完整浏览器侧生命周期：打开/关闭状态、卡片渲染、分屏 Canvas 缩略图、cache-v2 preview 预热、标签选择/关闭/拖拽排序、移动端双侧边缘手势和浏览器历史 guard。

总览只观察工作区 tab/pane 结构，并通过注入命令请求新建、激活、关闭和移动标签。它不拥有工作区权威状态，不建立 WebSocket，不修改历史 cursor，不恢复 Ghostty 状态，也不决定终端输入是否 ready。

## 公开入口与契约

外部只能从 `terminal/overview/index.js` 导入：

- `createTerminalOverviewController()`：总览唯一编排入口，公开 `start()`、`open()`、`close()`、`isOpen()`、`scheduleRender()`、`clearSessionPreview()`、`consumeHistoryBack()`、`updateWorkspaceLocation()` 和 `dispose()`。
- `TerminalOverviewPreviewController`：按完整 cache-v2 identity 加载、解码、匹配和清理缩略图的底层控制器。
- `createTerminalOverviewView()`、`createTerminalOverviewLifecycle()`：供模块测试和内部组合使用，不应由运行时入口深度导入。

调用方注入只读的 tab/pane 视图、活动 selector/tab getter，以及新建、激活、关闭、移动标签的显式命令。模块不得反向写入 tab registry、布局树、活动 pane 或连接状态。

## 状态所有权

`overview_controller.js` 是以下状态的唯一 owner：

- 总览打开状态和 render/focus RAF。
- preview idle 预热任务与 cache identity 校验协调。
- 拖拽、长按、placeholder、自动滚动和重排动画 timer。
- 移动端边缘滑动状态和 `webshellMobileOverviewGuard` 历史状态。
- 总览专用 preview sequence/promise/image 生命周期。

工作区 tab/pane、活动标签、Ghostty 模型、Canvas presentation、cache manifest 和历史 generation 仍由各自模块拥有。总览只能读取这些状态并调用注入命令。

## 生命周期与清理

`start()` 幂等注册总览按钮、卡片事件代理、移动端 touch 和 window resize listener，并建立移动端历史 guard。动态拖拽 listener 也统一经 lifecycle 注册。

`dispose()` 幂等取消 render/focus/auto-scroll RAF、idle callback、长按和重排 timer，移除永久与临时 listener，结束拖拽，关闭总览并清理所有已解码 preview。pane 关闭、history generation 改变、缓存失效或 workspace reset 时，调用方必须调用 `clearSessionPreview()`；迟到 preview 通过 sequence、closed、generation 和完整 identity guard 被拒绝。

## 文件清单

- `index.js`：单一公开入口。
- `overview_controller.js`：状态 owner、模块编排、preview 协调、拖拽排序、历史 guard 和移动端手势。
- `overview_lifecycle.js`：永久与临时 DOM listener 的注册和幂等清理。
- `overview_view.js`：DOM 查询、卡片构建、响应式网格和分屏 Canvas 绘制。
- `terminal_overview_preview.js`：cache-v2 preview 的加载、解码、身份匹配和图片释放。

## 依赖与 guard

允许依赖浏览器 DOM、工作区只读视图、cache-v2 公开 API 和显式工作区命令。禁止依赖 transport、replay、resize controller 或输入状态机，禁止把总览图片用于 Ghostty 恢复、终端启动显示或输入 ready。

相关测试为 `terminal_overview_controller_test.mjs`、`terminal_overview_preview_test.mjs`、Cache v2 preview guard、移动端边缘手势/拖拽 runtime guard 和 `TestRuntimeTerminalOverviewModuleBoundary`。最小回归包括：未激活 pane 有/无缓存时打开总览、切换/关闭/新建标签、桌面拖拽、触摸长按拖拽、双侧边缘打开、浏览器返回键打开、resize 后网格更新，以及 dispose 后 listener/timer/迟到图片均不再修改 UI。

任何路径都不得显示历史 replay、snapshot、resize 或重连的中间过程；总览 preview 只能作为总览缩略图。
