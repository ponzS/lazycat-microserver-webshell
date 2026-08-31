# 终端渲染模块

## 职责与边界

本目录负责 Ghostty renderer adapter、runtime reset/suppression controller、Canvas presentation controller、Kitty graphics 适配、RenderSnapshot 和 frame release scheduler。它负责字体/行高度量、主题颜色映射、底部 viewport 归一化、cell seam/Powerline/块光标 patch、Ghostty 运行时安全 reset/清屏与 render suppression、render generation、full-render validation、last-known-good frame hold/release、Canvas context 恢复和 Kitty graphics 响应/像素适配，不负责历史、连接、工作区或 resize 权威。

完整画面只能在当前 identity、generation、viewport 和 presentation 条件都有效时提交；失败、重连、snapshot 等待或 resize/replay 事务期间必须保留旧帧，禁止显示历史回放中间过程。

## 公开入口与状态

外部只能从 `terminal/rendering/index.js` 导入 API。`createTerminalRendererAdapter()` 是 renderer patch 的唯一安装入口；`createTerminalPresentationController()` 是 presentation 状态、提交门禁和生命周期的唯一 owner；`createTerminalPresentationState()` 只提供 session 初始化快照；`RenderSnapshot` 持有一次呈现身份；frame scheduler 持有 latest-only RAF；Kitty graphics 模块只维护图片协议 patch 所需状态。

renderer adapter 只读取注入的字号、字体族和行高 getter。presentation controller 只读取注入的 replay/resize/visibility 门禁，并通过显式命令请求 resize 或 transport 恢复；它不能自行推进 history cursor、发送 WebSocket 帧、声明 resize owner 或修改输入队列。`onReady` 只发出“当前画面已提交”的信号，跨模块的 cache preview、pending input、恢复指标和 retry reset 由 `terminal/session/session_installation_controller.js` 接收并编排。controller 的 `installSession()` 独占 Canvas context 和 Ghostty `onRender` listener，session 销毁或模块 dispose 时统一取消 validation/retry timer、RAF、frame release 和 listener。

本目录不建立 WebSocket、不访问业务 API，也不直接执行 history 写入、`term.resize()` 或输入发送；这些能力只能由运行时 owner 通过受限回调注入。

## 文件

- `index.js`：唯一公开入口。
- `presentation_controller.js`：render generation、presentation gate、full-render validation/retry、hold 提交和 stall recovery 的唯一 owner。
- `presentation_state.js`：presentation session 字段的唯一初始化定义。
- `presentation_view.js`：live Canvas 清理、hold Canvas 挂载/复制/释放和 shell dataset DOM 适配；抓帧前会恢复被宿主清理路径意外脱离的模块自有 Canvas。
- `presentation_lifecycle.js`：validation/retry timer、presentation RAF、frame release、Canvas context 和 `onRender` listener 生命周期。
- `renderer_adapter.js`：字体/行高度量、主题映射、底部 viewport、cell seam、Powerline 和块光标 patch 的唯一 owner。
- `runtime_controller.js`：Ghostty runtime reset、清屏、引用同步、首次 fit reset 和按 reason 嵌套 render suppression 的唯一 owner；不决定 history replay 时机。
- `kitty_graphics.js`：Ghostty Kitty graphics patch、响应识别和像素尺寸。
- `terminal_render_snapshot.js`：render/presentation 快照和匹配校验。
- `terminal_frame_release_scheduler.js`：跨双 RAF 的 latest-only hold frame 释放。

## 验证

相关测试为 `terminal_presentation_controller_test.mjs`、`terminal_renderer_adapter_test.mjs`、`terminal_runtime_controller_test.mjs`、`kitty_graphics_test.mjs`、`terminal_render_snapshot_test.mjs`、`terminal_frame_release_scheduler_test.mjs` 及 runtime Canvas residue guard。最小回归是字体/行高变化、连续背景、Powerline、块光标、pixel scroll、快速切 tab、resize、主题变化、runtime reset、Canvas context 恢复和断网恢复，确认旧帧持续保留到当前 identity/generation 的最终完整画面提交。

任何 renderer patch 都不得清空终端、触发 replay/reset、改变 resize owner，或显示 history replay、snapshot、resize、重连的中间过程。
