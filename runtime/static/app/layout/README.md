# 应用布局模块

## 职责

`layout/` 负责移动/触摸媒体查询、debug 强制 PC 模式、桌面快捷键栏策略和终端移动像素滚动开关。强制 PC 切换时只协调显式的菜单、选择、viewport、resize、设置和标题回调，不直接拥有这些模块的状态。

## 文件清单

- `index.js`：唯一公开入口。
- `layout_controller.js`：布局判定、force-PC DOM 同步、session/tab 滚动属性同步和 dispose fence。

## 边界与验证

布局策略不建立 WebSocket、不读取或修改 history/replay/cache/Canvas 状态，也不触发 history replay、snapshot、resize 或重连中间帧呈现。dispose 后布局查询和 session 属性同步均失效。
