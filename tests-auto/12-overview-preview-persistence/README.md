# 终端总览预览持久化真实环境回归

本用例在真实隔离 workspace 中创建第二个 tab，等待该 tab 的已提交终端画面写入独立 IndexedDB 缩略图存储，然后切回原 tab 并刷新应用。刷新后在后台 tab 尚未产生 live Canvas 时打开终端总览，必须从持久缩略图解码并绘制该 tab，不能显示“无预览”。

运行：

```sh
npm run build
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR="$PWD/build/runtime/static" \
node tests-auto/run-playwright.mjs tests-auto/12-overview-preview-persistence/test.mjs
```

测试只检查派生缩略图 Blob。它不得从 IndexedDB 恢复 PTY 字节、触发历史 replay、改变输入 ready，或为后台 tab 创建额外物理 Unified WebSocket。
