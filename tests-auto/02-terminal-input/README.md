# 终端输入真实环境回归

本用例连接 `debug123` 的真实 Provider、persistent agent 和 PTY，验证当前工作区前端的输入队列迁移没有改变输入行为。

覆盖普通文本、Enter、Ctrl-C、超过 16 KiB 的粘贴、DSR generated response、Canvas 更新、输入模块资源和单页面 Unified 物理连接数量。测试会创建独立 tab，结束时自动关闭。

使用当前工作区静态资源运行：

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/02-terminal-input/test.mjs
```

测试要求 API、console error 和 `pageerror` 为零；每个页面同时只能存在一条未关闭的 Unified WebSocket。
