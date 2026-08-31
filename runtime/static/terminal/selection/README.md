# 终端选择模块

## 职责

本目录负责终端文本选择的完整责任域：Ghostty selection manager 兼容补丁、选区 cell/range/text 算法、完整缓冲区选择状态、移动端选择工具栏与手柄、长按选择、拖动调整、边缘自动滚动，以及对应 listener、timer 和 disposable 的生命周期。

本模块不负责终端鼠标协议、TUI 身份识别、Clipboard API、搜索实现、输入传输、history replay、resize 或 Canvas presentation。调用方只能通过公开方法查询或修改选择，并把复制、粘贴、搜索、pane 激活和输入失焦作为显式命令注入。

## 公开入口与契约

外部只能从 `terminal/selection/index.js` 导入：

- `createTerminalSelectionController()`：唯一状态与编排入口，公开 `start()`、`installSession()`、`observeSession()`、`prepareManager()`、`syncRuntimeReferences()`、`selectAll()`、`clear()`、`clearFullBufferSelection()`、`getSelectedText()`、`hasSelection()`、`isFullBufferSelection()`、`cellFromPoint()`、`apply()`、`clearIfTapOutside()`、`update()`、`updateHandles()`、`updateAutoScroll()`、`stopAutoScroll()`、`isSheetOpen()`、`disposeSession()` 和 `dispose()`。
- `createTerminalSelectionView()`：选择工具栏、移动 overlay/handle 和 point-to-cell DOM 适配。
- `createTerminalSelectionLifecycle()`：永久与 session listener、timeout、interval 和 disposable 的幂等清理。
- `selection_model.js` 导出的 cell/range/text 函数：无状态选择算法和 Ghostty 行读取。

TUI adapter 和 mouse protocol 只能调用 controller 的 `cellFromPoint()`、`apply()`、`clearIfTapOutside()`、`updateHandles()`、`updateAutoScroll()` 与 `stopAutoScroll()`；不得直接修改 selection manager 或完整缓冲区选择状态。

## 状态所有权

`selection_controller.js` 是完整缓冲区选择、manager 补丁安装状态和所有选择命令的唯一 owner。完整缓冲区选择使用模块私有 `WeakSet`，不再写入共享 terminal session 字段。

`selection_view.js` 独占 `selectionSheet`、移动快捷键选择标记以及每个 session 的 overlay/handle DOM，并通过私有 `Map` 绑定 session。`selection_lifecycle.js` 独占 listener、timeout、interval 和 disposable；迟到 timer 在 session 或模块销毁后不得继续修改选择。

`selection_model.js` 不持有 DOM、session registry、timer、socket 或可变状态。

## 生命周期与清理

`start()` 幂等安装选择工具栏 listener。`installSession()` 必须位于输入 focus 安装之后、Claude/opencode/herdr/pi 专用触摸适配器和通用 mouse tracking 之前，以保持 iOS 同步双击 focus 与 TUI 手势所有权顺序。

每个 session 的 overlay、handle listener、长按 timeout、自动滚动 interval、scroll/selection disposable 和 manager 补丁恢复都由 `disposeSession()` 清理；该方法通过 terminal session lifecycle 注册并可重复调用。`dispose()` 会清理全部 session 与全局资源，后续动作全部拒绝。

## 文件清单

- `index.js`：单一公开入口。
- `selection_controller.js`：选择状态 owner、manager 补丁、命令编排、长按/手柄/自动滚动状态机。
- `selection_model.js`：cell 比较、范围归一化、前后 cell、选区包含判断和 Ghostty 选择文本提取。
- `selection_view.js`：工具栏、移动 overlay/handle、几何定位和 point-to-cell DOM 适配。
- `selection_lifecycle.js`：全局与 session listener、timeout、interval 和 disposable 生命周期。

## 依赖、guard 与最小回归

允许依赖 Ghostty 的公开 terminal/selection manager 读取接口、浏览器 DOM、布局只读判断和注入的选择命令。禁止创建 WebSocket、读取或写入 history/cache、触发 terminal reset/replay、拥有 resize epoch，或绕过 presentation guard 提交 Canvas。

相关测试为 `terminal_selection_controller_test.mjs`、触摸选择 Go guard、Claude fullscreen touch/desktop selection 隔离测试、剪贴板和上下文菜单测试。最小回归包括：普通选择复制、完整缓冲区复制、双击字符串、移动长按、手柄跨行、边缘自动滚动、点按选区外清除、工具栏复制/粘贴/搜索/清除、桌面自动复制、pane 销毁清理，以及 input focus -> 默认选择 -> TUI adapter -> 通用 mouse tracking 的安装顺序。

任何选择操作都不得清空终端、触发或显示 history replay、snapshot、resize 或重连中间过程。
