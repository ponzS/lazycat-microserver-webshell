# 客户端实例终端

本目录维护 `client:` 实例的前端专属实现，入口为 `index.js`。本次仅拆分职责，保持现有 PC 客户端 agent v8 协议、每 pane 直连 WebSocket、最多 3 个直连租约及后台标签停放行为。统一单 WebSocket 和 hportal 接入属于后续独立任务。

## 模块边界

- `connection_controller.js`：直连调度器的唯一 owner，负责客户端优先级、租约分配/释放、停放、重试、在线状态和销毁。复用 `terminal/transport/terminal_connection_scheduler.js` 调度原语与生命周期工具。
- `protocol_controller.js`：客户端会话协议入口。引用共享 socket/消息处理能力，创建独立的 controller 并注入客户端适配；容器 controller 不安装此适配。
- `session_protocol.js`：连接前准备、客户端历史范围、内存/缓存恢复及历史重置/删除，向共享 socket owner 提供明确接口。
- `replay_adapter.js`：将 agent v8 原始有序字节流适配到公共 replay controller，保留 identity、sequence 和 cursor 校验。
- `history_controller.js`：客户端历史 load/reset/write/flush/touch/delete、写入调度、回放缓存提交及迟到结果隔离。
- `history_cache.js`：IndexedDB 存储原语，数据库名、schema、键和过期策略均保持不变。
- `history_range.js`：客户端 memory/cache connect range 查询。
- `config.js`：客户端专属连接容量和历史缓存配置，数值保持不变。

`global-runtime.js` 创建上述模块并注入依赖，根据 session 的实例类型选择容器或客户端协议入口。`terminal/transport/transport_runtime_controller.js` 保留容器 Unified membership，并在客户端分支委托直连控制器。`terminal/history/session_replay_controller.js` 保留公共回放提交门禁，通过回调调用客户端缓存逻辑。输入与 pane 安装只使用公共接口，不直接维护客户端缓存或调度实现。

渲染、输出队列、输入/IME、resize、终端后端、workspace tab/pane UI 继续复用原公共模块。容器 Unified 连接、checkpoint、物理连接健康监控及服务端协议保持原实现。共享模块修改仍需同时审核两类实例，客户端专属行为应优先在本目录内维护。

## 保持的生命周期约束

- 非客户端实例不创建直连调度器或 IndexedDB 历史任务。
- 连接前仍依次准备历史、排空输出、flush 缓存，再检查连接是否仍有效。
- 客户端历史恢复仍拒绝游标不连续、identity 不匹配及过期连接结果；缓存失败沿用原降级处理。
- 优先级衰减回调经过当前目标的运行时路由，目标变化后不能对容器发起客户端调度。
- session/page 销毁仍取消计时器、释放租约并保留原 flush/dispose 顺序。

## 手动回归建议

1. 普通容器首次打开、刷新、持续输出、输入、历史恢复及断网重连；确认仍复用单个 Unified 业务连接。
2. 普通容器创建/关闭/切换标签、分屏和调整尺寸；确认各 pane 内容和输入不串流。
3. 客户端首次打开、新建标签、分屏和连续输入；切换含不同历史长度的标签后能恢复内容并继续输入。
4. 客户端刷新后走缓存恢复，同页重连走内存恢复；缓存不可用时仍能完整回放并继续交互。
5. 客户端超过直连容量时的租约抢占、后台标签停放及返回恢复；关闭 pane 后释放连接。
6. 容器与客户端来回切换、离线/恢复、页面关闭，确认旧连接和迟到回调不影响当前目标。

构建与静态检查不代替上述真实运行验收。
