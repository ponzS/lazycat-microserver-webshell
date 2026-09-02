# 终端几何变化抖动回归

覆盖终端字号调整、浏览器 viewport 变化和 tab 激活期间的逐帧 Canvas 几何与 presentation hold 状态。三类操作都必须保持当前有效帧，不能显示未定位的 hold Canvas、黑屏或历史回放中间过程。移动端额外通过真实快捷键点击 `Zoom+` 后 `Zoom-`，记录字号 setter 前后、fit/resize settle、hold/live Canvas 尺寸及 DPR。

运行方式：

```bash
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" TEST_FOREGROUND=0 \
  node tests-auto/run-playwright.mjs tests-auto/10-terminal-geometry-jitter/test.mjs
```

- 字号变化期间 Ghostty live canvas 可能暂时大于 host；只要已有稳定帧，hold 必须可见且 live canvas 必须隐藏，不能把该中间尺寸展示给用户。
- hold backing 尺寸按 host CSS 尺寸乘 `devicePixelRatio`；稳定提交后 hold 必须隐藏。
- 日志中的 `font_size_change_start`、`font_size_change_after_setter` 和 `font_size_change_fit` 用于区分字号 setter 的临时几何、resize ACK 等待和最终 presentation commit。
