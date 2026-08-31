# IME、helper textarea 与 iOS 宿主

## 职责与边界

本目录负责 Ghostty helper textarea、IME composition/preedit、Android 连续删除、移动键盘 focus/blur、同步双击手势和终端 host 输入隔离。iOS 经典脚本负责 Lazycat 宿主关闭按钮桥接。

本目录不拥有普通/generated 输入队列、WebSocket、history、resize epoch 或 Canvas presentation。visualViewport、键盘 inset 与方向恢复当前仍由调用方注入，下一批迁入本目录的 viewport controller。

## 入口、状态与生命周期

应用层只能从 `terminal/input/index.js` 导入 `createTerminalIMEController()`、lifecycle 和纯模型；`terminal/input/ime/index.js` 只作为 input 模块内部的子域入口。controller 是 composition、textarea、focus allowance、native delete、paste 去重和 touch claim 的唯一 owner；lifecycle 独占 session listener、RAF 和 timer，并在 pane close/dispose 后拒绝迟到 callback。`installSession()` 幂等，pane close 和页面 dispose 后不接受迟到输入。

`ios_terminal_host.js` 仍是 HTML 在 ES module 前加载的经典脚本，不通过 `index.js` 导入。

## 文件与验证

- `index.js`：ES module 单一公开入口。
- `ime_controller.js`：composition、textarea、focus、手势与 host 输入编排。
- `ime_lifecycle.js`：session listener、timer、RAF 和幂等清理。
- `ime_model.js`：平台识别、sentinel、delete input type 与 composition 候选纯函数。
- `ios_terminal_host.js`：iOS 宿主兼容经典脚本。

相关 guard 位于 `terminal_ime_controller_test.mjs`、`runtime_shortcuts_test.go` 的 iOS host、Android 删除、键盘和 viewport 测试。最小回归是在触摸浏览器双击同步拉起键盘，验证中文/英文 composition、连续 Backspace、paste、单击 blur 与方向变化；确认不抢焦点、不重复提交、不泄漏历史回放画面。
