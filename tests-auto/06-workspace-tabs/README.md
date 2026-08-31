# Workspace 标签真实环境回归

本用例使用 `tests-auto/run-playwright.mjs` 创建的真实隔离 tab，验证 desktop 双击 inline rename、`rename_tab` workspace action、刷新后的服务端持久化、新 workspace 模块版本化加载、终端 Canvas 和单 Unified 物理连接。

运行：

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/06-workspace-tabs/test.mjs
```

隔离 tab 由统一运行器创建并在结束时关闭，不修改其他现有 tab。测试不得通过重放历史、清空终端或建立额外 WebSocket 来完成标签重命名。
