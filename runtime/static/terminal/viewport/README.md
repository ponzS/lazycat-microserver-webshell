# 终端 Viewport 模块

## 职责

本模块是移动端视觉视口和软键盘布局状态的唯一 owner，维护 visual viewport 高度、参考高度、键盘 inset、客户端底部安全偏移、resize suppression、方向变化恢复序列和终端输入 viewport lock。

模块负责在软键盘打开期间平移当前 Ghostty Canvas、helper textarea 与 composition preview，使光标保持在可见区域；负责移动快捷键栏跟随 iOS 键盘或客户端底部控件；负责阻止触摸布局中的多指缩放；负责方向变化后的有界 resize/final-render 调度。

模块不拥有终端 resize epoch、Ghostty 网格、历史 replay、Cache API、WebSocket、Unified membership、输入队列、selection range 或 overview 状态。viewport 变化只调用现有 resize/presentation 命令并复用当前内存终端状态，禁止重新回放历史或显示任何历史、snapshot、resize 和重连中间帧。

## 公开入口与契约

外部只能从 `terminal/viewport/index.js` 导入。

- `createTerminalMobileViewportController()`：模块单一编排入口。
- `start()` / `dispose()`：幂等安装和清理全局 listener、timer 与 RAF。
- `usesInsets()`：当前平台和强制 PC 模式是否启用视觉视口 inset。
- `isKeyboardActive()` / `isResizeSuppressed()`：供 IME 和 resize 读取的只读门禁。
- `sync()` / `syncPan(session)`：同步 visual viewport 或单个 pane 的光标平移。
- `captureInputLock(session)` / `releaseInputLock(session)`：IME focus 生命周期使用的视口锁。
- `scheduleKeyboardDismissRecovery()`：浏览器 blur 后的有界多次恢复。
- `handleLayoutChange()`：强制 PC/触摸布局变化后清理并重新计算。
- `snapshot()`：只读诊断快照，不允许外部修改内部状态。

## 状态所有权

`viewport_controller.js` 是 viewport 高度、参考高度、inset、安全偏移、键盘 active、resize suppression、方向 generation 和当前 input lock session 的唯一修改者。`session.inputViewportLock` 只能由本 controller 通过公开 capture/release 命令修改；IME 只能请求命令，不能自行构造或推进锁状态。

resize 只能调用 `isResizeSuppressed()`，不能写 viewport 状态。IME 只能读取 `isKeyboardActive()` 并调用锁与 dismiss recovery。selection、overview、移动菜单和标题只接收同步通知，不得反向推进 viewport generation。

## 生命周期

`viewport_lifecycle.js` 独占 window/document touch 与 gesture listener、window/visualViewport resize/scroll、orientation listener、键盘 suppression timer、dock timer、dismiss/orientation recovery timer 和 viewport RAF。`dispose()` 会移除全部 listener、取消 timer/RAF、释放 input lock，并拒绝迟到回调。

方向和键盘恢复使用 generation 检查；旧 sequence 的 timer 即使已经进入任务队列，也不能修改当前 viewport 状态。全局事件安装必须幂等，不能因重复 `start()` 产生重复 resize 或键盘恢复。

## 文件清单

- `index.js`：唯一公开入口。
- `viewport_controller.js`：移动视觉视口、软键盘 inset、input lock、方向恢复和跨模块命令编排。
- `viewport_lifecycle.js`：全局 listener、timer 与 RAF 生命周期。
- `viewport_model.js`：方向识别、底部 inset、键盘型高度变化和光标 pan 纯计算。
- `README.md`：职责、状态所有权、生命周期、依赖和回归约束。

## 依赖、guard 与最小回归

模块通过显式注入依赖 resize、IME DOM 命令、selection、overview、移动菜单和工作区只读查询；不得导入这些模块的内部实现，不得访问 transport/history/cache。

自动化测试：`terminal_viewport_controller_test.mjs` 和 `TestRuntimeTerminalViewportModuleBoundary`。静态 guard 固定单一公开入口、Service Worker 资源、main 接线和旧 viewport 状态/实现不得回流入口文件。

最小真实回归：在 `debug123` 的桌面与移动页面加载当前工作区资源；移动端打开/收起软键盘并旋转视口，确认快捷键栏和光标可见、终端最终 Canvas 非空、没有 replay 中间帧或 `pageerror`；桌面 resize 保持正常；每个页面始终只有 1 条 Unified 物理 WebSocket。
