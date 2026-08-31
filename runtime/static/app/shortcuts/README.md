# 应用快捷键模块

## 职责

`app/shortcuts/` 负责桌面快捷键的过滤、动作映射和全屏命令协调。它只把用户意图转成注入的显式命令，不拥有 tab、pane、设置、附件、终端输入或工作区状态。

模块不注册页面级 `keydown` listener；listener 由 `app/app_lifecycle.js` 持有并调用公开的 `handleKeydown()`。快捷键路径不得建立 WebSocket、执行历史回放、修改 Canvas 或显示 replay/snapshot/resize/重连中间帧。

## 公开入口

外部只能从 `app/shortcuts/index.js` 导入：

- `createAppShortcutController(options)`：创建快捷键 controller。
- `createAppShortcutLifecycle()`：创建命令生命周期 fence。

controller 公开 `runAction()`、`handleKeydown()`、`toggleFullscreen()`、`isInteractiveShortcutTarget()`、`isDisposed()` 和幂等 `dispose()`。

## 状态与生命周期

- `shortcut_controller.js` 只持有无业务状态的动作路由和快捷键处理逻辑；所有跨模块行为通过回调注入。
- `shortcut_lifecycle.js` 持有 disposed/generation fence，拒绝页面销毁后的迟到命令。
- 页面 listener、定时器和其他资源仍由 `app_lifecycle.js` 或对应业务模块清理。

## 文件清单与验证

- `index.js`：唯一公开入口。
- `shortcut_controller.js`：快捷键过滤、动作映射、全屏和粘贴路径。
- `shortcut_lifecycle.js`：命令生命周期 fence。
- `app_shortcut_controller_test.mjs`：动作分派、交互目标、粘贴和 dispose 行为测试。

相关 guard 位于 `runtime_shortcuts_test.go`；最小回归为 `node --test tests/app_shortcut_controller_test.mjs`，并检查桌面快捷键不触碰终端历史或额外连接。
