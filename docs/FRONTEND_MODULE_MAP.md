# 前端模块梳理与目标边界

本文用于梳理当前前端代码可以拆分的责任域、状态所有权、迁移进度和建议目录。整理按单一责任域逐步实施，每一批都必须保留现有终端历史、连接、渲染和输入 guard。

## 当前快照

- `runtime/static/main.js` 在建立模块地图时为 25165 行；当前仅保留 3 行应用入口。原入口实现已移入 `global-runtime.js`，并继续按责任域迁移；已完成低风险业务模块、terminal session/overview/interaction/selection/mouse、renderer adapter、presentation、resize、输入队列、IME、移动快捷键、移动 viewport、output、history/replay transaction、session connection、Unified 物理 transport 与 logical/direct runtime 编排。当前根 runtime 不再直接序列化 ping、resize、input 或 Queue ACK，也不直接实现 presentation-ready 的业务副作用。
- 页面级 online/offline、显隐、焦点、页面进入/离开、全局 resize/键盘恢复和 heartbeat listener 已由 `app/app_lifecycle.js` 统一拥有；确认、prompt 和移动关闭 sheet 的 DOM/resolver 生命周期已由 `app/dialog_controller.js` 统一拥有；桌面快捷键命令路由已由 `app/shortcuts/` 统一拥有；移动快捷键和页面外壳按钮的应用命令路由已由 `app/commands/` 统一拥有。`global-runtime.js` 只导入并调用 `startGlobalRuntime()`；全局 active target/generation、feature controller 实例、Ghostty/DOM 资源工厂、启动/恢复/页面销毁顺序统一由同级的 `global-runtime.js` 持有。workspace API、恢复/活动 tab 持久化、refresh/retry、权威 state apply、布局、registry/activity、tab label/navigation、tab/pane CRUD 及 tab 激活运行时编排已分别由 `workspace/` 中的独立 controller/view/lifecycle 公开维护。
- 已独立成文件的连接、回放、截图、TUI 适配、iOS 宿主、tab 激活调度器、终端配置和 diagnostics 网络快照 adapter 已从静态根目录归档到对应模块目录，并通过公开 `index.js` 引用；`connectSession()`、workspace 和 app lifecycle 的实现迁移均已完成。
- `createPaneSession()` 当前只请求 session controller 创建状态，再按固定顺序安装各模块；presentation-ready 的 input/diagnostics/transport 局部接线也由 session installation controller 维护。后续只能通过 transport、history、output、IME、workspace 和 app 公开入口继续收敛，不能把算法重新堆回 session controller 或入口文件。

### 2026-08-31：PWA、Cache API v2 与普通容器本地历史移除

- 页面不再注册 Service Worker，不再发布 Web App Manifest/PWA 图标，也不申请浏览器持久存储。静态资源仅通过 Provider 注入的内容寻址 `/assets/<asset-version>/` URL 和 HTTP immutable cache 发布。
- 普通容器不再创建 Cache API v2 identity、manifest/chunk、warm replay、preview、compaction 或本地 cursor range。Unified logical stream 只携带 `workspace_generation`，并直接消费 persistent agent 的权威 `snapshot + live`。
- `client:` target 继续由 `terminal/history/client_history_controller.js` 独占 IndexedDB load/write/flush/reset/delete；所有入口都以 `isClientTarget()` 为硬 guard，普通容器调用必须无副作用。
- 总览不读取旧 Cache API preview，但由 `terminal/overview/` 使用独立 IndexedDB 保存已提交 Canvas 的派生图片 Blob。来源顺序为 live Canvas、last-known-good hold frame、同 identity 持久图片；它不保存 PTY 字节/cursor，不触发 replay，也不参与终端恢复。
- bootstrap 只保留旧 Worker/已知 Cache 名称的升级迁移资源：`index.html` 在版本化资源加载前，仅对已有 controller 的页面调用现有 registration 的 `update()`；新版页面启动后继续执行一次性清理器；Provider 同时在旧 `/service-worker.js` URL 提供无 fetch/预缓存/claim 的退役 Worker，使旧受控页面能删除已知缓存、注销 registration 并一次性重载。页面仍不注册 Service Worker，干净用户不请求退役脚本或增加导航；这些迁移资源不读取终端数据、不参与首屏、离线 fallback 或资源调度。
- 本节取代下方旧迁移记录中关于 Service Worker 预缓存、Cache API v2、warm replay 和缓存 preview 的现行描述。旧记录只保留当时的架构背景，不得作为新实现依据。

## 已完成迁移

### 2026-08-30：`diagnostics/`

- 已建立 `runtime/static/diagnostics/`，包含独立 README、公开入口、controller、lifecycle、DOM view、错误日志、FPS、性能任务、网络监视器、启动追踪和终端诊断时间线。
- 调试总控、各诊断开关、日志去重、console/window 捕获、FPS RAF、性能样本、网络动态加载 generation、采样 timer 和 socket instrumentation 已从原入口实现迁出。
- 终端事件时间线改由 diagnostics 内部 `WeakMap` 持有，不再写入业务 session 对象。
- `global-runtime.js` 只向 diagnostics 提供终端连接的只读网络快照并调用公开 API；诊断模块不反向读取全局运行时状态。
- `network_monitor.js` 继续按需动态加载且不进入 Service Worker 预缓存；其余静态 diagnostics 依赖已加入版本化 app shell。
- 已增加 `diagnostics_controller_test.mjs`，覆盖开关持久化、幂等启动/销毁、资源清理、迟到动态加载 guard 和诊断时间线所有权。
- 验证已通过 diagnostics 定向测试、前端 Node 全量 148 项、`go test ./...`、`go test -race ./...`、浏览器 401 启动失败路径、版本化资源请求和 LPK 内容核对。

### 2026-08-31：diagnostics 网络快照与终端配置边界

- 新增 `runtime/static/diagnostics/network_context.js`，通过 `diagnostics/index.js` 公开 `createDiagnosticsNetworkContext()`；当前 target 下的 direct/Unified socket 过滤、retrying 汇总和 online 快照不再由 `global-runtime.js` 实现。
- 新增 `runtime/static/terminal/config/`，由 `index.js` 和 `terminal_config.js` 公开冻结的终端阈值、超时、缓存参数和 storage prefix；全局 runtime 只读取配置，不再重复声明终端领域常量。
- 两个模块均无业务状态、timer、listener 或 socket owner。diagnostics adapter 只返回新快照，配置模块只返回不可变值；全局 runtime 继续保留 controller 创建顺序、依赖注入和全局生命周期。
- `diagnostics_network_context_test.mjs`、`terminal_config_test.mjs` 以及 `TestRuntimeDiagnosticsModuleBoundary`、`TestRuntimeTerminalConfigModuleBoundary` 固定 direct/Unified 过滤、关闭 pane、target 隔离、公开入口、README 和 Service Worker 资源契约。
- 终端历史、snapshot、resize 和重连过程的可见性边界未改变；配置或诊断路径不得触发任何历史回放展示。

### 2026-08-31：session 批量销毁与 Unified URL 边界

- `terminal/session/session_lifecycle.js` 新增 `disposeAll()`，按单 pane 相同的 closed、logical detach、历史写入 flush 和资源清理顺序批量销毁页面内 session；`session_controller.js` 通过 `terminal/session/index.js` 公开该 API。
- `global-runtime.js` 的 `beforeunload` 只调用 session controller 的批量销毁入口，不再直接修改 pane 的 closed/replay/Queue 字段，也不再直接清理连接 timer；其他全局 controller 仍按根运行时声明的顺序幂等 dispose。
- `terminal/transport/websocket_url.js` 新增无状态 `terminalUnifiedWebSocketURL()`，统一设置 Unified endpoint 的 target、client ID 和协议参数；根 runtime 只传递依赖，不再拼接 query string。
- `terminal_session_controller_test.mjs`、`terminal_websocket_url_test.mjs` 以及对应 Runtime 静态 guard 覆盖批量销毁顺序、幂等性、身份编码和 URL 参数归属。两条路径均不显示历史 replay、snapshot、resize 或重连中间过程。

### 2026-08-30：`app/` 页面生命周期

- 已建立 `runtime/static/app/`，包含 README、公开入口和 `app_lifecycle.js`。
- 页面级 listener、字体 ready 迟到回调、heartbeat timer 和统一 dispose 已从 `global-runtime.js` 的直接注册迁出；controller 通过显式 handlers 协调业务模块，不拥有终端、工作区或缓存状态。
- 既有 online/offline、visibility/pageshow/focus/pagehide、全局 resize/键盘/触摸恢复和存储持久化行为保持原顺序；beforeunload 仍先 flush 设置与缓存、再执行 busy-pane 门禁，允许路径才进入既有模块销毁顺序。
- `app_lifecycle_controller_test.mjs` 覆盖幂等 start、listener/timer 清理、字体 Promise generation 和 beforeunload 返回值；`TestRuntimeAppLifecycleModuleBoundary` 固定公开入口、Service Worker 资源、无终端实现侵入和 global-runtime 接线。
- 工作区/tab/layout 业务已迁入 `workspace/`；`global-runtime.js` 只保留应用根入口的显式依赖接线和全局生命周期调用。

### 2026-08-30：`app/` 对话框与移动关闭确认

- 已建立 `runtime/static/app/dialog_controller.js`，通过 `app/index.js` 公开；桌面 confirm/prompt、移动关闭确认 sheet 的 resolver、DOM 更新、焦点、Escape、重复请求和 dispose 均由该 controller 独占。
- `global-runtime.js` 只注入页面 DOM、移动布局判断、关闭移动操作菜单和活动终端 focus 回调；服务转发、设置、workspace activity、重启和 tab 重命名均通过公开确认 API 获取用户意图，不再维护 resolver 或具体按钮 listener。
- 页面级键盘事件继续由 `app_lifecycle.js` 注册，controller 的 `handleEscape()` 参与既有 modal 优先级；对话框和移动 sheet 不读取或修改 workspace、terminal、transport、history、rendering 状态。
- Guard：`app_dialog_controller_test.mjs` 覆盖 confirm/prompt、重复打开、Escape、移动布局、焦点和 dispose；`TestRuntimeDialogModuleBoundary` 固定公开入口、Service Worker 资源、旧 resolver/listener 不得回流 `global-runtime.js`。

### 2026-08-30：`app/shortcuts/` 桌面快捷键命令

- 已建立 `runtime/static/app/shortcuts/`，包含公开入口、`shortcut_controller.js` 和 `shortcut_lifecycle.js`；桌面动作映射、全屏切换、交互目标过滤以及原生粘贴分支已从 `global-runtime.js` 迁出。
- shortcut controller 不持有 tab/pane、设置、附件、终端或工作区状态；所有操作通过显式回调注入。页面 `keydown` listener 仍由 `app/app_lifecycle.js` 注册，应用控制器只负责创建 controller 并转发事件。
- 生命周期 fence 在 dispose 后拒绝迟到快捷键命令；模块不建立 WebSocket、不执行历史回放、不修改 Canvas，也不显示 replay、snapshot、resize 或重连中间帧。
- Guard：`app_shortcut_controller_test.mjs` 覆盖动作分派、交互目标、Shift+Insert 原生粘贴和 dispose；`TestRuntimeAppShortcutModuleBoundary` 固定公开入口、Service Worker 资源、app 接线和实现不得回流 `global-runtime.js`。

### 2026-08-31：`app/commands/` 应用命令与 shell 控件

- 已建立 `runtime/static/app/commands/`，包含公开入口、命令 controller、生命周期和目录 README。
- 移动快捷键的 tab、总览、搜索、附件、复制/粘贴、分页、缩放和移动菜单 action 路由，以及新建 tab 的目标检查和 `create_tab` workspace action 已从 `global-runtime.js` 迁出；桌面/移动调用方都只通过显式命令回调交互。
- 新建 tab 按钮、空状态按钮和 tab 栏垂直滚轮 listener 由 command lifecycle 独占，`install()` 幂等，`dispose()` 移除 listener 并拒绝迟到命令。命令模块不拥有 tab、pane、session、transport、history、replay、resize 或 Canvas 状态，也不显示任何历史中间过程。
- Guard：`app_command_controller_test.mjs` 覆盖 action 分派、缺少活动实例、按钮/滚轮事件、幂等安装和 dispose；`TestRuntimeAppCommandModuleBoundary` 固定公开入口、Service Worker 资源以及实现不得回流 `global-runtime.js`。

### 2026-08-30：workspace 布局 DOM 与入口边界

- `main.js` 收敛为单一 `startGlobalRuntime()` 调用，应用启动实现由同级 `global-runtime.js` 持有，避免入口文件继续累积业务实现。
- `workspace/layout_view_controller.js` 接管 layout tree 的 DOM materialization、split divider pointer 生命周期和 `update_layout` action；布局算法仍由 `layout_controller.js` 独立拥有。
- `global-runtime.js` 通过显式回调注入 resize、pane 激活、workspace action 和 toast；布局模块不读取或修改 transport、history、replay 或共享全局状态。
- Guard：`workspace_layout_view_controller_test.mjs` 覆盖 leaf/split 渲染、divider resize、dispose 迟到事件；`TestRuntimeWorkspaceModuleBoundary` 固定入口只调用 app 公开 API、Service Worker 资源和布局实现不回流入口。
- 验证：Node workspace 定向测试、`node --check`、`go test ./...` 和 `git diff --check`。

### 2026-08-30：workspace activity 与 tab registry 基础状态

- `workspace/tab_registry.js` 统一持有 tab Map、ID 序列和活动 tab 快照；应用控制器只通过该 registry 取得集合，避免继续创建隐式全局 Map。最近 tab 状态由后续独立的 navigation controller 持有，禁止出现双 owner。
- `workspace/activity_controller.js` 接管 activity 请求、pane busy 同步、关闭前运行中命令确认及轮询 timer；请求结果绑定实例 generation，dispose 后拒绝迟到回调。
- activity controller 不拥有 WebSocket、history/replay、Canvas 或 pane session 生命周期，所有终端尺寸、通知和标题更新通过显式回调完成。
- Guard：`workspace_activity_controller_test.mjs`、`workspace_tab_registry_test.mjs` 与 `TestRuntimeWorkspaceModuleBoundary` 覆盖状态更新、generation 边界、timer 清理和公开入口。

### 2026-08-30：workspace tab label 与 inline rename

- `workspace/tab_label_controller.js` 接管 tab label DOM 更新、desktop 双击 inline rename、输入框几何、optimistic `rename_tab` 提交和失败回滚；`tab_label_lifecycle.js` 独占 AbortController 与 focus RAF。
- `global-runtime.js` 只在 tab button 双击、自动标题刷新、工作区 state 应用、prompt rename、tab 删除和页面 dispose 边界调用公开 API，不再持有 inline rename 状态或输入 listener。
- controller 只读取注入的 tab registry 和 active/applying 状态，并发布 workspace action；不读取 terminal session、transport、history、resize 或 presentation 状态。
- Guard：`workspace_tab_label_controller_test.mjs` 覆盖标题更新、inline rename、optimistic 提交/回滚和 dispose 后迟到 focus；`TestRuntimeDesktopDoubleClickInlineRenamesTab` 与 `TestRuntimeWorkspaceModuleBoundary` 固定公开入口、Service Worker 和实现不得回流应用控制器。

### 2026-08-30：workspace tab navigation 与最近 tab

- `workspace/tab_navigation_controller.js` 接管 tab DOM 顺序读取、前后/索引切换、滚动可见性、最近两个 tab 的按实例持久化与交换命令。
- `global-runtime.js` 只保留导航 controller 的创建和显式方法转发；工作区 state 应用、快捷键、tab 关闭和总览都通过公开 API 读取顺序或最近 tab，不再直接持有 `recentTabIds` 或 storage key。
- navigation controller 只依赖注入的 tab registry、tab DOM、localStorage、active selector 和激活命令，不读取 terminal session、transport、history、resize 或 presentation。页面销毁会幂等清空内存状态并拒绝迟到命令。
- Guard：`workspace_tab_navigation_controller_test.mjs` 覆盖 DOM 顺序、循环/索引切换、滚动、按实例持久化、去重裁剪、最近 tab 交换和 dispose；`TestRuntimeWorkspaceModuleBoundary` 固定公开入口、Service Worker、唯一状态 owner 和实现不得回流应用控制器。

### 2026-08-30：workspace API、恢复与活动 tab 持久化

- `workspace/workspace_api.js` 接管 workspace/activity URL、带终端尺寸的 GET/POST、Provider 错误、selector 校验、server revision 观察和仅对当前 selector/generation 应用响应的边界。
- `workspace/persistence_controller.js` 接管无 TTL 的 workspace restore、`last=false` 清理、URL 更新 suppression、last/restart tab、首页导航提交/回滚以及 latest-current 的串行 `activate_tab` 持久化队列。
- `global-runtime.js` 只注入 active selector/generation、终端尺寸、workspace apply、overview location 和最近 tab getter；不再声明请求实现、storage key、restore suppression 或 persistence Promise chain。两个模块均提供幂等 `dispose()`，迟到请求和排队事务不能修改已切换或已销毁的工作区。
- Guard：`workspace_api_controller_test.mjs` 与 `workspace_persistence_controller_test.mjs` 覆盖 URL/body、错误响应、selector mismatch、stale response、启动恢复、首页导航、last/restart tab、串行持久化、失活跳过和 dispose；既有 LightOS 首页恢复与异步 tab activation Go guard 已迁到新 owner。

### 2026-08-30：`service_forwarding/`

- 已建立 `runtime/static/service_forwarding/`，包含独立 README、公开入口、controller、API、model、DOM view 和 lifecycle。
- 发布列表、当前编辑 ID、busy、刷新 generation、部署/删除 operation generation 和延迟 focus timer 已从原入口实现迁出，由 controller 唯一持有。
- Provider `/api/publish/*` 白名单请求、multipart 安装和错误解析集中在 API 层；浏览器不直接访问 LightOS Admin。
- 实例切换会清空旧目标列表和编辑器，并使旧刷新或操作回调失效；新建发布记录安装失败时继续执行补偿删除。
- `global-runtime.js` 只在设置 tab、实例目标、全局 Escape 顺序和页面销毁时调用模块公开 API，不再查询服务转发 DOM、注册模块事件或实现发布事务。
- 已增加 `service_forwarding_controller_test.mjs`，覆盖目标过滤、迟到刷新、完整创建/编辑/安装/删除请求、失败回滚、listener/timer 清理和 dispose guard。
- 验证已通过服务转发定向测试、前端 Node 全量 153 项、`go test ./...`、`go test -race ./...`、浏览器设置页交互、版本化模块请求和 LPK 内容核对。

### 2026-08-30：`attachments/`

- 已建立 `runtime/static/attachments/`，包含独立 README、公开入口、controller、API、clipboard、model、DOM view 和 lifecycle。
- 附件弹层、文件浏览路径/排序/选择、上传记录、XHR、进度、ClipboardItem reservation、timer、触摸返回和请求 generation 已从原入口实现迁出。
- 浏览请求同时绑定目标和 browser generation；切换实例或关闭浏览器后，旧响应不能覆盖当前列表。上传绑定创建时的实例和 tab，关闭 tab、切换实例或 dispose 会统一 abort 并清理动态面板。
- Provider 附件列表、上传和下载白名单 URL 集中在 API 层；客户端实例仍从 `/` 开始浏览，普通容器仍从活动 pane 的 cwd 开始。
- `global-runtime.js` 只转发附件动作，并在 tab 激活、搜索状态、实例切换、tab 删除、Escape、启动和销毁时调用公开 API。
- 已增加 `attachments_controller_test.mjs`，覆盖旧目标迟到列表、Provider 路由、客户端根路径、上传进度、路径复制、32 文件/2GB 限制、自动关闭、tab/target/dispose 清理和真实 listener 注销。
- 验证已通过附件定向测试、前端 Node 全量 158 项、`go test ./...`、`go test -race ./...`、JavaScript 语法检查、Chromium 真实 DOM 交互和 LPK 内容核对。

### 2026-08-30：`devices/`

- 已建立 `runtime/static/devices/`，包含独立 README、公开入口、controller、API、model、DOM view 和 lifecycle。
- 心跳开关、active/in-flight/error、interval、timeout、AbortController、列表 entries/loading/signature、request generation、刷新 interval、面板和延迟 focus 状态已从原入口实现迁出。
- 调试总控只通过 `setDebugMode()` 传入只读启停状态；关闭总控会发送离线 beacon、停止两类 interval、abort 在途请求并关闭面板，但不会清除用户保存的心跳开关。
- 关闭、重开或销毁设备面板会递增 request generation，迟到列表不能覆盖当前 UI；页面 resume、resize 和 pagehide 由 `main.js` 通过公开生命周期方法转发。
- Provider `/api/devices`、`/api/devices/heartbeat` 和 `/api/devices/offline` 路由集中在 API 层；账号隔离和短 TTL 继续由服务端权威决定。
- 已增加 `devices_controller_test.mjs`，覆盖心跳单 in-flight、abort、调试总控关闭、迟到列表、Provider 路由、设备身份、beacon 条件和 listener 清理。

### 2026-08-30：`instances/`

- 已建立 `runtime/static/instances/`，包含独立 README、公开入口、controller、loader、model、DOM view、navigation 和 lifecycle。
- 实例列表 snapshot、公开 load generation、切换器打开/反馈状态、首页 URL cache/in-flight、AbortController 和模块 listener 已从原入口实现迁出。
- `/api/instances` 继续保持网络错误及 502/503/504 有限退避、401/403 不重试、并发单飞、Provider 详情保留和 dispose 拒绝迟到结果；旧根目录 `instances_loader.js` 已移入模块。
- `global-runtime.js` 只通过 `onSwitchTarget` 接收选择命令并保留工作区 reset/refresh；`activeName` 与 `activeInstanceGeneration` 暂时仍属于工作区核心，实例 controller 不读取或修改 tab/pane、终端连接、历史、resize 或 Canvas 状态。
- 首页导航由 navigation 独占 Provider URL cache 和请求取消，工作区恢复提交/回滚仍通过显式回调留在应用/工作区边界。
- 已增加 `instances_controller_test.mjs`，并更新 loader 和 Go 静态契约测试，覆盖列表快照、切换命令、默认目标、单飞、导航、listener、dispose、公开入口和 Service Worker 资源。

### 2026-08-30：`appearance/` 主题域

- 已建立 `runtime/static/appearance/`，包含独立 README、公开入口、controller、lifecycle、DOM view、catalog loader、纯 model 和 Canvas preview。
- 主题 catalog、active theme、localStorage、catalog request generation/AbortController、文档 CSS variables、浏览器 `theme-color`、picker/settings 列表、滚动条 RAF/drag、touch edge swipe、focus/scroll timer 和全部模块 listener 已从原入口实现迁出。
- `themes.json` 由 `theme_catalog.js` 通过相对 `import.meta.url` 解析版本化资源；请求失败保留内置 fallback，并发加载共享当前请求，dispose 后拒绝迟到 catalog。
- `global-runtime.js` 只读取主题副本和终端颜色 payload，并通过 `onThemeChange` 把变化交给现有终端 presentation 适配；appearance 不读取 session registry，也不进入 transport、history、replay、resize 或 Canvas 权威状态。
- 终端主题切换继续先调用现有 presentation hold，再更新 Ghostty theme；不会清空终端、重新写入历史或展示 replay 中间过程。
- 已增加 `appearance_controller_test.mjs` 和 `TestRuntimeAppearanceModuleBoundary`，覆盖持久化、不可变快照、terminal theme/payload、catalog 单飞、Abort/generation、picker listener/timer/RAF/touch/pointer 清理、公开入口和 Service Worker 资源。

### 2026-08-30：`settings/`

- 已建立 `runtime/static/settings/`，包含独立 README、公开入口、controller、API、纯 model、DOM view、lifecycle、字体 registry 和快捷键 editor。
- 服务端设置 snapshot、本地字号/强制 PC/移动远程桌面偏好、字段级 PATCH 队列、pending overlay、请求 generation、字体注册、两套快捷键编辑器、面板导航、拖拽和 timer 已从原入口实现迁出。
- 每次持久化只发送一个被修改字段；`null` 表示恢复默认，`[[], []]` 与 `[]` 保持显式空配置，手机快捷键文本中的空格、换行和制表符原样保留。
- `global-runtime.js` 只通过公开 getter 和显式回调消费设置。字体与字号变化先保留当前 presentation frame 再刷新 Ghostty metrics；行高和布局选项只请求现有 resize；这些适配不得进入或展示历史回放过程。
- `settings_controller_test.mjs` 覆盖不可变快照、字段级 PATCH、pending overlay、显式空值、文本保真、reset `null`、dispose 和迟到 load；`TestRuntimeSettingsModuleBoundary` 固定公开入口、各子文件职责、Service Worker 资源及 `main.js` 禁止重新持有设置实现。

### 2026-08-30：`terminal/session/`

- 已建立 `runtime/static/terminal/` 聚合说明和 `runtime/static/terminal/session/`，包含独立 README、公开入口、controller、state 和 lifecycle。
- pane ID 序列、初始 cols/rows 归一化、完整 session 初始状态、replay/resize/render snapshot 子控制器创建已从原入口实现迁出；当前字段暂时保持扁平，避免在同一批中改写 transport、history、input、output、resize 和 presentation 算法。
- lifecycle 使用模块私有 `WeakMap`/`WeakSet` 持有 cleanup 与 disposed 状态。销毁先对 `client:` flush IndexedDB 写入（普通容器无副作用），再标记 `closed`，随后只 detach 当前 Unified logical stream、注销 `client:` scheduler、清 timer/queue/frame、运行 cleanup、dispose Ghostty 和移除 DOM；单个和批量销毁共用同一顺序。
- `global-runtime.js` 只提供 Ghostty/DOM resource factory 和各责任域 lifecycle adapter，通过公开 controller 执行 `create()`、`addCleanup()`、`dispose()` 和 `disposeAll()`；不再维护 `nextPaneSeq`、巨大状态字面量、cleanup 数组、pane 字段或 pane 销毁顺序。
- `terminal_session_controller_test.mjs` 覆盖状态隔离、显式 pane ID 推进、初始尺寸、workspace generation、`closed` 先于 logical detach、幂等销毁、迟到 cleanup 和兄弟 session 不受影响，并由 `TestTerminalSessionControllerBehavior` 纳入 Go 全量入口；`TestRuntimeTerminalSessionModuleBoundary` 固定公开入口、文件职责、版本化静态资源和禁止物理连接/历史算法侵入 lifecycle。

### 2026-08-30：静态根目录独立模块归档

- 已建立 `workspace/`、`terminal/history/`、`terminal/transport/`、`terminal/rendering/`、`terminal/resize/`、`terminal/overview/`、`terminal/screenshot/`、`terminal/input/ime/` 和 `terminal/tui_adapters/` 的目录说明与公开入口。
- 原静态根目录的现有独立实现文件仅做路径移动；算法、状态字段、listener、timer、socket 和调用顺序均未重构。`global-runtime.js` 改为从模块公开入口导入，session state 也只依赖 history/rendering/resize 公开入口。
- fullscreen TUI 按 `common/claude/opencode/herdr/pi` 分目录；通用层继续禁止工具身份判断，各工具专用事件所有权保持隔离。
- `themes.json` 已归入 `appearance/`，iOS 经典宿主脚本已归入 `terminal/input/ime/`；HTML、Service Worker、行为测试、Go 路径 guard 和当前架构文档同步更新。
- 该批只完成静态文件归档，不表示 transport、history、rendering、resize、overview、workspace 或 input controller/lifecycle 已迁出原入口实现。

### 2026-08-30：`terminal/overview/`

- 已建立完整的 `overview_controller.js`、`overview_view.js` 和 `overview_lifecycle.js`，并统一从 `terminal/overview/index.js` 公开。
- 总览打开状态、render/focus RAF、拖拽/长按/placeholder/自动滚动、重排 timer、移动端双侧边缘手势和浏览器历史 guard 已从原入口实现迁出。
- controller 只读取注入的 tab/pane 视图，并通过新建、激活、关闭、移动标签命令协调工作区；不拥有 tab registry、布局树、Ghostty、WebSocket、history cursor、resize 或输入状态。
- view 独占总览 DOM 查询、卡片构建、响应式网格和分屏 Canvas 绘制；lifecycle 独占永久与临时 listener。dispose 会取消 RAF、timer、拖拽和迟到回调。
- preview 只允许复制已提交 live Canvas 或有效 hold frame；未激活且从未呈现的 pane 使用空缩略图，不读取 Cache API/IndexedDB，也不进入终端恢复或 input ready。
- `terminal_overview_controller_test.mjs` 和 `TestRuntimeTerminalOverviewModuleBoundary` 固定行为、资源清理、公开入口、版本化静态资源和禁止逻辑回流 `global-runtime.js`。

### 2026-08-30：`terminal/interaction/` 上下文菜单子域

- 已建立 `context_menu_controller.js`、`context_menu_view.js`、`interaction_lifecycle.js`、公开 `index.js` 和目录 README。
- 桌面右键菜单、移动操作菜单、context target、动作可用性/分派、350ms 移动菜单误点击门禁和 1400ms 触摸合成菜单抑制窗口已从原入口实现迁出。
- pane/tab 菜单 listener 由 lifecycle 动态注册；pane cleanup 进入 terminal session lifecycle，tab 按钮重建与删除会立即注销旧 listener，模块 dispose 统一清理永久和动态资源。
- pane 菜单目标通过 getter 在事件发生时读取当前 `session.tabId`，避免 pane 跨 tab 后继续操作旧 tab；Claude fullscreen 专用右键适配器仍保持在通用 mouse tracking 之前。
- `global-runtime.js` 只注入只读工作区查询、选择/链接读取和复制、粘贴、搜索、截图、分屏、移动、关闭、主题等显式命令；选择、剪贴板、链接和 mouse protocol 已分别由公开 controller 接管，根 runtime 不保留对应实现。
- `terminal_context_menu_controller_test.mjs` 和 `TestRuntimeTerminalInteractionModuleBoundary` 固定动作、触摸抑制、误点击门禁、动态目标、listener 清理、公开入口、Service Worker 资源和禁止实现回流 `global-runtime.js`。

### 2026-08-30：`terminal/interaction/` 搜索子域

- 已新增 `search_controller.js`、`search_view.js`、`search_lifecycle.js`、`search_model.js` 和 `terminal_text_model.js`，并统一由 `terminal/interaction/index.js` 公开。
- 搜索 controller 独占面板打开状态、query、matches、当前 index 和搜索 session ID；view 独占 6 个搜索 DOM；lifecycle 独占 input/keydown/按钮 listener 与延迟聚焦 timer。
- 终端物理行到逻辑行、字符到 cell 坐标映射、完整缓冲区文本和绝对行查询已迁入无状态文本模型，当前由搜索、链接和仍在迁移中的选择代码复用。
- `global-runtime.js` 只创建搜索 controller，注入活动 session、选区文本、菜单关闭、附件布局刷新、终端焦点和 toast，并通过公开 API 处理快捷键、移动菜单和选择工具栏命令。
- `terminal_search_controller_test.mjs` 与 `TestRuntimeTerminalInteractionModuleBoundary` 固定实际 Ghostty 形态的逻辑行、大小写不敏感匹配、结果循环、选区 query、listener/timer 清理、公开入口和 Service Worker 资源。

### 2026-08-30：`terminal/interaction/` 剪贴板子域

- 已新增 `clipboard_controller.js`、`clipboard_adapter.js` 和 `clipboard_lifecycle.js`，统一从 `terminal/interaction/index.js` 公开。
- controller 独占选择文本解释、复制/粘贴命令、bracketed paste、桌面拖选状态、中键粘贴和迟到 Clipboard Promise guard；adapter 独占浏览器 Clipboard API、权限错误与 textarea fallback；lifecycle 独占动态 mouse listener。
- 桌面 session 通过 `bindDesktopSession()` 返回 cleanup 并交给 terminal session lifecycle；pane 关闭或应用 dispose 后，listener 被移除，迟到 clipboard read 不得再调用输入发送。
- `global-runtime.js` 只注入活动 session、输入发送、选择 UI、设置只读 getter、pane 激活、尺寸重申和 selection manager 准备命令，并把上下文菜单、快捷键、IME paste、附件和诊断复制接到公开 API。
- `terminal_clipboard_controller_test.mjs` 与静态边界 guard 固定 Clipboard API/fallback、权限错误、普通/bracketed paste、完整缓冲区复制、拖选复制、中键粘贴、cleanup 和迟到异步拒绝。

### 2026-08-30：`terminal/interaction/` 链接子域

- 已新增 `link_controller.js` 和 `link_model.js`，统一从 `terminal/interaction/index.js` 公开。
- URL scheme 匹配、尾部标点剥离、逻辑行到 cell 坐标映射、指针命中、浏览器安全打开参数和链接复制反馈已从原入口实现迁出。
- 服务转发入口、上下文菜单选区链接和 pane 指针链接共用同一个 controller；`global-runtime.js` 只注入 Clipboard 命令和 toast，并调用公开 API。
- controller 不持有 selection、Ghostty、mouse protocol、transport、history、resize 或 presentation 状态；dispose 后迟到复制结果不得显示反馈或继续操作。
- `terminal_link_controller_test.mjs` 与静态边界 guard 固定普通/跨物理换行 URL、尾部标点、cell 命中、`_blank/noopener/noreferrer`、复制反馈、dispose generation、公开入口和 Service Worker 资源。

### 2026-08-30：`terminal/selection/`

- 已建立 `runtime/static/terminal/selection/`，包含独立 README、公开入口、controller、model、DOM view 和 lifecycle。
- Ghostty selection manager 的复制/双击补丁、cell/range/text 算法、完整缓冲区选择、移动工具栏/overlay/handle、长按选择、拖动调整和边缘自动滚动已从原入口实现迁出。
- 完整缓冲区选择改由 controller 私有 `WeakSet` 持有，不再写入共享 terminal session；剪贴板和上下文菜单只通过显式 getter/command 与选择模块协作。
- view 独占选择 DOM 和 point-to-cell 几何适配；lifecycle 独占永久/session listener、timeout、interval 与 disposable，pane 关闭或模块 dispose 后迟到回调不能继续修改选择。
- `global-runtime.js` 只在 session 安装顺序、resize/viewport 通知、TUI adapter 回调、mouse protocol cell 查询、快捷键和 history reset 边界调用公开 API；input focus -> 默认选择 -> 工具专用 adapter -> 通用 mouse tracking 的顺序保持不变。
- `terminal_selection_controller_test.mjs` 与 `TestRuntimeTerminalSelectionModuleBoundary` 固定纯算法、私有状态、manager patch、移动生命周期、工具栏动作、公开入口、Service Worker 资源和禁止 transport/history/resize 侵入。
- `debug123` 真实 PTY 回归固定桌面双击、完整缓冲区、移动长按、双手柄和复制；静态 guard 同时禁止 `main.js` 遗留已迁出的 `syncMobileMenuSelectionState()` 或依赖已删除的共享 `primaryTouch()` helper。

### 2026-08-30：`terminal/mouse/`

- 已建立 `runtime/static/terminal/mouse/`，包含独立 README、单一公开入口、controller、纯协议 model 和 session lifecycle。
- Ghostty mouse mode、Legacy/SGR 编码、button/modifier 解释、桌面与触摸 mouse listener、move 去重、本地 TUI 事件认领和延迟触摸点击/双击键盘兼容状态已从原入口实现迁出。
- controller 私有 `WeakSet` 持有工具 adapter 已认领事件；Claude/opencode/herdr/pi adapter 只调用公开 `hasTracking()`、`claimEvent()`、`sendWheel()` 和 `sendClick()`，不再复制 mouse 编码。
- 工具身份仍由调用方或 `terminal/tui_adapters/` 注入，通用 mouse controller 不包含任何工具名判断；输入发送、尺寸重申、selection 清除和同步键盘请求均为显式命令依赖。
- `terminal_mouse_controller_test.mjs` 与 `TestRuntimeTerminalMouseTrackingSequences` 固定 Legacy/SGR、document 拖动、touch press/move/release、事件认领、延迟 wheel/双击键盘、listener 清理、公开入口和 Service Worker 资源。

### 2026-08-30：`terminal/rendering/` renderer adapter

- 已新增 `renderer_adapter.js`，由 `terminal/rendering/index.js` 单一公开，独占字体基线与行高度量、estimated metrics、主题 RGB mapper、底部 viewport/scrollbar 归一化、cell seam、Powerline、块光标和 pixel-scroll fallback patch。
- `global-runtime.js` 只创建 adapter、注入字体/字号/行高 getter，并在 session/runtime 生命周期调用 `installSession()`、`syncRuntime()`、`captureViewport()`、`normalizeBottomViewport()` 和 `dispose()`；renderer patch 实现及旧裸 helper 已全部迁出。
- adapter 不拥有 history、replay、resize、presentation、transport 或工作区状态。底部 viewport API 只提供 renderer 机械适配，是否允许提交画面仍由 presentation gate 决定。
- `terminal_renderer_adapter_test.mjs`、`TestRuntimeTerminalRendererAdapterBoundary` 和既有 Canvas residue/line-height guard 固定公开入口、patch 幂等、主题/viewport/背景/Powerline/光标行为、Service Worker 资源以及禁止实现回流 `global-runtime.js`。
- `debug123` 真实浏览器回归覆盖版本化模块加载、连续背景、Powerline、Canvas 像素变化和单页单 Unified WebSocket；首次回归发现的 `isTerminalViewportAtBottom` 裸调用已改为 adapter 公开 viewport API，并加入静态回流 guard。

### 2026-08-30：`terminal/rendering/` presentation

- 已新增 `presentation_controller.js`、`presentation_state.js`、`presentation_view.js` 和 `presentation_lifecycle.js`，统一由 `terminal/rendering/index.js` 公开；render/presentation generation、RenderSnapshot、full-render gate、last-known-good frame、Canvas context 恢复、validation/retry/stall timer 和 RAF/listener 生命周期已从原入口实现迁出。
- controller 只读取注入的 replay/resize/visibility/geometry 门禁、resize 的 current-device claim required 和 viewport geometry claim pending 只读门禁，并通过显式回调请求 resize 或 transport 恢复；远端 owner observation 或 viewport 最终尺寸稳定提交前不得发送被动 geometry resize。不推进 history cursor、不发送 WebSocket、不声明 resize owner，也不修改输入或输出队列。
- view 独占 live/hold Canvas 与 shell dataset 适配。host viewport 清理必须保留 frame hold；抓帧前还会恢复意外脱离的模块自有 hold Canvas，确保 live backing store 变化前旧帧已经覆盖当前 pane。
- lifecycle 独占 presentation RAF、validation/retry timer、双 RAF frame release、Canvas context listener 和 Ghostty `onRender` disposable；session cleanup 与模块 dispose 后迟到回调不能继续提交画面。
- `terminal_presentation_controller_test.mjs`、`TestRuntimeTerminalCanvasResidueGuard`、`TestTerminalPresentationControllerBehavior` 和 `TestRuntimeTerminalPresentationModuleBoundary` 固定 replay/resize 中间帧不可见、资源恢复、完整提交、stall 恢复、公开入口和禁止实现回流。
- `debug123` 真实浏览器回归覆盖 resize、tab 切换和主题变化：live Canvas 尺寸变化前 hold 已完成复制，所有 pending resize 采样均有旧帧覆盖，API/console/page error 为零，单页只有一条 Unified WebSocket。

### 2026-08-30：`terminal/resize/`

- 已新增 `resize_controller.js`、`resize_lifecycle.js`、`geometry_state.js` 和 `viewport_controller.js`，并与既有 resize transaction、scheduler、size-sync 文件统一从 `terminal/resize/index.js` 公开。
- requested/applied epoch、ACK fence、输出 settle、跨设备 owner observation、DOM fit、viewport snapshot、ResizeObserver、Ghostty resize disposable、RAF 和 timer 已从原入口实现迁出。
- 稳定几何下的重复 fit 走 presentation-neutral fast path；同设备已成功 claim 时，pointer/focus/mouse 的重复 claim 和相同 in-flight target 都会去重，presentation 的迟到字体/行高 geometry 修正通过 `schedulePresentationResize()` 继承当前 claim。远端新 epoch 或 owner release 只标记下一次明确交互重新 claim，并通过 `isCurrentDeviceClaimRequired()` 阻止 presentation 被动反抢，不会因相同几何自动触发呈现抖动。
- ACK 前继续冻结本地网格并有界排空旧几何输出；ACK 后独立 settle。远端 observation 不自动 reclaim，单 pane resize 错误不关闭 Unified 物理连接，任何 resize 路径都不触发历史 replay 或展示中间帧。
- `terminal_resize_controller_test.mjs` 覆盖稳定几何、ACK fence 和 claim 去重；scheduler/size-sync guard、`tests-auto/08-terminal-click-jitter/test.mjs` 和 `debug123` 原子呈现回归固定状态所有权、迟到资源清理、单页单 Unified 连接及 hold 覆盖。

### 2026-08-30：`terminal/input/` 输入队列子域

- 已新增 `input_controller.js`、`input_lifecycle.js` 和 `input_model.js`，统一从 `terminal/input/index.js` 公开。
- pending/input queue、Unicode 安全分块、字节预算、WebSocket 背压、lease/generation 过期、generated response 分类与抑制、server revision 输入锁、三个 timer 和 Ghostty `onData` disposable 已从原入口实现迁出。
- controller 只通过注入接口读取 replay、socket、lease、resize 和主题状态；普通输入携带当前已应用网格，generated payload 明确标记 `generated: true` 且不携带网格。输入发送不依赖 Canvas `renderReady`，单 pane 失败只请求该 logical stream 恢复。
- lifecycle 在 session 解绑后同时检查私有绑定集合，拒绝已经排队但迟到执行的 `onData` callback；pane close 与模块 dispose 会统一清 timer、queue、listener 和输入锁。
- `terminal_input_controller_test.mjs`、Go 模块边界 guard 和 `debug123` 真实环境回归覆盖普通输入、Enter/Ctrl-C、20 KiB 粘贴、DSR generated response、Canvas 更新、版本化资源和每页单 Unified 连接。

### 2026-08-30：`terminal/input/ime/`

- 已新增 `ime_controller.js`、`ime_lifecycle.js` 和 `ime_model.js`，并由 `terminal/input/index.js` 统一公开；`ios_terminal_host.js` 保持 HTML 直接加载的经典宿主脚本。
- helper textarea 几何与 sentinel、composition/preedit、post-composition 去重、ASCII separator 抑制、Android native delete、paste 去重、focus allowance、同步双击、touch claim、host contenteditable 隔离及对应 listener/timer/RAF 已从原入口实现迁出。
- controller 只通过注入接口调用输入队列、clipboard、resize 和 viewport；同步双击 focus 保持在 capture `touchend` 用户手势内，system focus 不抢移动键盘，pane close/dispose 后迟到 callback 不能发送输入。
- `terminal_ime_controller_test.mjs` 和 Go runtime guard 覆盖模型、幂等安装、composition、连续 Backspace、paste、Android focus transaction、同步双击、单击 blur、DOM 白名单和生命周期清理。

### 2026-08-30：`terminal/viewport/`

- 已新增 `viewport_controller.js`、`viewport_lifecycle.js` 和 `viewport_model.js`，统一从 `terminal/viewport/index.js` 公开。
- visualViewport 高度/参考高度、iOS 键盘 inset、Android/客户端底部安全偏移、resize suppression、光标 pan、input viewport lock、方向恢复 generation、缩放拦截及其 listener/timer/RAF 已从原入口实现迁出。
- controller 只通过注入命令协调 resize、IME DOM、selection、overview、移动菜单和标题，并向 presentation 提供 `isGeometryClaimPending()` 只读门禁；不读取 transport/history/cache，不建立或关闭 WebSocket，也不触发 replay/reset。方向和键盘变化只复用当前 Ghostty 内存状态并请求合法 resize/final render。
- lifecycle 独占 window/document touch/gesture、window/visualViewport resize/scroll、orientation listener 和全部恢复资源；重复 `start()` 幂等，dispose 后迟到 callback 不得修改 viewport、session 或 Canvas。
- `terminal_viewport_controller_test.mjs` 5 项与 `TestRuntimeTerminalViewportModuleBoundary` 固定 iOS 键盘、Android safe offset、input lock 重基准、cursor pan、方向恢复、资源清理、Service Worker 资源和禁止实现回流 `global-runtime.js`。

### 2026-08-30：`terminal/output/`

- 已新增 `output_controller.js`、`output_lifecycle.js` 和 `output_model.js`，统一从 `terminal/output/index.js` 公开。
- output queue、queue generation、queued bytes、replay/live/suppressed 分类、有界 byte/entry/time drain、过载 history resync 和 Queue turn ACK 已从原入口实现迁出。
- resize 只通过 `getQueueEntryCount()`、`getQueuedBytes()`、`flush()` 和 `scheduleFlush()` 协作，不再读取或修改 `session.outputQueue*`；transport 只提交已校验 payload 和 turn boundary，history 通过显式 callback 接收 cursor/cache commit。
- output lifecycle 独占 RAF/timeout，session dispose 会递增 generation 并清空队列和 pending ACK；旧 connection epoch、channel generation、selector/pane/history generation 的条目不能写入当前 Ghostty。
- `terminal_output_controller_test.mjs`、`TestTerminalOutputControllerBehavior` 和 `TestRuntimeTerminalOutputModuleBoundary` 覆盖 Unicode/UTF-8 分片、字节顺序、bounded drain、stale generation、overload resync、Queue ACK 和资源清理；`tests-auto/05-terminal-output` 覆盖真实大输出、隐藏 tab、resize、Canvas 原子呈现、版本化资源和单 Unified 连接。

### 2026-08-31：`terminal/history/` 服务端 replay 与 `client:` IndexedDB 兼容

- 当前文件为 `terminal_replay_controller.js`、`session_replay_controller.js`、`session_replay_lifecycle.js`、`session_replay_state.js`、`client_terminal_replay.js`、`client_history_controller.js`、`terminal_history_cache.js` 和 `terminal_checkpoint.js`，统一从 `terminal/history/index.js` 公开。
- 普通容器只维护服务端 replay identity、cursor、sequence、authorization、checkpoint 和最终 commit transaction；不创建浏览器本地 history identity、manifest、chunk、preview、compaction 或 warm replay。
- `client_history_controller.js` 独占 `client:` IndexedDB load/reset/write/flush/touch/delete 及其 timer/Promise generation。`session_replay_controller.js` 只有在 `isClientTarget(session.name)` 成立时才允许 flush 浏览器历史。
- transport 负责 envelope/checksum 校验并把权威 snapshot/live 字节交给 history/output；snapshot reset 必须处于 render suppression，replay commit 前禁止任何 Canvas 提交。
- `terminal_session_replay_controller_test.mjs`、`terminal_session_protocol_controller_test.mjs`、`client_terminal_history_controller_test.mjs`、`terminal_replay_controller_test.mjs`、`terminal_checkpoint_test.mjs` 和 `TestRuntimeSnapshotOnlyAndPWARemovalContract` 固定普通容器无本地 range/存储副作用、`client:` 兼容范围、迟到 generation 拒绝和中间帧不可见。

### 2026-08-30：`terminal/transport/` session、logical/direct runtime 与 Unified 物理 owner

- 已新增 `session_connection_controller.js`、`session_connection_lifecycle.js`、`transport_runtime_controller.js`、`transport_runtime_lifecycle.js` 和 `unified_transport_controller.js`，统一由 `terminal/transport/index.js` 公开。
- `websocket_url.js` 和 `theme_controller.js` 已加入同一公开入口，分别负责页面 endpoint 的 `ws:`/`wss:` 转换/协议校验、Unified transport query 构造，以及使用 appearance payload 向已打开 socket 发送主题；应用控制器不再实现 URL 解析、Unified 协议参数拼接或主题 JSON 发送。
- pane connect/health/attach-ready/resume/reconnect timer、direct/unified 失败分流、logical membership/可视优先级/pane retry、`client:` demand generation/三直连 lease，以及页面唯一 Unified 物理 connection、target、close fence、watchdog 和恢复任务已从原入口实现迁出。
- `global-runtime.js` 只注入当前 target/tab/session 只读视图、URL/stream 建立、resize 测量、workspace reconnect、输入 expiry 和诊断命令；priority/retry timer、measurement RAF 和 sync microtask 均由 transport lifecycle 清理。异常断线建立的 close fence 在旧 socket 真正关闭或 fence 超时前不得被恢复任务清除。
- `terminal_session_connection_controller_test.mjs`、`terminal_transport_runtime_controller_test.mjs`、`terminal_unified_transport_controller_test.mjs` 和 `TestRuntimeTerminalConnectionSchedulerGuard` 固定迟到 timer/RAF、三直连上限、后台 tab 停放、单 pane logical 恢复、目标切换、异常断线 close fence、单物理连接、公开入口、Service Worker 资源和禁止实现回流。
- `terminal_theme_controller_test.mjs` 额外固定主题 socket OPEN 校验、payload 序列化和 dispose fence。

## 不可破坏的架构边界

以下边界来自 `docs/FIX_HISTORY.md`，任何模块迁移都必须继续成立：

1. 普通容器页面只有一条 Unified 物理终端 WebSocket；全部 pane 是独立 logical stream。tab 切换、聚焦、输入和 resize 只能更新逻辑状态，不得关闭物理连接。
2. `client:` target 继续使用最多三条独立直连和隔离的 IndexedDB 兼容历史，不能未经协议升级套用容器 Unified 假设。
3. persistent agent 的原始 PTY 字节是普通容器终端历史权威；浏览器 Canvas、缩略图和本地存储都不是会话权威。
4. 历史、断线恢复和 resize 中间过程不得显示。历史字节必须完整解析，只有 replay commit、实时队列追平、合法几何和最终 full render 成功后才能提交画面。
5. 已经呈现且身份仍有效的 last-known-good frame 在网络错误、502、重连和 snapshot 等待期间必须保留。
6. resize 必须保持 requested、applied、presented 三阶段及 epoch/owner 边界。ACK 前不得切换本地网格，远端尺寸观察不得自动变成本机 claim。
7. 用户输入、generated response、IME composition、输入锁和 replay 抑制属于同一条有序链，但 Canvas 是否可见不得阻塞已经合法连接的普通输入。
8. 普通容器不得查询或发送浏览器本地 history range，不得创建 Cache API 历史；`client:` IndexedDB 路径必须由 target guard 完整隔离。
9. 单 pane 的身份、cursor、sequence、checksum、resize 或 replay 错误不得关闭其他 logical stream 或 Unified 物理连接。
10. 模块移动后仍必须通过版本化相对 import、HTTP 静态资源契约和 LPK 打包校验。

## 目标入口

最终的 `global-runtime.js` 只保留类似以下职责：

```js
import { startGlobalRuntime } from "./global-runtime.js";

startGlobalRuntime();
```

全局状态、启动失败展示、全局事件绑定、页面恢复和销毁顺序由 `global-runtime.js` 统一编排；可复用的局部 listener/资源清理由各模块自己的 `*_lifecycle.js` 负责。

## 状态所有权

| 状态域 | 唯一 owner | 典型状态 | 允许的跨模块交互 |
| --- | --- | --- | --- |
| 全局运行时 | `global-runtime.js` | feature controller 实例、全局 started/disposed、active target/generation、启动/恢复/销毁顺序 | 通过各模块公开 API 和只读快照编排；不复制模块内部状态 |
| 应用生命周期工具 | `app/app_lifecycle.js` | 页面显隐、online/offline listener、局部 heartbeat 和 listener generation | 由 `global-runtime.js` 注入 handlers 并调用 `start/dispose` |
| 应用恢复事务 | `app/runtime_recovery_controller.js`、`app/runtime_recovery_lifecycle.js` | resume generation、前台信号合并、2 秒恢复 deadline、网络恢复 close fence 和灰/红状态边界 | 只调用 transport/session/resize 的公开命令；不拥有终端协议、回放或 Canvas 状态 |
| 应用快捷键 | `app/shortcuts/shortcut_controller.js`、`app/shortcuts/shortcut_lifecycle.js` | 动作路由、快捷键过滤、全屏命令生命周期 | 调用注入的 tab、设置、附件和终端公开命令 |
| 对话框 | `app/dialog_controller.js` | confirm/prompt resolver、移动关闭 sheet、焦点与 Escape | 发布用户意图结果；调用方执行具体业务操作 |
| 工作区 | `workspace/target_controller.js`、`workspace/target_lifecycle.js`、`workspace/workspace_api.js`、`workspace/persistence_controller.js`、`workspace/refresh_controller.js`、`workspace/state_apply_controller.js`、`workspace/tab_registry.js`、`workspace/tab_controller.js`、`workspace/tab_view.js`、`workspace/tab_activation_controller.js`、`workspace/tab_label_controller.js`、`workspace/tab_navigation_controller.js`、`workspace/activity_controller.js`、`workspace/layout_controller.js` | active selector/generation、Provider 请求、restore/活动 tab 持久化、refresh/retry、权威 apply、tab registry/CRUD/DOM/激活、标签标题/rename、最近 tab/顺序导航、activity、布局算法 | 发布只读 workspace snapshot 和用户 action，不接管终端协议 |
| 终端 session | `terminal/session/session_controller.js` | session identity、子控制器引用、统一 cleanup | 组合各子模块，不直接实现协议或渲染算法 |
| 物理与逻辑连接 | `terminal/transport/unified_transport_controller.js`、`transport_runtime_controller.js` | Unified socket、client leases、stream/channel generation、重试 | 输出已验证的控制帧和二进制帧；普通 logical retry 只能派生灰点 |
| 历史回放 | `terminal/history/replay_controller.js` | history generation、cursor、replay phase、authorization | 请求 render suppression、提交已验证字节 |
| 输出流水线 | `terminal/output/output_controller.js` | output queue、queue generation、drain budget、turn ACK | 向终端运行时按序写入，不拥有 WebSocket |
| `client:` 历史兼容 | `terminal/history/client_history_controller.js` | IndexedDB snapshot、persisted cursor、写入队列与 timer | 仅接受 `client:` session；普通容器调用无副作用 |
| resize | `terminal/resize/resize_controller.js` | requested/applied/presented epoch、fence、settle、owner observation、pending current-device claim | 向 transport 发控制，向 rendering 提交几何变更；普通在途 resize 不得吞掉显式 claim |
| 浏览器 viewport | `terminal/viewport/viewport_controller.js` | layout/visual viewport signature、DPR/方向 generation、键盘 inset、安全偏移、resize suppression、input viewport lock | 稳定后向 resize 发布当前设备 claim，不读取历史或连接状态 |
| 渲染与呈现 | `terminal/rendering/presentation_controller.js` | render generation、RenderSnapshot、hold frame、presentation gate | 只消费当前终端状态，不决定 history/transport 权威 |
| 总览缩略图 | `terminal/overview/preview_controller.js`、`preview_store.js` | capture/load generation、decoded image、IndexedDB 图片 Blob、过期与容量 | 只接收已提交 Canvas；不保存 PTY/cursor，不参与 replay/ready |
| 输入与 IME | `terminal/input/input_controller.js`、`terminal/input/ime/ime_controller.js` | input lock、pending queue、composition、helper textarea、generated response | 向 transport 发送已分类输入，不修改连接生命周期 |
| 终端上下文菜单 | `terminal/interaction/context_menu_controller.js` | desktop/mobile target、动作可用性、触摸菜单抑制、移动菜单点击门禁 | 读取 tab/pane/selection 快照并调用显式命令，不修改工作区或终端权威状态 |
| 主题外观 | `appearance/appearance_controller.js` | theme catalog、active theme、持久化、picker/settings theme DOM、timer/RAF/listener generation | 发布主题副本；rendering 负责应用到 Ghostty，不进入 replay |
| 设置 | `settings/settings_controller.js` | 服务端 snapshot、本地偏好、PATCH 队列、字体/快捷键编辑状态、timer 和请求 generation | 通过只读 getter 与显式回调协调 appearance、diagnostics、devices 和终端适配 |
| 诊断 | `diagnostics/diagnostics_controller.js`、`diagnostics/terminal_timeline.js` | debug mode、日志、性能和网络监控开关、终端/页面运行时 trace 与 resume generation | 订阅只读事件，不成为业务状态来源；trace 不得驱动业务调度 |
| 设备在线状态 | `devices/devices_controller.js` | 心跳开关与请求、短 TTL 列表视图、面板、timer 和 generation | 接收调试/页面生命周期信号，不接管账号或终端状态 |
| 实例发现与切换器 | `instances/instances_controller.js` | 实例列表 snapshot、切换器、列表请求应用 generation、首页导航资源 | 读取活动 selector，向工作区发出切换命令，不接管工作区状态 |

一项状态只能由一个 owner 修改。其他模块若需要观察，使用只读 snapshot、显式命令或事件；禁止继续共享并任意修改一个超大 session 对象。

## 建议目录

```text
runtime/static/
├── main.js
├── global-runtime.js
├── app/
│   ├── README.md
│   ├── index.js
│   ├── app_lifecycle.js
│   ├── bootstrap.js
│   ├── dom_registry.js
│   └── shortcuts/
├── workspace/
│   ├── README.md
│   ├── index.js
│   ├── workspace_controller.js
│   ├── workspace_api.js
│   ├── workspace_restore.js
│   ├── tab_controller.js
│   └── layout_controller.js
├── terminal/
│   ├── README.md
│   ├── session/
│   ├── transport/
│   ├── history/
│   ├── output/
│   ├── rendering/
│   ├── resize/
│   ├── input/
│   ├── interaction/
│   ├── tui_adapters/
│   ├── overview/
│   └── screenshot/
├── settings/
├── appearance/
├── diagnostics/
├── instances/
├── devices/
├── attachments/
├── service_forwarding/
└── shared/
```

每个目录都需要自己的 `README.md`。`shared/` 只允许纯函数和无状态浏览器兼容适配，不能成为新的杂物目录。

## 可整理模块清单

### 1. 应用入口与全局生命周期

- 当前位置：`runtime/static/main.js`（仅入口）与 `runtime/static/global-runtime.js` 的 bootstrap、全局 listener、online/offline、visibility、pageshow/pagehide、beforeunload 和 dispose。
- 目标文件：`runtime/static/global-runtime.js`；它与 `main.js` 同级，是唯一的全局状态和全局运行时编排 owner。
- 局部生命周期工具：`app/app_lifecycle.js`。
- 职责：在 `global-runtime.js` 中声明全局状态、创建 feature controller、串联启动/恢复/销毁依赖、处理页面级恢复与销毁、汇总致命启动错误。
- 不负责：工作区业务、终端协议、设置实现或具体 DOM 事件逻辑。

`app/app_lifecycle.js` 只提供可复用的页面 listener/局部资源工具；它不能拥有根应用的 controller 创建顺序或跨模块销毁顺序。新的业务实现必须进入对应 feature 目录，`global-runtime.js` 只保留显式接线和全局生命周期调用。

### 2. DOM 注册与页面外壳

- 当前位置：原入口实现的 DOM 注册代码的大量 `getElementById()` 和 `querySelectorAll()`。
- 目标目录：`app/`，由 `dom_registry.js` 一次校验并返回按模块分组的只读 DOM 引用。
- 边界：模块只接收自己需要的 DOM 子集，不能持有整个页面 DOM registry。

### 3. 实例发现、切换与导航

- 状态：已完成迁移，当前位置为 `runtime/static/instances/`。
- 文件：`instances_controller.js`、`instances_loader.js`、`instances_model.js`、`instances_view.js`、`instances_navigation.js`、`instances_lifecycle.js` 和公开 `index.js`。
- 状态 owner：controller 持有实例列表、切换器和公开加载应用 generation；loader 与 navigation 分别持有各自请求 flight、retry/cache 和 AbortController。
- 过渡边界：active selector 和 generation 由 `workspace/target_controller.js` 持有；实例模块通过 `getActiveName()` 只读观察，通过 `onSwitchTarget()` 发出用户命令。
- 权限边界：账号可见性仍由 Provider/Admin 权威决定，浏览器不推断实例权限，也不直接访问 Admin 或客户端服务凭据。

### 4. 工作区、tab、pane 与布局

- 状态：workspace target/generation、workspace API、restore/active-tab persistence、refresh/retry、权威 state apply、布局算法/DOM、tab activation controller/scheduler、registry、activity、tab label/inline rename、tab navigation/recent persistence 和完整 tab/pane CRUD 已迁移；Ghostty/DOM 资源工厂和全局启动编排按约定保留在 `global-runtime.js`，不作为 workspace 业务实现。
- 当前目录：`workspace/`，外部只能从公开 `index.js` 导入。
- 已有文件：`target_controller.js`、`target_lifecycle.js`、`workspace_api.js`、`persistence_controller.js`、`refresh_controller.js`、`refresh_lifecycle.js`、`state_apply_controller.js`、`state_apply_lifecycle.js`、`layout_controller.js`、`layout_view_controller.js`、`tab_activation_controller.js`、`tab_activation_scheduler.js`、`tab_registry.js`、`activity_controller.js`、`tab_label_controller.js`、`tab_label_lifecycle.js`、`tab_navigation_controller.js`、`tab_controller.js`、`tab_view.js`、`tab_lifecycle.js`。
- 状态 owner：target lifecycle/controller 独占 active selector、generation、目标变更通知和切换事务；workspace API 独占请求适配与 selector 响应边界；persistence controller 独占 restore suppression 与 active-tab Promise chain；refresh 独占 recovery metrics/retry；state apply 独占 applying 与 apply RAF；registry 独占 tab Map/ID/active snapshot；tab navigation 独占最近 tab；tab label 独占 inline rename；tab controller/view/lifecycle 分别独占 CRUD 编排、tab DOM 与资源清理；tab activation controller/scheduler 独占保帧、视觉提交和 latest-only 分阶段激活；activity 独占轮询/timer；布局 controller/view 独占算法和 DOM。
- 边界：工作区模块只管理业务身份和布局，不直接操作 WebSocket、历史 cursor 或 Ghostty 内部状态。

### 5. 终端 session 模型与生命周期

- 状态：已完成首批迁移，当前位置为 `runtime/static/terminal/session/`。
- 文件：`session_controller.js`、`session_state.js`、`session_lifecycle.js` 和公开 `index.js`。
- 状态 owner：controller 持有 pane ID 序列并组合 state/lifecycle；lifecycle 私有持有 cleanup 与 disposed 状态；state 为每个 pane 创建独立数组、Promise 和子控制器。
- 过渡边界：session state 仍保留各责任域需要的扁平字段以兼容现有协议，但 connection、replay、cache、input、output、resize、presentation 和 activity 的算法与生命周期均由对应 feature owner 实现；不得在 session controller 或 global runtime 中复制这些算法。
- 资源边界：Ghostty/DOM 创建与现有事件 adapter 暂留 `global-runtime.js` 的显式 resource factory；session lifecycle 只通过注入 adapter 清理资源，不读取应用全局状态。
- 销毁边界：先 flush，再设置 `closed`，然后只 detach 当前 logical stream；不得关闭 Unified 物理连接或修改兄弟 session。迟到 cleanup 必须立即执行，重复 dispose 必须无副作用。
- 局部编排边界：`session_installation_controller.js` 接收 rendering 的 ready 信号，负责 flush pending input、记录恢复指标和清理 Unified retry；这些副作用不得回流 `global-runtime.js`。

### 6. WebSocket 与连接生命周期

- 当前位置：`terminal/transport/` 的 connection/protocol controller，以及 `global-runtime.js` 的公开 API 接线。
- 当前目录：`terminal/transport/`；连接 controller、协议路由和生命周期编排已迁出，`session_protocol_controller.js` 通过显式依赖接收跨域协议命令。
- 已归档文件：
  - `terminal_unified_connection.js`
- `terminal_unified_membership.js`
- `websocket_url.js`
  - `terminal_unified_health.js`
  - `terminal_queue_connection.js`
  - `terminal_connection_scheduler.js`
  - `terminal_fast_integrity.js`
- 当前文件：`session_connection_controller.js`、`session_connection_lifecycle.js`、`session_protocol_controller.js`、`transport_runtime_controller.js`、`transport_runtime_lifecycle.js`、`unified_transport_controller.js` 及既有协议适配文件。
- 状态 owner：`unified_transport_controller.js` 独占页面级 Unified 物理 socket/close fence；`transport_runtime_controller.js` 独占 logical stream、client lease、channel generation 和重试；session connection/protocol controller 独占 pane 健康与消息路由。
- 协议序列化边界：session connection lifecycle 独占默认 ping JSON serializer；resize controller、input controller 和 output controller 分别独占 resize/input/Queue ACK 默认 serializer。根 runtime 只提供 controller 实例和恢复回调，不直接调用 `socket.send(JSON.stringify(...))`。
- 边界：协议路由校验后才把消息交给 history/resize/output；单 pane 错误不能直接关闭 Unified socket。

### 7. 历史协议、回放与 checkpoint

- 状态：已完成迁移，原入口中的 replay、checkpoint、身份校验和 commit transaction 已归档到 `terminal/history/`，根 runtime 只注入公开命令和生命周期依赖。
- 当前目录：`terminal/history/`；`session_replay_controller.js`、`session_replay_lifecycle.js`、`session_replay_state.js` 和 replay/checkpoint 原语维护普通容器协议状态与 checkpoint；`client_history_controller.js`、`terminal_history_cache.js` 仅维护 `client:` IndexedDB 兼容历史。
- 状态 owner：history generation、base/received/applied/presented cursor、replay request、authorization 和 commit phase 由 history controller 独占；Canvas presentation 仍由 rendering/presentation owner 提交。
- 边界：Fast/Unified envelope 的解析和 checksum 校验归 transport protocol；history 只接收通过传输校验的身份、sequence、cursor 和 payload。replay 可以请求 rendering suppression，但不得直接管理 Canvas；历史过程永远不可见。

### 8. 浏览器历史兼容与旧存储清理

- 普通容器没有浏览器 PTY 历史缓存；服务端 snapshot/live 是唯一终端状态恢复路径。总览模块可持久化独立图片 Blob，但该数据不能参与任何 history/cursor/Ghostty 恢复。
- `terminal/history/client_history_controller.js` 与 `terminal_history_cache.js` 仅为 `client:` 保留 IndexedDB 兼容能力，外部不得绕过 target guard 深度调用 store。
- `app/bootstrap/legacy_storage_cleanup_controller.js` 只精确注销旧 WebShell Worker 并删除已知旧 Cache 名称；它是迁移清理器，不是运行时缓存 owner。

### 2026-08-30：`terminal/transport/` session connection lifecycle

- 已新增 `session_connection_controller.js` 和 `session_connection_lifecycle.js`，统一从 `terminal/transport/index.js` 公开。
- pane 的 connect/health/attach-ready/resume-probe/reconnect timer、ping 健康检查、direct scheduler 失败通知和 Unified logical recycle 已从原入口实现迁出。
- lifecycle 按当前 socket、target、dispose 状态和 timer generation 拒绝迟到回调；服务端 replay 期间 attach timer 与可见性门禁必须保持一致，不能把已解析字节当作可见帧。
- Unified pane 失败只调用 logical recycle，不直接关闭页面级物理连接；direct `client:` pane 继续由三槽 scheduler 持有 lease 和 close fence。
- `terminal_session_connection_controller_test.mjs` 与 `TestRuntimeTerminalConnectionSchedulerGuard` 覆盖 timer 清理、stale socket、health timeout、服务端 replay、offline/direct/unified 分流和版本化静态资源。
- 边界：网络失败必须保留 last-known-good frame，不能显示 replay 中间 Canvas；单 pane 恢复不得关闭兄弟 stream。

### 9. 实时输出、批处理与背压

- 状态：已完成迁移，当前位置为 `terminal/output/`。
- 文件：`output_controller.js`、`output_lifecycle.js`、`output_model.js` 和公开 `index.js`。
- 状态 owner：controller 独占 output queue generation、queued bytes、flush budget、Queue turn ACK 和 overload resync；lifecycle 独占 RAF/timeout。
- 协议边界：Queue ACK 的 socket、Unified channel、connection epoch 和 channel generation 校验及 JSON 发送由 `output_controller.js` 默认 serializer 完成，根 runtime 不再注入实现。
- 边界：保持字节顺序；replay/live/suppressed 三类写入显式分类；Queue turn 和 resize 使用有界 drain，不建立或关闭 WebSocket，不决定历史身份或 Canvas presentation。

### 10. Ghostty 渲染适配与 presentation

- 状态：Ghostty renderer adapter 与 presentation/Canvas 编排均已完成迁移。
- 当前目录：`terminal/rendering/`；`renderer_adapter.js` 独占字体/行高度量、主题 RGB 映射、底部 viewport 归一化、cell seam、Powerline 和块光标 patch；`presentation_controller.js` 独占提交门禁和恢复编排；`presentation_view.js`、`presentation_lifecycle.js`、`presentation_state.js`、`kitty_graphics.js`、`terminal_render_snapshot.js` 与 `terminal_frame_release_scheduler.js` 维护各自职责。
- renderer adapter 状态 owner：只持有模块 dispose 状态，并通过注入 getter 读取字体、字号和行高；patch 状态跟随具体 Ghostty renderer/terminal 实例，不拥有 tab/pane registry、history、resize、transport 或 presentation generation。
- `global-runtime.js` 接线边界：只创建 renderer/presentation controller，注入现有 history、resize、transport 和工作区只读门禁，并在对应事件边界调用公开命令；不得保留 renderer patch、presentation 状态机、timer、RAF、Canvas listener 或 hold DOM 实现。
- presentation 状态 owner：`presentation_state.js` 定义 session 字段，`presentation_controller.js` 唯一修改 render/presentation generation、RenderSnapshot、frame hold 状态、full render validation 和 stall recovery；`presentation_lifecycle.js` 唯一维护相关资源生命周期。
- Ghostty 渲染边界：renderer 只物化并绘制已归一化 viewport，不反向修改 Terminal 状态；`Terminal.renderNow()` 在进入 renderer 前负责 viewport normalization。runtime suppression 按 reason 使用幂等集合，同一 reason 重复 begin 不增加底层 depth，未知 end 不得释放其他作用域。
- presentation-ready 边界：`presentation_controller.js` 只报告 ready 信号；pending input、恢复指标、startup trace 和 Unified retry reset 的跨模块副作用由 `terminal/session/session_installation_controller.js` 的 `handlePresentationReady()` 编排。
- 边界：不得决定历史或连接权威；只在完整可见 viewport 物化成功后提交；失败保留 last-known-good frame。

### 11. resize、几何与移动 viewport

- 状态：DOM 测量、resize 请求/ACK/fence/settle、跨设备 owner observation、显式 claim 升级、浏览器 viewport signature、移动 visualViewport/keyboard inset/input lock 编排和两类资源生命周期均已完成迁移。
- 当前目录：`terminal/resize/` 与 `terminal/viewport/`；外部只能从各自 `index.js` 导入。resize 的 `viewport_controller.js` 只保存 resize 前后的 Ghostty scroll viewport 机械快照，不是移动 visualViewport owner；移动页面状态由 `terminal/viewport/viewport_controller.js` 唯一维护。
- 公开 API：`createTerminalResizeController()` 提供尺寸读取、可测量判断、resize/claim/reassert、当前 pane/tab 设备接管、协议 ACK/error/owner 处理、输出 settle、tab 调度、session 安装和幂等销毁；既有 `TerminalResizeController`、scheduler 与 size-sync 继续作为模块内部使用的细粒度状态机和纯判断，并经公开入口导出供测试及受控调用。
- 状态 owner：`resize_controller.js` 唯一修改 requested/applied resize epoch、requested/server geometry、owner observation、ACK pending、fence、output settle、测量 generation 和 claim 状态；presented resize epoch 仍由 rendering/presentation 在最终 full render 成功后推进。
- viewport 状态 owner：`terminal/viewport/viewport_controller.js` 唯一修改 layout/visual viewport signature、DPR/方向 generation、pending geometry、visual viewport/reference height、keyboard inset、安全偏移、resize suppression 和 `session.inputViewportLock`；lifecycle 独占 touch/gesture、window/visualViewport/orientation listener、timer 和 RAF。
- `global-runtime.js` 接线边界：只创建 `terminalResize` 与 `terminalViewport` controller，注入 transport、output、rendering、IME、selection、overview 和工作区的显式命令或只读 getter；不得保留 resize/viewport 状态、observer/listener、RAF、timer、DOM fit、inset 或方向恢复实现。
- 边界：ACK 前不切本地网格；远端新 epoch 只观察，只有 tab/pane/focus/pageshow/input/稳定 viewport 等明确使用意图才能 reclaim；普通 resize 在途时显式 claim 必须排队升级；单 pane resize 失败不得关闭 Unified 物理连接；resize 只复用当前内存终端状态和 presentation hold，不触发或显示历史 replay、snapshot、重连或几何中间帧。

### 12. 输入队列、generated response 与输入锁

- 状态：输入队列、generated response、输入锁和资源生命周期已完成迁移；IME/移动键盘输入状态见下一小节。
- 当前目录：`terminal/input/`；外部只能从 `index.js` 导入。
- 公开 API：`createTerminalInputController()` 提供 session 安装、普通/generated 输入、pending flush、背压泵送、suppression、输入锁和幂等销毁；纯模型提供 response 识别、Unicode 分块与字节预算。
- 状态 owner：`input_controller.js` 唯一修改 pending/input queues、lease-bound expiry、backpressure、generated suppression、processing 状态和 server revision input lock；`input_lifecycle.js` 唯一维护三个 timer 与 `term.onData` disposable。
- `global-runtime.js` 接线边界：只注入 replay/socket/lease/resize/theme 的只读 getter 和显式恢复命令，并在 session、协议及部署重启边界调用公开 API；不得保留队列、timer、generated 分类或 listener 实现。
- 边界：用户输入与 generated response 明确分类；输入发送不依赖 Canvas `renderReady`；迟到 callback 不得在 session 解绑后发送数据。

### 13. IME、移动键盘与宿主输入

- 状态：composition、helper textarea、focus transaction、Android native delete、paste 去重、同步双击和资源生命周期已完成迁移；visualViewport、keyboard inset、方向恢复和 viewport lock 已由独立 `terminal/viewport/` owner 接管。
- 当前目录：`terminal/input/ime/`；应用层统一从 `terminal/input/index.js` 导入。
- 公开 API：`createTerminalIMEController()` 提供 session 安装、host reset、input positioning、focus/blur、快捷键/原生粘贴 focus、键盘状态、touch claim 和幂等销毁；lifecycle 与 model 分别维护资源和纯函数。
- 状态 owner：`ime_controller.js` 唯一修改 composition、textarea sentinel/delete buffer、focus allowance、native delete、paste dedupe、touch claim 和 input anchor；viewport lock 与 keyboard inset 只能通过注入的 `terminalViewport` 公开命令读取或修改。
- `global-runtime.js` 接线边界：只创建 controller、注入 input/clipboard/resize/viewport 命令，并在 pane/session/快捷键/TUI/page dispose 边界调用公开 API；不得保留 IME listener、timer、textarea 算法或 touch state。
- 边界：双击 focus 必须保持同步用户手势；初始化/system focus 不能抢占移动键盘；composition 期间不能发送未确认文本；任何输入或 viewport 路径不得触发或显示历史回放过程。

### 13.1 移动终端快捷键

- 状态：快捷键栏状态、按钮渲染、触摸/指针交互、长按重复、sticky modifier、触感反馈和键盘保活已完成迁移。
- 当前目录：`terminal/input/mobile_shortcuts/`；应用层统一从 `terminal/input/index.js` 导入，外部不得深度导入 controller/lifecycle。
- 公开 API：`createMobileShortcutsController()` 提供 `render()`、`trigger()`、sticky 输入判定/消费、反馈开关、`syncState()` 和幂等 `dispose()`；`createMobileShortcutsLifecycle()` 管理 listener、timeout、interval 的注册与清理。
- 状态 owner：controller 唯一修改 sticky modifier、反馈偏好和按钮交互/渲染状态；lifecycle 唯一持有动态按钮 listener、长按 timer 和重渲染资源。业务动作通过 `onAction`，终端输入通过 `sendInput` 显式回调交给应用层。
- 边界：模块不拥有 tab/pane/session、input queue、IME composition、transport、history、resize 或 presentation；快捷键触发不能显示历史、snapshot、resize 或重连中间过程，移动菜单动作仍由 interaction/app 层执行。

### 13.2 终端键盘覆盖层

- 状态：桌面 `Alt` ESC 前缀、`Shift+Tab` backtab 和移动 sticky modifier 的 custom key handler 已从应用控制器迁出。
- 当前目录：`runtime/static/terminal/input/key_overrides/`；外部统一从 `terminal/input/index.js` 导入。
- 公开 API：`createTerminalKeyOverridesController()` 负责每个 session 的 custom key handler 安装、cleanup 和 dispose；`terminalAltMetaInputFromEvent()`、`isPrintableAsciiCharacter()` 提供无状态键值转换。
- 状态 owner：模块只持有 handler 绑定和 dispose fence；字体快捷键、sticky modifier 消费与输入发送均通过注入回调交给 settings/mobile shortcuts/input controller。
- 边界：`AltGraph`、非 ASCII 和带 Ctrl/Meta 的事件不得误发 ESC；session 关闭或模块 dispose 后迟到键盘回调不得发送字节。键盘转换不得触发 history replay、snapshot、resize 或重连中间画面。

### 13.3 终端策略

- 状态：Grok/Claude fullscreen 会话识别、终端位置描述和用户输入前滚动策略已从应用控制器迁出。
- 当前目录：`runtime/static/terminal/policy/`；外部统一从 `terminal/policy/index.js` 导入。
- 公开 API：`createTerminalPolicyController()` 提供 Claude 事件候选、输入前滚动和幂等 `dispose()`；纯函数提供命令 token 解析、精确 Grok 入口判断和位置描述。
- 状态 owner：策略 controller 只持有 dispose fence；session、mouse、dialog、viewport 和 renderer 状态均由注入 getter/命令的原 owner 修改。
- `global-runtime.js` 接线边界：只注入 mouse/layout/dialog/renderer 的只读查询和滚动命令，并把公开策略结果传给 TUI、mouse、transport/session；不得保留命令解析或 Claude/Grok 分支。
- 边界：识别必须使用精确 executable/官方入口匹配，不能使用宽泛子串；关闭 session、对话框打开或 dispose 后不得滚动或修改终端。策略路径不得触发或显示 history replay、snapshot、resize 或重连中间帧。

### 13.4 终端 metrics 与尺寸查询

- 状态：字体 metrics 刷新、live pane 字体/字号/scrollback/mobile-pixel-scroll 适配、终端元素尺寸估算和 workspace 尺寸 query 已从全局 runtime 迁出。
- 当前目录：`runtime/static/terminal/metrics/`；外部统一从 `terminal/metrics/index.js` 导入。
- 公开 API：`createTerminalMetricsController()` 提供 `refresh()`、`applyFontFamily()`、`applyFontSize()`、`applyScrollback()`、`applyScrollbackChange()`、`applyMobilePixelScroll()`、`estimatedSizeForElement()`、`sizeQuery()` 和幂等 `dispose()`。
- 状态 owner：metrics controller 唯一持有字体刷新 generation 及 retry RAF/timer，并负责把设置变化应用到当前 live pane；`global-runtime.js` 仍持有全局 terminal options 基值，renderer、presentation、resize、history 和 session 继续维护各自权威状态。
- `global-runtime.js` 接线边界：只注入全局 option setter、tabs/current tab、terminal area、renderer/presentation/resize/history API 和 session cleanup，settings 通过公开方法触发适配；不得在全局 runtime 中重新实现 pane 遍历、padding/字体测量、scrollback 传播或 retry timer。
- 边界：字体变化先保留当前 presentation frame，再更新 renderer metrics 并请求 resize；迟到 generation/session cleanup/dispose 回调不得修改已关闭 pane。metrics 不建立连接、不执行 history replay，不显示 resize 或重连中间帧。

### 13.5 应用反馈

- 状态：toast timer 和启动错误面板的文本/hidden 状态已从应用控制器迁出。
- 当前目录：`runtime/static/app/feedback/`；外部统一从 `app/feedback/index.js` 导入。
- 公开 API：`createAppFeedbackController()` 提供 `showToast()`、`showStartupError()`、`hideStartupError()` 和幂等 `dispose()`。
- 状态 owner：feedback controller 唯一修改反馈 DOM 与 toast timer；bootstrap、startup error、workspace 和 terminal 只通过注入回调调用。
- 边界：dispose 后迟到 toast timer 不得修改 DOM；反馈模块不拥有错误根因、网络、终端、历史或 workspace 状态，不得触发或显示 history replay、snapshot、resize 或重连中间帧。

### 14. 鼠标、选择、搜索、剪贴板与链接

- 状态：上下文菜单、搜索、剪贴板、链接、选择和 mouse protocol 均已完成迁移。
- 当前目录：`terminal/interaction/`、`terminal/selection/` 和 `terminal/mouse/`，各自提供公开 `index.js`、README、controller/model/lifecycle 边界。
- 上下文菜单状态 owner：controller 独占 desktop/mobile context target、动作可用性与分派、移动菜单 350ms 误点击门禁，以及最近触摸位置和 1400ms 合成菜单抑制窗口。
- 生命周期：lifecycle 独占 document/window、移动菜单、桌面菜单和动态 pane/tab `contextmenu` listener；pane cleanup 进入 terminal session lifecycle，tab 按钮重建/删除时立即清理。
- 搜索状态 owner：`search_controller.js` 独占 query、matches、index、session ID 和打开状态；`search_lifecycle.js` 独占搜索 listener 与延迟聚焦 timer；`search_model.js` 和 `terminal_text_model.js` 无状态读取 Ghostty buffer，不修改 history、rendering 或 session 权威状态。
- 剪贴板状态 owner：`clipboard_controller.js` 独占复制/粘贴命令、完整缓冲区选择解释、桌面拖选状态和迟到异步 guard；adapter 独占浏览器 Clipboard/fallback，lifecycle 独占动态 mouse listener。
- 选择状态 owner：`selection_controller.js` 独占 manager patch、完整缓冲区私有状态、长按/手柄/自动滚动；view 和 lifecycle 独占 DOM 与资源。
- mouse 状态 owner：`mouse_controller.js` 独占工具无关桌面/触摸状态、事件认领与 adapter 命令；model 独占协议编码，lifecycle 独占 listener。
- `global-runtime.js` 只注入 tab/pane 只读查询、选择/链接读取和复制、粘贴、搜索、截图、分屏、移动、关闭、主题、输入发送、尺寸重申和工具身份策略，并调用各模块公开 API。
- 边界：本地选择与终端 mouse tracking 必须通过明确事件所有权隔离。

### 15. fullscreen TUI 适配器

- 状态：已完成迁移。既有 fullscreen TUI 安装、触摸、右键和桌面选择适配已归档到 `terminal/tui_adapters/{common,claude,opencode,herdr,pi}/`，每个子目录均有 README 和公开入口。
- 当前目录：`terminal/tui_adapters/`；`global-runtime.js` 只创建 installer 并注入策略、session cleanup 和交互命令。
- 公共层：只保存无工具身份判断的手势机械逻辑。
- 工具层：只负责精确身份识别和事件所有权适配。
- 边界：不得把 Claude、opencode、herdr、pi 或 Grok 特例重新并入通用 mouse tracking。

### 16. 终端总览与长截图

- 状态：总览和长截图均已完成迁移。总览 controller/view/lifecycle 独占总览状态、DOM 和资源；长截图工具只通过公开命令接收当前 session、移动快捷键和对话框依赖。
- 当前目录：`terminal/overview/` 和 `terminal/screenshot/`。
- 总览文件：`overview_controller.js`、`overview_view.js`、`overview_lifecycle.js`、`preview_controller.js`、`preview_store.js` 和公开 `index.js`。
- 总览状态 owner：总览 controller 独占打开状态、RAF/timer、拖拽、移动端边缘手势和历史 guard；preview controller 独占 capture/load generation、debounce timer 与 decoded image；preview store 独占 IndexedDB 图片 transaction、64 项容量和 30 天过期清理；view/lifecycle 分别独占 DOM 与 listener 生命周期。
- `global-runtime.js` 只注入只读工作区视图、last-known-good frame 查询、已提交 presentation 授权和显式 tab/pane 生命周期命令，并调用总览和长截图公开 API。
- 边界：总览来源优先级固定为已提交 live、有效 hold、同 identity IndexedDB 图片；持久图不含 PTY/cursor，不能触发 replay、恢复 Ghostty 或参与 input ready。截图必须冻结几何并在变化时中止。

### 17. 主题、字体与终端外观

- 状态：主题子域和设置侧的字体、字号、行高均已于 2026-08-30 完成迁移。
- 当前目录：主题位于 `runtime/static/appearance/`；字体选择、字体注册、字号和行高设置位于 `runtime/static/settings/`。
- 当前文件：appearance 的 controller/lifecycle/view/catalog/model/preview 和同目录 `themes.json`，以及 settings 的 controller/model/view/font registry。
- 主题状态 owner：controller 独占 catalog、active theme、持久化、请求 generation、picker/settings theme DOM 生命周期、timer、RAF、drag 和 touch state。
- 设置状态 owner：settings controller 独占 font selection、uploaded font、font size、line height、字体注册 generation 和持久化队列。
- 接线边界：主题变化由 appearance runtime 遍历现有 pane 并发送终端颜色协议；字体、字号、scrollback 和 mobile pixel scroll 的 live pane 适配由 terminal metrics controller 负责。`global-runtime.js` 只注入公开 API 和保留全局 option 基值，appearance/settings 不反向依赖 terminal/workspace。
- 边界：主题变化只发布副本；不得触发历史 replay、清空 terminal runtime 或显示历史回放过程。

### 18. 设置

- 状态：已于 2026-08-30 完成迁移。
- 当前目录：`runtime/static/settings/`。
- 当前文件：`index.js`、`settings_controller.js`、`settings_api.js`、`settings_model.js`、`settings_view.js`、`settings_lifecycle.js`、`font_registry.js`、`shortcut_editor.js` 和目录 README。
- 状态 owner：controller 独占服务端设置 snapshot、本地偏好、PATCH 队列、pending overlay、请求 generation、面板导航、编辑器、拖拽和 timer；font registry 独占 FontFace 生命周期。
- 边界：设置模块只协调各领域公开 API，不直接实现主题渲染、终端协议、诊断采集或工作区状态；快捷键动作执行仍归输入/工作区层。

### 19. 调试模式与诊断

- 状态：已于 2026-08-30 完成第一阶段迁移。
- 当前目录：`runtime/static/diagnostics/`。
- 当前文件：`index.js`、`diagnostics_controller.js`、`network_context.js`、`diagnostics_lifecycle.js`、`diagnostics_view.js`、`debug_log.js`、`performance_meter.js`、`performance_tasks.js`、`network_monitor.js`、`startup_trace.js`、`terminal_timeline.js`。
- 状态 owner：debug 总控、各诊断开关、日志去重、采样 timer、动态模块加载、终端时间线和有限的页面运行时 trace。
- 边界：关闭调试总控后必须停止所有采样、listener 和 timer；诊断数据不能驱动业务状态。

### 20. 设备在线状态

- 状态：已于 2026-08-30 完成迁移。
- 当前目录：`runtime/static/devices/`。
- 当前文件：`index.js`、`devices_controller.js`、`devices_api.js`、`devices_model.js`、`devices_view.js`、`devices_lifecycle.js`。
- 状态 owner：短 TTL 在线列表、心跳 timer、请求 generation 和面板状态。
- 边界：设备身份按 account ID 隔离；调试模块只控制是否启停，不接管设备数据。

### 21. 附件和文件浏览器

- 状态：已于 2026-08-30 完成迁移。
- 当前目录：`runtime/static/attachments/`。
- 当前文件：`index.js`、`attachments_controller.js`、`attachments_api.js`、`attachments_clipboard.js`、`attachments_model.js`、`attachments_view.js`、`attachments_lifecycle.js`。
- 状态 owner：浏览路径、排序、选择、上传任务、XHR、timer、请求 generation 和剪贴板 reservation。
- 边界：继续保持 32 文件、单文件 2GB、64 下载条目及服务端授权范围。

### 22. 服务转发

- 状态：已于 2026-08-30 完成迁移。
- 当前目录：`runtime/static/service_forwarding/`。
- 当前文件：`index.js`、`service_forwarding_controller.js`、`service_forwarding_api.js`、`service_forwarding_model.js`、`service_forwarding_view.js`、`service_forwarding_lifecycle.js`。
- 状态 owner：发布列表、编辑项、busy 状态和请求 generation。
- 边界：浏览器只调用 Provider 白名单代理，不直接访问 Admin 私有状态。

### 23. 终端配置

- 状态：已完成从 `global-runtime.js` 的常量声明中独立归档。
- 当前目录：`runtime/static/terminal/config/`；外部统一从 `terminal/config/index.js` 导入。
- 当前文件：`index.js`、`terminal_config.js` 和目录 README。
- 状态 owner：无可变状态；配置对象由 `terminal_config.js` 冻结，终端 controller 只读取副本/字段。
- 边界：配置模块不创建连接、不执行回放、不操作 Canvas、不注册生命周期资源；全局 runtime 仍负责读取配置并维持全局启动与销毁顺序。

## 现有测试归档

Node 行为测试统一归档在仓库根目录的 `tests/` 文件夹中，文件名使用 `*_test.mjs`。下表中的 Node 测试文件名均省略了共同的 `tests/` 前缀；它们按功能模块列出只是为了说明覆盖范围，不表示测试文件应放回 `runtime/static/` 的模块目录。真实浏览器和设备回归继续放在 `tests-auto/`，不与 Node 行为测试混放。

| 目标模块 | 现有主要 guard |
| --- | --- |
| `app/` | `main_test.go` 的版本化资源测试；`app_bootstrap_controller_test.mjs`、`legacy_storage_cleanup_controller_test.mjs`、`app_lifecycle_controller_test.mjs`、`app_dialog_controller_test.mjs`、`app_shortcut_controller_test.mjs` 和 `runtime_shortcuts_test.go` 的 bootstrap、旧 PWA 清理、生命周期、快捷键和静态资源契约 |
| `instances/` | `instances_loader_test.mjs`、`instances_controller_test.mjs`、`TestRuntimeInstancesModuleBoundary`、`instances_test.go`、`workspace_test.go` 的实例可见性测试 |
| `workspace/` | `workspace_api_controller_test.mjs`、`workspace_persistence_controller_test.mjs`、`workspace_refresh_controller_test.mjs`、`workspace_state_apply_controller_test.mjs`、`workspace_tab_controller_test.mjs`、`workspace_tab_activation_controller_test.mjs`、`tab_activation_scheduler_test.mjs`、`workspace_layout_controller_test.mjs`、`workspace_layout_view_controller_test.mjs`、`workspace_tab_registry_test.mjs`、`workspace_activity_controller_test.mjs`、`workspace_tab_label_controller_test.mjs`、`workspace_tab_navigation_controller_test.mjs`、`workspace_test.go` 与 `TestRuntimeWorkspaceModuleBoundary` |
| `terminal/session/` | `terminal_session_controller_test.mjs`、`TestTerminalSessionControllerBehavior`、`TestRuntimeTerminalSessionModuleBoundary`，以及 runtime 中连接身份、presentation 和 input/output cleanup guard |
| `terminal/transport/` | `terminal_queue_connection_test.mjs`、`terminal_unified_health_test.mjs`、`terminal_unified_membership_test.mjs`、`terminal_connection_scheduler_test.mjs`、`terminal_queue_test.go` |
| `terminal/history/` | `terminal_replay_controller_test.mjs`、`terminal_session_replay_controller_test.mjs`、`terminal_session_protocol_controller_test.mjs`、`client_terminal_history_controller_test.mjs`、`terminal_checkpoint_test.mjs`、`workspace_test.go` 的 snapshot/cursor/agent replay 测试 |
| `terminal/output/` | `terminal_output_controller_test.mjs`、`TestRuntimeTerminalOutputModuleBoundary`、Queue turn ACK/bounded chunk guard、`tests-auto/05-terminal-output` |
| `terminal/rendering/` | `terminal_renderer_adapter_test.mjs`、`TestTerminalRendererAdapterBehavior`、`terminal_render_snapshot_test.mjs`、`terminal_frame_release_scheduler_test.mjs`、Ghostty renderer/terminal 测试、`TestRuntimeTerminalCanvasResidueGuard` |
| `terminal/resize/` | `terminal_resize_controller_test.mjs`、`terminal_resize_scheduler_test.mjs`、`terminal_size_sync_test.go`、`scripts/test-multi-device-resize.sh` |
| `terminal/viewport/` | `terminal_viewport_controller_test.mjs`、`TestTerminalViewportControllerBehavior`、`TestRuntimeTerminalViewportModuleBoundary`，以及 runtime 的 mobile zoom、safe area、keyboard pan 和 orientation guard |
| `terminal/input/` | `terminal_input_controller_test.mjs`、`terminal_ime_controller_test.mjs`、`terminal_mobile_shortcuts_controller_test.mjs`、`TestTerminalInputControllerBehavior`、`TestTerminalMobileShortcutsControllerBehavior`、`TestRuntimeTerminalInputModuleBoundary` 和 `TestRuntimeTerminalMobileShortcutsModuleBoundary`，以及 runtime 的 Android keyboard、large paste、input lock、composition 和 sticky modifier guard |
| `terminal/interaction/` | `terminal_context_menu_controller_test.mjs`、`TestTerminalContextMenuControllerBehavior`、`TestRuntimeTerminalInteractionModuleBoundary`、Claude fullscreen 右键隔离和触摸选择 guard |
| `terminal/tui_adapters/` | Claude、opencode、herdr、pi 的 Node/Go 行为与隔离测试 |
| `terminal/overview/` | `terminal_overview_controller_test.mjs`、`TestTerminalOverviewControllerBehavior`、`TestRuntimeTerminalOverviewModuleBoundary`、live/hold Canvas 来源及移动端手势/拖拽 guard |
| `terminal/screenshot/` | `terminal_long_screenshot_test.mjs` 和 `TestRuntimeTerminalLongScreenshotContract` |
| `diagnostics/` | `diagnostics_controller_test.mjs`、`terminal_network_monitor_test.mjs` 和 runtime debug 总控/模块边界 guard |
| `terminal/config/` | `terminal_config_test.mjs`、`TestRuntimeTerminalConfigModuleBoundary` 和版本化配置资源 guard |
| `service_forwarding/` | `service_forwarding_controller_test.mjs`、`TestRuntimeServiceForwardingModuleBoundary` 和 `workspace_test.go` 的发布代理测试 |
| `attachments/` | `attachments_test.go` 和 runtime attachment browser guard |
| `devices/` | `devices_controller_test.mjs`、`devices_test.go` 和 `TestRuntimeDeviceManagementStaticGuards` |
| `appearance/` | `appearance_controller_test.mjs`、`TestRuntimeAppearanceModuleBoundary`、OSC 主题协议、IME composition preview 和 presentation hold guard |
| `settings/` | `settings_controller_test.mjs`、`TestRuntimeSettingsModuleBoundary`、`workspace_test.go` 的 PATCH 语义测试，以及 runtime 字体、scrollback、line-height、快捷键设置 guard |

Node 测试的物理位置统一保持在 `tests/`；按模块归属通过文件命名、测试名称和本表体现。跨模块协议与静态资源契约也放在 `tests/` 或 Go 测试中，测试名称必须指出所保护的模块边界；`tests-auto/` 只承载真实浏览器/设备回归。

## 建议迁移顺序

1. 先增加结构 guard：`main.js` 入口契约、模块 README 模板、公开入口和禁止深度 import 的检查。
2. 迁移低风险叶子模块：诊断面板、服务转发、附件、设备和实例切换已完成。
3. appearance 主题域和 settings 已完成，并建立“设置协调领域 API”的依赖方向。
4. 现有独立文件已完成目录归档；tab overview、context menu、搜索、剪贴板、链接、选择、mouse controller/lifecycle 和桌面快捷键动作已完成迁移。
5. `terminal/session/` 状态模型和统一 cleanup 已完成，协议、历史、渲染与输入算法保持原行为。
6. rendering、resize、input/IME、viewport、output、服务端 history replay、`client:` history 兼容和 transport 已完成迁移，每一步保留现有行为 guard。
7. 迁移 workspace controller 和 app lifecycle，最后把 `main.js` 收敛为单一 `startGlobalRuntime()` 调用；该入口收敛已完成。

`connectSession()` 的协议实现已归入 `terminal/transport/session_protocol_controller.js`；后续只允许继续把协议/业务实现放入对应 feature owner，`global-runtime.js` 保留调用接线和全局生命周期顺序，不再回填实现。

## 单模块迁移完成标准

一个模块只有同时满足以下条件才算完成迁移：

1. 文件夹根目录存在完整 `README.md`。
2. 对外只有明确入口，调用方不深度导入内部实现。
3. 状态 owner、controller 和 lifecycle/cleanup 已明确。
4. 原入口实现中对应实现已删除，不保留双份逻辑或隐式 fallback。
5. 迟到 Promise、timer、RAF、observer、listener 和 socket callback 有 generation/dispose guard。
6. 相关 Node/Go guard 已迁移或新增行为测试；不能只依赖字符串存在性检查。
7. `node --check runtime/static/main.js runtime/static/global-runtime.js`、相关模块语法检查、定向测试、`go test ./...` 和 `git diff --check` 通过。
8. 若移动静态资源，版本化 import、HTTP 资源映射、构建产物和 LPK 内容已核对。
9. 涉及终端核心时，至少验证正常路径和一个重连、隐藏、失败或跨设备路径，并确认历史中间过程始终不可见。

## 第一批建议

第一批实际整理按以下顺序推进：

1. `diagnostics/`：已完成，用于验证 controller/lifecycle/README、资源清理和公开入口规范。
2. `service_forwarding/`：已完成，验证了 API、表单事务、目标切换 generation 和补偿删除边界。
3. `attachments/`：已完成，验证了文件浏览、XHR、ClipboardItem reservation、动态 DOM 和 tab/target/dispose 清理边界。
4. `devices/`：已完成，验证了跨模块只读调试状态、心跳/列表 timer、AbortController、请求 generation 和页面生命周期边界。
5. `instances/`：已完成，验证了列表单飞、Provider 错误边界、切换命令、首页导航、模块 listener 和 active selector 过渡所有权。
6. `appearance/` 主题域：已完成，验证了 catalog/persistence owner、picker 与 settings theme DOM、timer/RAF/touch/pointer 生命周期和终端 presentation 回调边界。
7. `settings/`：已完成，验证了字段级 PATCH、pending overlay、字体注册、两套快捷键编辑器、面板导航、timer/listener/dispose 和终端适配边界。
8. `terminal/session/`：已完成，验证了 pane ID、完整初始状态、私有 cleanup、closed-before-detach、幂等销毁和兄弟 logical stream 隔离边界。
9. 静态根目录独立模块归档：已完成，验证了公开入口、README、相对 import、版本化资源路径和既有行为测试不变；该步骤不代表核心 controller/lifecycle 迁移完成。
10. `terminal/overview/`：已完成，验证了总览状态 owner、DOM/lifecycle 隔离、live/hold/persisted 图片来源、identity/generation guard、拖拽/手势/历史边界和资源清理。
11. `terminal/interaction/` 上下文菜单子域：已完成，验证了 desktop/mobile target、动作分派、触摸合成菜单抑制、动态 pane/tab listener 和销毁清理边界。

renderer adapter、presentation、resize、输入队列、IME、移动快捷键、移动 viewport、output、服务端 history replay、`client:` IndexedDB 兼容、session connection、Unified 物理 transport、应用命令和主题发送适配均已完成迁移。`global-runtime.js` 当前只保留全局状态声明、feature controller 创建、跨模块依赖接线、启动/恢复/页面生命周期和统一销毁顺序；其中的 `connectSession()` 仅是对 transport public API 的转发。后续新增功能仍需按独立 owner、controller、lifecycle 和行为 guard 落入对应目录。

下一步重点是继续缩减全局 runtime 中的重复接线和隐式共享引用（不移动全局状态 owner），并为每个新增责任域补齐 README、公开入口、版本化静态资源契约和真实环境回归；任何路径都必须保持输入分类、output/resize/presentation 门禁、单 Unified 连接和历史过程不可见边界。
