# Workspace 标签真实环境回归

本用例使用 `tests-auto/run-playwright.mjs` 创建真实隔离 workspace，验证初始终端就绪后通过 `#newTab` 新建终端、desktop 双击 inline rename、`rename_tab` workspace action、刷新后的服务端持久化、新 workspace 模块版本化加载、终端 Canvas 和单 Unified 物理连接。新建终端必须达到 connection open、render ready 和 presented frame，Canvas 必须非空，且全过程不得出现 `unified pane stream is not active` 或创建第二条物理 Unified WebSocket。

运行：

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/06-workspace-tabs/test.mjs
```

隔离 workspace tab 由统一运行器创建并在结束时关闭；用例内的新建临时 tab 也会通过 workspace API 清理，不修改其他现有 tab。测试不得通过显示历史回放、清空终端、刷新页面或建立额外 WebSocket 来让新终端恢复或完成标签重命名。
