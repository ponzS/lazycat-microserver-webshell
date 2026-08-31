# 终端 IME 真实环境回归

本用例连接 `debug123` 的真实 Provider、persistent agent 和 PTY，并把版本化前端资源映射到当前工作区。

覆盖 composition/preedit 提交与重复 input 抑制、ASCII composition 后空格抑制、连续 Backspace、paste/beforeinput 去重、移动端单击 blur、同步双击 focus、IME 模块资源、Canvas 和单页面 Unified 连接数量。

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/03-terminal-ime/test.mjs
```

测试要求 API、console error 和 `pageerror` 为零；任何步骤都不得触发或显示历史回放中间过程。
