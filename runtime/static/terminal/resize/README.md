# 终端 Resize 模块

## 职责

本模块是终端几何事务的唯一 owner，维护 requested、applied、presented 三阶段中的 requested/applied 状态、resize epoch、跨设备 owner observation、ACK fence、输出 settle、DOM fit、ResizeObserver、Ghostty `onResize` 和 tab RAF 调度。

模块不拥有 WebSocket 建立、关闭或重连，不决定历史 replay/snapshot，不维护 Unified membership，也不直接管理输入队列。它只通过注入的 transport 命令发送 resize 控制帧，通过 rendering 公开命令提交 presentation hold 和最终 full render。

当 fit 得出的 cols/rows、Canvas backing size、presentation generation 和 ACK/fence 状态都没有变化时，controller 必须走稳定几何快速路径：不捕获/恢复 viewport、不重置 host scroll、不重新定位 IME、不更新选区手柄，也不触发 full render。当前设备已经成功 claim 且没有新的 owner observation 时，重复点击、focus 和鼠标事件不得再次发送相同 claim；只有尺寸变化、远端 epoch/owner release 或明确的设备接管才重新进入 resize 事务。

ACK 前不得切换本地 Ghostty 网格。远端尺寸只作为 observation，本设备只有在明确的 pointer、focus、viewport 或 owner release 边界才重新 claim。resize、snapshot、重连和历史恢复的任何中间过程都不得显示，也不得通过重新 replay 历史掩盖几何问题。

## 公开入口与契约

外部只能从 `terminal/resize/index.js` 导入。

- `createTerminalResizeController()`：模块单一编排入口。公开尺寸读取、可测量判断、resize/claim/reassert、协议 ACK/error/owner 处理、输出 settle、tab 调度、session 安装和幂等销毁。
- `TerminalResizeController`：单个 resize 请求的 epoch/ACK/settle 纯状态机，由高层 controller 持有。
- `createTerminalResizeScheduler()`：latest-only 的 throttle/settle 调度器。
- `shouldSendTerminalSize()`、`terminalSizeDiffersFromServer()`：无状态尺寸判断。
- geometry/viewport 导出只提供机械查询与恢复，不承担事务编排。

`resize_controller.js` 的默认 `sendControl` 只通过当前 session socket 序列化 resize 控制帧；调用方可以在需要时注入受限 transport adapter，但 `global-runtime.js` 不再实现或注入 JSON 发送逻辑。单 pane resize 失败不得关闭 Unified 物理连接或影响其他 logical stream。rendering 注入只接收 hold、ready 和 full-render 命令，不得反向推进 resize epoch。

## 状态所有权

`resize_controller.js` 是以下状态的唯一修改者：`requestedResizeEpoch`、`appliedResizeEpoch`、requested/server geometry、`resizeAckPending`、`resizeFence*`、`resizeOutputSettle*`、`measuredFitGeneration`、`sizeClaimRequired`、`sizeClaimed`、`requestedResizeClaim` 和 observer 记录尺寸。presentation 只读取这些门禁并在最终 render 成功后推进 `presentedResizeEpoch`。

`resize_lifecycle.js` 独占 scheduler timer/RAF、ResizeObserver、Ghostty `onResize` disposable、owner/pending-target RAF 和 tab RAF。`geometry_state.js` 与 `viewport_controller.js` 不保存业务状态。

## 生命周期与清理

`installSession()` 为 pane 安装 ResizeObserver 和 Ghostty `onResize`，两者都注册到 session cleanup。`cancelPane()` 取消 scheduler、session RAF、output settle 和 presentation hold；`cancelTab()` 取消 tab RAF；`dispose()` 拒绝迟到 observer/timer/RAF 并清理全部模块资源。

移动键盘 viewport suppression 仍由输入/页面层拥有，只通过注入 getter 阻止 resize 事务。模块销毁或 pane 关闭后，任何 ACK、timer、observer、RAF 或 terminal resize callback 都不得修改 session 或 Canvas。

## 文件清单

- `index.js`：唯一公开入口。
- `resize_controller.js`：resize 协议（含默认控制帧序列化）、fence/settle、稳定几何快速路径、设备 claim 去重、DOM fit、tab/session 编排。
- `resize_lifecycle.js`：scheduler、timer、RAF、ResizeObserver 和 Ghostty disposable 生命周期。
- `geometry_state.js`：尺寸、epoch、Canvas、DOM 可测量性和 target 比较纯函数。
- `viewport_controller.js`：resize 前后 viewport 快照与恢复。
- `terminal_resize_controller.js`：单事务 requested/applied/settled/committed 状态机。
- `terminal_resize_scheduler.js`：latest-only throttle/settle 调度。
- `terminal_size_sync.js`：发送去重与本地/服务端差异判断。

## 依赖、guard 与最小回归

模块依赖 Ghostty terminal/fit adapter 的机械 API、rendering 公开命令、output 的队列计数/queued bytes/有界 flush 命令和 transport resize 发送命令；不得读取 `session.outputQueue*`，也不得导入 history/cache/output/transport 内部实现。

自动化测试：`terminal_resize_controller_test.mjs`（含默认控制帧 serializer）、`terminal_resize_scheduler_test.mjs`、`terminal_size_sync_test.go`、`TestRuntimeResizeEpochAckGuard`、`TestRuntimeCrossClientResizeDoesNotAutoReclaim`、`TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs` 和 resize 模块边界 guard。

最小真实回归：在 `debug123` 同一 pane 持续输出时改变窗口尺寸、分屏比例、tab、字体和主题，确认 backing store 变化前 hold 已可见、ACK 前本地 cols/rows 不变、最终画面非空且没有 replay 中间帧；手机与桌面交替 claim 同一 pane 时远端 observation 不自动反抢；连续同设备点击不得新增 resize frame、改变 Canvas 几何或短暂隐藏已呈现画面（`tests-auto/08-terminal-click-jitter/test.mjs`）；全程普通容器页面只有一条 Unified 物理 WebSocket，console/pageerror/API error 为零。
