# Workspace refresh/retry 真机回归

本用例使用真实 `debug123` Provider、agent、PTY 和 WebSocket，同时把版本化静态资源映射到当前工作区。

测试在 desktop 页面 reload 时仅拦截第一次 workspace GET，并返回预期的 HTTP 503。随后验证前端自动退避重试并恢复同一隔离 tab，活动终端 Canvas 非空，refresh controller/lifecycle 从版本化资源加载，且页面仍只有一条活动 Unified WebSocket。

运行：

```sh
HEADLESS=1 WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/07-workspace-retry/test.mjs
```
