# 终端前端模块

`terminal/` 是浏览器终端责任域的聚合目录。既有独立文件已按 history、output、transport、rendering、resize、viewport、interaction、mouse、selection、overview、screenshot、input、TUI adapters 和 session 归档；各终端责任域的 controller/lifecycle 已完成迁移，`global-runtime.js` 只负责创建它们、注入显式依赖并按页面生命周期调用公开 API。

## 不可破坏的边界

- 普通容器页面只能有一条 Unified 物理 WebSocket；单 pane 只能创建或关闭自己的 logical stream。
- `client:` target 继续使用最多三条独立直连，不能套用容器 Unified 或 Cache API v2 假设。
- persistent agent 的原始 PTY 字节是历史权威，Canvas、preview 和浏览器缓存不是会话权威。
- replay、snapshot、resize 和重连的中间过程不得显示；已有同身份画面必须作为 last-known-good frame 保留。
- session 只组合子模块状态和生命周期，不实现 transport、history、rendering、resize 或 input 算法。

## 目录

- `history/`：replay、checkpoint、Cache API v2 和客户端历史缓存。
- `config/`：终端责任域共享的不可变默认值、阈值和超时参数。
- `output/`：实时/replay/suppressed 输出队列、有界 drain、过载重同步和 Queue turn ACK。
- `transport/`：连接调度、Fast/Queue/Unified 协议、健康检查、membership 和已打开 session 的主题发送适配。
- `rendering/`：Kitty graphics、RenderSnapshot 和 frame release。
- `resize/`：resize controller、scheduler 和尺寸同步判断。
- `viewport/`：移动 visualViewport、软键盘 inset、安全偏移、input viewport lock、光标 pan 和方向恢复。
- `interaction/`：桌面右键菜单、移动操作菜单、搜索、剪贴板、链接、菜单目标/动作分派及其 listener/异步生命周期。
- `mouse/`：Ghostty mouse mode、Legacy/SGR 编码、桌面/触摸 mouse 状态机、TUI 事件认领和 session listener 生命周期。
- `selection/`：选区算法、Ghostty selection manager 补丁、完整缓冲区选择、移动工具栏/手柄、长按和自动滚动生命周期。
- `overview/`：标签总览 controller、DOM view、listener lifecycle、拖拽/移动端手势和 cache preview。
- `screenshot/`：终端长截图。
- `input/`：输入队列、generated response、键盘覆盖层、helper textarea、IME、focus/touch keyboard 和 iOS 宿主脚本。
- `policy/`：Grok/Claude 会话识别、fullscreen 事件策略、终端位置描述和用户输入前滚动策略。
- `metrics/`：字体 metrics 刷新稳定化、live terminal options 适配、scrollback 同步和终端尺寸估算/query。
- `tui_adapters/`：按工具隔离的 fullscreen TUI 适配器。
- `session/`：pane session 身份、初始状态、DOM/Ghostty 资源工厂、子控制器组合、cleanup 注册和幂等销毁。

新增终端子模块时必须提供自己的 `README.md` 和单一公开入口，外部不得深度导入内部实现。
