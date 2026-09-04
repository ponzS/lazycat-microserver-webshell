# 终端 Viewport 真实环境回归

## 场景元数据

- 状态：active
- 类型：mobile / multi-device / responsive / lifecycle
- 真实依赖：真实 Provider、persistent agent、PTY、Unified WebSocket、iPhone User-Agent、Chrome visualViewport
- 相关模块和源码入口：`runtime/static/terminal/viewport/`、`runtime/static/terminal/resize/`、`runtime/static/terminal/metrics/`

## 触发条件

桌面与移动窗口先连接同一真实 pane 并验证输出同步，随后关闭桌面 context 隔离移动 owner。移动端依次执行 `Zoom+`/`Zoom-`、synthetic 软键盘收缩/恢复、横竖屏和 portrait-to-portrait 折叠宽度往返。

## 用户可见问题

稳定 viewport 结构变化过去会在最终 claim 时进入普通 resize hold，造成画面短暂停住；如果直接取消所有门禁，又可能把软键盘的 visualViewport 高度误提交成 PTY rows，或暴露 replay 中间画面。

## 预防的回归

- 移动 Zoom 和结构 viewport 变化始终显示 live Canvas，`hold=0`、`pending=0`。
- 结构变化从首次事件到最终稳定 generation 持有同一个 structural live source，只在结束时提交最终 claim。
- 软键盘 input lock 期间不得发送任何改变 cols/rows 的 resize。
- 首次加载、重连、history replay 和 identity 恢复仍保持原子呈现。
- 页面只有一条 Unified 物理 WebSocket，最终 Canvas 非空，console/pageerror/API error 为零。

## 修复前基线

`artifacts/2026-09-04T05-24-34-796Z/`：横竖屏和折叠宽度往返共 229 个样本，其中 20 个 hold 可见、16 个 presentation pending，按新断言失败。旧 `commitViewportGeometryClaim()` 使用普通 `claimActiveTabForCurrentDevice({ hideUntilRender:true })`。

## 已确认根因

旧实现直到 viewport 连续稳定后才发起普通 claim；ResizeObserver 会在此之前观察到 host 改变并进入原子 hold。初版 structural 改造只在 commit 时做一次 live fit，仍比 ResizeObserver 晚。另一次失败 `artifacts/2026-09-04T05-34-08-116Z/` 证明迟到 `document.fonts.ready` 可在键盘 suppression 中开启 metrics live resize，把键盘高度错误提交为 rows。

## 实施方案

viewport owner 在确认需要结构 claim 的首个事件中调用 begin structural live geometry，稳定 RAF/recovery probe 调用 update，最终 generation 调用 end；resize owner 管理 source、local fit、最终 target 和 ACK。非结构键盘变化继续 suppression，`document.fonts.ready` 在 suppression 期间不启动 metrics refresh。测试在双端输出同步后关闭 desktop context，避免远端 owner 事件污染移动逐帧归因，并在 `finally` 中通过 mobile 页面 API 清理隔离 tab。

## 验证预期

- 移动 Zoom 和方向/折叠采样均 `hold=0`、`pending=0`、`unsafe=0`。
- 键盘阶段新增 resize frame 为 0。
- 方向/折叠阶段至少产生两次最终 `claim:true`，socket 不被替换。

## 验证结果

2026-09-04 增加隔离 tab 清理后的最终真实场景通过，产物为 `artifacts/2026-09-04T06-07-25-694Z/`：

- 移动 Zoom 99 个样本：`hold=0`、`pending=0`、`unsafe=0`。
- 横竖屏/折叠 239 个样本：`hold=0`、`pending=0`、`unsafe=0`。
- 键盘阶段 resize frame 为 0；结构恢复产生 5 个最终 current-device claim。
- Unified socket 前后均为 1 条，desktop/mobile Canvas 均非空。
- DPR=3 复跑 `artifacts/2026-09-04T05-58-12-566Z/` 通过：移动 Zoom 98 个样本、结构 viewport 232 个样本均 `hold=0`、`pending=0`、`unsafe=0`，键盘 resize frame 为 0，最终 mobile Canvas backing 为 `1170×2142`。
- `node --test tests/*_test.mjs`：425/425 通过；viewport/resize/架构相关定向 Go guard 通过。

## 运行命令和环境变量

```sh
HEADLESS=1 \
WEBSHELL_MOBILE_USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/04-terminal-viewport/test.mjs
```

## 产物与失败诊断

运行器将 screenshot、trace、JSONL、desktop/mobile presentation probe 和 terminal timeline 写入 `artifacts/<run-id>/`。前置判活使用稳定 presentation，随后真实 output marker 必须在两个窗口出现，因此不会用 `reconnecting` 标签波动掩盖 logical stream 故障。

## 已知限制

本场景使用 synthetic visualViewport 和真实 Chrome/PTY/WebSocket，不等价于物理折叠屏铰链事件；真实设备仍需手动观察 safe-area、软键盘和系统方向动画。移动快捷栏配置内容变化没有在本轮单独编辑，只验证了真实 Zoom 按钮和现有快捷栏参与 viewport 布局。
