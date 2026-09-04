# 终端几何变化抖动回归

## 场景元数据

- 状态：active
- 类型：PC / responsive / lifecycle
- 真实依赖：真实 Provider、persistent agent、PTY、Unified WebSocket、Ghostty WASM、真实 Chrome Canvas
- 相关模块和源码入口：`runtime/static/terminal/metrics/`、`runtime/static/terminal/resize/`、`runtime/static/terminal/rendering/`、`runtime/static/settings/`、`runtime/static/appearance/runtime_controller.js`、`runtime/static/app/layout/`

## 触发条件

终端已有稳定画面后，通过桌面快捷键调整字号，通过设置中的真实行间距输入调整并恢复行高，切换并恢复真实主题与已加载字体族，显示/隐藏并恢复桌面快捷栏，同时执行浏览器 viewport resize 和 tab 激活切换。移动 Zoom 已迁入隔离单设备的场景 04，避免跨设备 resize owner 干扰逐帧归因。

## 用户可见问题

字号和行高变化过去会显示旧的 hold Canvas，待字体度量、resize ACK 和 full render 完成后才切回真实 Canvas，视觉上与现在的分屏/窗口 live reflow 不一致。错误地全面移除原子门禁又可能让首次加载、历史 replay 或重连的中间帧重新可见。

## 预防的回归

- 已提交终端上的字号、行高变化必须始终显示当前 live Canvas，顶部/左侧锚点稳定，hold Canvas 全程隐藏，最终几何收敛。
- 字体几何调整只能进入 resize owner 的显式 live geometry，不能由 Ghostty option setter 额外发送 resize，也不能为重试不断分配新 epoch。
- viewport resize 继续采用 live geometry；稳定 current tab 走无复制快路径，stale tab、首次加载、history replay、重连和 identity 变化仍保持原子提交。
- 移动端 `Zoom+`/`Zoom-` 同样不能重新显示 hold Canvas。
- 主题切换不得触发 hold、字体 metrics refresh 或终端 resize；当前可见 Canvas 应直接完整重绘，隐藏 pane 只更新主题状态。
- 桌面快捷栏和 Force-PC 引起的 host 几何变化应复用 layout live geometry，不能回退到普通原子 resize。

## 修复前基线

2026-09-04 使用本地 `runtime/static`、真实 `debug@cloud.lazycat.lightos.entry`、桌面/移动 Chrome 和真实 PTY/Unified WebSocket 运行，产物为 `artifacts/2026-09-04T03-43-37-909Z/`。用例在桌面字号阶段按预期失败：60 个有效样本中多次出现 `holdHidden=false`、`liveVisibility=hidden`、`renderReady=false`；Ghostty setter 一度生成 `1584×1035` 的 live Canvas，随后才经 hold 切回 `1440×851`。截图、trace、逐帧几何和 terminal timeline 均已保存。

主题/桌面快捷栏扩展基线运行到主题阶段即按预期失败，产物为 `artifacts/2026-09-04T05-21-36-266Z/`：主题真实经过 `default → freya → default`，但 130 个有效样本中多次出现 `holdHidden=false`；现有 appearance runtime 的显式 hold、metrics refresh 和 resize 调用均进入了这次事务。桌面快捷栏因为主题断言先失败尚未执行；其现有设置回调仍明确进入普通 `resizeActiveTabForCurrentDevice()`，由源码与 Node guard 锁定为待迁移基线。

## 已确认根因

`terminal/metrics/metrics_controller.js` 在字号 setter 前显式 `beginHold()`，随后 `refresh()` 又无条件开启 hold，并把真实 Canvas 隐藏到普通 resize ACK/full render 完成。行高虽然没有直接改 Ghostty option，但仍走普通原子 resize；此外行高 PATCH 成功后，settings controller 会无条件重新注册并刷新未变化的字体族，于 live fit 之后再次制造 hold。

## 实施方案

metrics controller 在修改字号或重新测量行高前，为当前可见、replay 已提交的 session 申请独立 metrics live source；renderer metrics 刷新后通过 resize owner 的 session 级 update 做本地 fit，在既有 RAF/80ms/240ms 稳定检查完成后结束 source 并提交最终 `claim:true`。Ghostty option setter 的 `onResize` 在 live 期间不自行发送控制帧。

resize controller 分别维护 interactive 与 metrics source；二者重叠时，任一方结束都不能提前退出 live geometry，只有所有 source 结束后才提交最新 target，ACK 后才完成事务。不可见或尚未 replay commit 的 session 继续走原子路径。行高 PATCH 响应跳过未变化字体资源的重复注册，但字体选择、上传、删除和初始加载不变。

主题 runtime 移除 hold、metrics refresh 和 resize，只更新 mapper/theme 并对允许 render 的 live Canvas 请求 full frame。已加载字体族复用 metrics source；`document.fonts.ready` 显式请求 live refresh，但键盘 suppression 时跳过。桌面/移动快捷栏和 Force-PC 发布 layout live 意图。tab 激活只对 stale pane 抓帧，current outgoing Canvas 原地留在隐藏 tab。

## 验证预期

- 字号和行高采样期间 `holdHidden=true`、`liveVisibility=visible`、`renderReady=true`。
- live Canvas 与 host 的顶部/左侧偏差不超过 1px，最终宽高收敛，Canvas backing size 确实发生变化。
- 操作后不得出现本地 epoch 覆盖导致的 stale-ACK/retry 风暴或 `presentation_retry_exhausted`，Unified socket 不被替换；多设备竞争产生且被 fence 拒绝的旧 ACK 继续按既有场景记录。
- 原有 viewport live geometry 与 tab 原子安全断言继续通过。
- 主题切换过程中 body theme 至少经过两个值，但 `visibleHold=0`；桌面快捷栏往返时 Canvas 几何真实变化且 `visibleHold=0`。
- 已加载字体族往返过程中 `visibleHold=0`；若字体资源尚未完成或 pane 尚未 replay commit，仍允许原子回退。
- 新建并稳定呈现的临时 tab 与当前 tab 往返时 `visibleHold=0`；stale tab、hidden output、replay 和 identity 变化仍必须允许原子 hold。

## 验证结果

2026-09-04 最终代码的真实运行通过，产物为 `artifacts/2026-09-04T03-57-16-152Z/`：

- 桌面字号 68 个样本、行高修改/恢复 107 个样本、移动 `Zoom+`/`Zoom-` 99 个样本，三组 `visibleHold=0`、不安全 live 样本均为 0。
- 三组操作都捕获到至少 2 个真实 Canvas 几何，证明不是静态旧帧；最终 live Canvas 顶部/左侧锚定且宽高收敛。
- tab 激活仍捕获到 12 个安全 hold 样本，证明本次没有把 replay/激活等原子 presentation 全面改成 live。
- 相关 Node 测试：`node --test tests/settings_controller_test.mjs tests/terminal_metrics_controller_test.mjs tests/terminal_resize_controller_test.mjs tests/terminal_presentation_controller_test.mjs`，46/46 通过。
- 完整 Node 行为测试：`node --test tests/*_test.mjs`，422/422 通过；相关 Go/架构 guard 定向运行通过。
- 真实 `05-terminal-output`、`12-overview-preview-persistence` 和 `13-split-divider-render-isolation` 分别在 `tests-auto/05-terminal-output/artifacts/2026-09-04T03-52-47-179Z/`、`tests-auto/12-overview-preview-persistence/artifacts/2026-09-04T03-54-36-618Z/`、`tests-auto/13-split-divider-render-isolation/artifacts/2026-09-04T03-53-21-519Z/` 通过，确认 replay/大输出原子提交、最终预览持久化和分屏 live resize 没有回归。
- 移动端 DPR=3 重跑 `artifacts/2026-09-04T04-01-01-122Z/` 通过：字号、行高、移动 Zoom 的 `visibleHold=0`，移动 live Canvas backing/CSS 比例始终为 3，tab 激活仍有 14 个安全 hold 样本。第一次 DPR=3 尝试 `artifacts/2026-09-04T03-59-13-171Z/` 未进入操作阶段：desktop 已有稳定 presentation、mobile 正常，但通用双窗口运行器的 desktop 连接标签停在 `reconnecting`，旧前置选择器超时；原样重跑后通过，因此记为环境/多设备状态标签波动，不计产品失败。
- 隐藏 tab 不预分配 hold 优化后的最终桌面回归 `artifacts/2026-09-04T06-08-31-866Z/` 通过：字号、行高、`default ↔ freya` 主题、已加载自定义字体 ↔ 系统默认字体、桌面快捷栏、窗口 viewport，以及两个刚完成 presentation 的 tab 往返，所有阶段 `visibleHold=0`；快捷栏捕获到真实几何变化，稳定 tab 快路径未复制 outgoing hold。移动 context 在桌面逐帧采样前关闭，移动 Zoom/viewport 改由场景 04 单设备归因。
- 相关真实回归随后通过：跨设备 owner `tests-auto/01-multi-device-resize-sync/artifacts/2026-09-04T05-57-33-164Z/`、workspace tab `tests-auto/06-workspace-tabs/artifacts/2026-09-04T05-54-01-297Z/`、overview preview `tests-auto/12-overview-preview-persistence/artifacts/2026-09-04T05-54-41-456Z/`、高频分屏 `tests-auto/13-split-divider-render-isolation/artifacts/2026-09-04T05-55-18-400Z/`。
- 本轮最终 `node --test tests/*_test.mjs` 为 425/425；appearance、layout、settings、metrics、resize、viewport、workspace activation、rendering/session 相关定向 Go guard 均通过。

## 运行命令和环境变量

```bash
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" TEST_FOREGROUND=0 \
  node tests-auto/run-playwright.mjs tests-auto/10-terminal-geometry-jitter/test.mjs
```

## 产物与失败诊断

运行器将 screenshot、trace、JSONL、presentation probe 和 terminal timeline 写入 `artifacts/<run-id>/`。用例还记录逐帧 host/live/hold 几何、resize trace 和 presentation trace。失败时必须联合这些产物确认是 live Canvas 被隐藏、字体 fit 未收敛、服务端 resize 事务未完成还是测试环境错误。

## 已知限制

本场景使用真实 headless Chrome 和真实终端链路，不替代用户设备上的前台视觉判断。已加载字体族走 live；字体尚未加载、fallback 仍变化或 pane 尚未 replay commit 时继续允许原子保护。Force-PC 只由 Node/架构测试验证其发布 layout live 意图，桌面真实场景本身已处于 PC 布局，无法产生等价的移动→PC 几何切换。

仓库级 `go test ./...` 仍受既有 `TestRuntimeTerminalCanvasResidueGuard` 阻塞：该 guard 要求 `object-fit: none`，当前高 DPI hold 契约和样式使用 `object-fit: contain`。本次没有修改这项无关断言；所有受影响的 metrics/settings/resize/presentation/架构定向 Go guard 均已通过。
