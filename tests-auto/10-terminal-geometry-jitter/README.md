# 终端几何变化抖动回归

覆盖终端字号调整、浏览器 viewport 变化和 tab 激活期间的逐帧 Canvas 几何与 presentation hold 状态。三类操作都必须保持当前有效帧，不能显示未定位的 hold Canvas、黑屏或历史回放中间过程。

运行方式：

```bash
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" TEST_FOREGROUND=0 \
  node tests-auto/run-playwright.mjs tests-auto/10-terminal-geometry-jitter/test.mjs
```

用例要求 `WEBSHELL_LOCAL_STATIC_DIR`，并使用真实 WebSocket、workspace API 和 Ghostty Canvas。
