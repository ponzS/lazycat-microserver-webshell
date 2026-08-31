# 终端 Viewport 真实环境回归

本用例连接 `debug123` 的真实 Provider、persistent agent 和 PTY，并把版本化前端资源映射到当前工作区。移动窗口使用 iPhone User-Agent，使桌面 Chrome 进入 iOS visualViewport 分支。

覆盖 synthetic visualViewport 键盘收缩与恢复、input viewport lock、键盘 inset、移动快捷键栏、横竖屏 viewport resize、原子 Canvas 呈现、viewport 模块资源和单页面 Unified 连接数量。键盘阶段不得发送终端几何 resize；方向变化只复用当前内存终端状态，不得触发历史 replay 或暴露中间帧。

```sh
HEADLESS=1 \
WEBSHELL_MOBILE_USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/04-terminal-viewport/test.mjs
```

测试要求 API、console error 和 `pageerror` 为零，最终 Canvas 非空，orientation 前后仍只有一条 Unified 物理 WebSocket。
