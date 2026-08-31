# 应用命令模块

## 职责

`app/commands/` 负责把移动快捷键和页面外壳按钮产生的用户意图路由到应用公开命令。它不拥有 tab、pane、session、设置、附件、终端输入、transport、history、replay、resize 或 rendering 状态，也不直接建立连接、修改 Canvas 或执行历史回放。

## 公开入口与状态所有权

- `createAppCommandController()`：提供 `createUserTab()`、`runAction()`、`install()` 和幂等 `dispose()`。
- `createAppCommandLifecycle()`：持有 disposed/generation 和页面按钮 listener 清理。
- `command_controller.js` 只执行注入的显式回调；`command_lifecycle.js` 是 listener/lifetime owner。调用方不得深度导入内部实现。

`createUserTab()` 只提交 `create_tab` workspace action；没有活动实例时只显示反馈。终端分页通过注入的 `scrollSession(session, delta)` 命令执行，避免命令模块直接访问 Ghostty 对象。

## 生命周期与依赖

`install()` 幂等绑定新建 tab、空状态 action 和 tab 栏滚轮 listener；`dispose()` 移除所有 listener 并递增 generation，迟到 click、wheel 或异步命令不得继续修改应用状态。模块只依赖 app orchestrator 注入的 getter/command，不触碰全局可变对象。

## 文件清单与验证

- `index.js`：唯一公开入口。
- `command_controller.js`：应用命令路由和 shell 控件绑定。
- `command_lifecycle.js`：listener、disposed/generation 生命周期 fence。
- `app_command_controller_test.mjs`：动作分派、创建 tab、滚轮、幂等安装和销毁测试。

相关静态 guard 位于 `runtime_shortcuts_test.go`；最小回归为 `node --test tests/app_command_controller_test.mjs`。命令路径不得渲染 history replay、snapshot、resize 或重连中间过程。
