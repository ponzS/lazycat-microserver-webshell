# 终端 Output 真实环境回归

本用例连接 `debug123` 的真实 Provider、persistent agent 和 PTY，并把版本化前端资源映射到当前工作区。

覆盖普通输出、约 1.5 MiB 大块输出、持续输出期间 resize、持续输出期间切换到隐藏 tab、Canvas 原子呈现、output 模块资源、输出过载指标和单页面 Unified 连接数量。所有输出必须最终到达当前 Ghostty 内存状态；resize、隐藏和恢复期间不得暴露 replay、snapshot 或中间 Canvas。

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/05-terminal-output/test.mjs
```

测试要求 API、console error 和 `pageerror` 为零，最终 Canvas 非空，presentation 采样中 unsafe 为零，输出压力前后每个页面仍只有一条 Unified 物理 WebSocket。
