# Workspace refresh/retry 真机回归

本用例使用真实 `debug123` Provider、agent、PTY 和 WebSocket，同时把版本化静态资源映射到当前工作区。

测试在 desktop 页面 reload 时仅拦截第一次 workspace GET，并返回预期的 HTTP 503。随后验证前端自动退避重试并恢复同一隔离 tab，活动终端 Canvas 非空，workspace 代码由版本化 Vite bundle 提供且浏览器不再请求 refresh controller/lifecycle 源码文件，页面仍只有一条活动 Unified WebSocket。

2026-09-04 Vite 产物适配后的运行 `artifacts/2026-09-04T08-27-27-707Z/` 未进入 workspace 恢复断言：测试机 WebSocket 持续被 Chrome 以 `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` 拒绝，desktop/mobile 均无法建立物理通道。这是浏览器到测试机的环境策略失败，HTTP Vite bundle 和预期注入的首次 workspace 503 均已到达；本场景需在该网络策略恢复后重跑，不能记为功能通过。

运行：

```sh
npm run build
HEADLESS=1 WEBSHELL_LOCAL_STATIC_DIR="$PWD/build/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/07-workspace-retry/test.mjs
```
