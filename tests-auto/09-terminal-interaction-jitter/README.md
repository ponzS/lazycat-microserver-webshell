# 终端交互抖动回归

本用例连接真实 `debug123` Provider、persistent agent 和 PTY，并把版本化静态资源映射到当前工作区。它在进入终端、输入文字和拖拽选择期间按 RAF 采样页面滚动、terminal host/canvas 几何、输入框位置、Canvas backing size 和呈现状态，防止交互事件再次触发垂直位移或不必要的 fit/重绘。
