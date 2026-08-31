# 应用反馈模块

## 职责

`feedback/` 负责应用 shell 的短时 toast 和启动错误面板 DOM 状态。模块只处理反馈呈现，不决定错误根因、不发起请求，也不拥有终端、workspace、设置或网络状态。

## 公开入口与状态所有权

外部只能从 `index.js` 导入 `createAppFeedbackController()`。controller 独占 toast timer、文本和 hidden 状态；调用方通过 `showToast()`、`showStartupError()`、`hideStartupError()` 传入结果，不得直接修改对应 DOM。

## 生命周期

`dispose()` 幂等并清理 toast timer；定时器回调在 dispose 后不会再次修改 DOM。模块不注册页面 listener、observer 或 socket，启动错误面板隐藏和 toast 生命周期由该 controller 统一维护。

## 文件清单

- `index.js`：唯一公开入口。
- `feedback_controller.js`：toast、启动错误面板和 timer 生命周期。

## 依赖、边界与验证

依赖方向为 app -> feedback；模块不得深度导入 terminal、workspace、history、transport 或 rendering。反馈路径不得触发或显示 history replay、snapshot、resize 或重连中间帧。行为测试为 `app_feedback_controller_test.mjs`，静态边界和版本化静态资源契约位于 `runtime_shortcuts_test.go`。
