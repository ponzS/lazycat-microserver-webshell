# 历史修复与回归防护记录

本文档用于保存 `lazycat-microserver-webshell` 的架构基线、已确认的历史问题和防止问题复现的 guard。它不是发布日志，也不记录未经证实的猜测或已经否定的方案。

首版建立于 2026-07-27。初始历史条目根据仓库 Git 提交、当前实现和现有测试重建；后续每次 Bug 修复都应在同一次变更中更新本文档。

## 使用规则

### 开始任务前

1. 阅读 `AGENTS.md`、`README.md`、本文档和本次修改涉及的源码、调用方及测试。
2. 在“架构基线”和“长期 guard”中确认状态归属、协议边界、终端历史、平台输入和账号隔离要求。
3. 在“历史修复记录”中搜索相关模块、协议字段、事件类型、缓存字段或错误现象。
4. 修改终端渲染、重连、输入、移动端手势或 agent 时，先画清事件/数据时序，不能只根据最终画面修补表象。

### 修复 Bug 后

1. 在“历史修复记录”末尾新增条目，不覆盖旧条目。
2. 必须写清错误现象、触发条件、根因和最终实施方案，不能只写“已修复”。
3. 必须增加 guard。优先级依次为：行为测试、单元测试、协议/资源契约测试、可重复的设备验证。
4. 涉及终端状态机时，guard 至少覆盖正常路径和一个失败、重连、隐藏或跨账号边界。
5. 执行与改动直接相关的测试，并在风险允许时执行完整测试。无法验证的设备或宿主必须写明。
6. 如果修复改变了架构基线、稳定协议或验证方式，同时更新本文档前半部分。

### 历史记录维护

- 历史条目只追加，不静默删除。原记录有误时追加“更正”说明并引用原条目 ID。
- 一个问题跨浏览器、Provider 后端和 persistent agent 时使用一个主条目，完整记录端到端时序。
- 不能以吞掉错误、过滤日志或静默 fallback 代替根因修复。
- 重构只有在改变了故障边界或 guard 时才记入本文档；普通功能开发不作为历史修复记录。

## 当前架构基线

### 进程与路由

- `main.go` 启动仅监听 `127.0.0.1:8080` 的 Provider 服务，注册静态资源、实例、设置、附件、工作区、设备、版本和 WebSocket 路由。
- LPK 通过 `lzc-manifest.yml` 的 `/=exec://8080` 启动入口，并通过 `lightos.webshell` Resource Export 被 `lightos-admin` 发现。
- 页面静态资源位于 `runtime/static/`，随二进制一起打包。HTML 禁止缓存并由 Provider 注入当前 LPK 版本资源路径；新页面通过 `/assets/<lpk-version>/` 读取 JS/CSS/JSON/WASM/manifest/图标并使用 immutable 缓存，旧 `/static/` 只保留兼容和可重验证策略。
- PWA Service Worker 由 Provider 注入当前 LPK 版本与资源基路径，只对版本化静态资源执行 network-first 和离线缓存兜底；页面导航、`/api/*`、`/ws` 和终端虚拟 Cache URL 不进入 app-shell 缓存。

### 管理端、Provider 与目标端边界

- `lightos-admin` 是实例发现、当前用户可见性和发布服务管理的权威入口；Provider 通过公开/白名单接口对接，不读取 Admin 私有状态。
- 对 LightOS 实例，Provider 后端通过 `lightosctl` 进入目标实例，并把 persistent agent 安装和运行在目标实例内。
- 对 `client:<client_instance_id>`，Provider 在服务端重新校验可见性、换取短期票据并代理到客户端本地终端服务。Device API URL、服务凭据和票据不得返回浏览器。
- 浏览器只处理现有 WebShell API 和 WebSocket 协议，不直接调用目标实例或客户端终端服务。

### 工作区与 persistent agent

- `workspace.go` 定义 tab、pane、分屏、活动状态、历史和 PTY 行为；`agent.go`/`agent_runtime.go` 负责 agent 协议、安装、启动、兼容检查和 attach。
- 工作区和 PTY 的权威状态位于目标实例的 persistent agent。Provider 进程重启或浏览器断开不应销毁兼容 agent 中的会话。
- agent scope 至少由完整 selector 和 account ID 组成。socket、缓存、启动错误和请求都必须使用同一 scope，防止同名实例或不同账号串会话。
- agent 协议版本不兼容时应明确报错或执行已设计的升级流程，不能把旧响应当成当前结构继续解析。
- agent 二进制升级必须先解包到目标目录同一文件系统内的独立 staging 目录，校验二进制与 manifest 后原子替换；不得用 tar 直接覆盖正在运行或已存在的 agent 文件。

### 终端历史与渲染

- LightOS 实例终端历史以 persistent agent 保存的原始 PTY 字节为可信来源；浏览器渲染状态不是历史权威。
- 历史流使用 `history_generation` 和绝对 byte cursor 表示范围。服务端根据本地范围选择 `snapshot`、`delta` 或 `current`，所有 chunk 必须连续。
- 容器实例使用 Cache API v2 保存按账号 scope、完整 selector、workspace generation、tab、pane 和 history generation 隔离的不可变 PTY 字节块，并以 commit-last manifest 暴露已持久化 cursor。缓存无效时可以丢弃并从 agent 重建，但不能把不连续缓存拼接到新 generation。
- 容器页面从网络 workspace 响应取得完整账号 scope、selector、workspace、tab 和 pane 身份后，立即从 Cache API 并发读取该精确身份下的 PTY 字节并直接回放到 Ghostty canvas，不等待 WebSocket open、replay start 或 replay complete。首个包含可见内容的有序读取批次即可显示真实 canvas，剩余 chunk 继续后台回放并在 manifest end 最终 render。canvas 可见与输入就绪是独立状态：本地字节画面可以在连接灰点存在时显示，但输入必须继续锁到服务端 generation/cursor 校验、增量或 snapshot、缓存提交、fit 和最终 render 全部完成。
- tab 总览不得只复制已经激活过的 live canvas。未激活 pane 可以按完整 cache-v2 身份读取已提交的图片缩略图，但缩略图只用于总览，不能参与终端启动显示、Ghostty 状态恢复或输入就绪判断。
- 服务端接受本地 range 时，`delta/current` 必须复用已经恢复的 Ghostty 状态，不得再次清空和重复回放本地 chunk。服务端返回 `snapshot` 时，保持已显示的同身份本地 canvas，先在内存收齐服务端 snapshot，再一次性重置并回放权威字节；本地缓存字节不得参与 snapshot 状态计算。
- `client:` PC target 保持其独立的 IndexedDB 和完整历史协议，不读取 Cache API v2，也不启用容器 warm replay；不能未经双方协议升级直接套用实例 agent 的增量假设。
- pane 只有在尺寸可测量、fit generation 与 replay generation 都是当前值、canvas 尺寸正确，且本地 warm replay 或服务端 replay 已完成当前可展示帧后，才能标记为可展示；输入仍必须等待服务端 replay 完成。
- 终端渲染使用随包分发的 Ghostty Web 和明确的 `ghostty-vt.wasm` 路径。本项目禁止引入或仿制 `xterm.js`。

### 输入、移动端与 iOS

- 终端 helper textarea 的 focus、blur、IME、composition、generated response 和用户输入属于同一条状态链，修改时必须检查事件顺序和输入锁。
- iOS/宽触摸屏的键盘唤起必须发生在有效用户手势内。需要抢在终端手势消费者之前观察事件时，使用经过验证的 capture 顺序，不能改成异步延迟后再 focus。
- 单击选择、双击唤起键盘、拖动、长按、终端鼠标协议和快捷键会竞争同一批 touch 事件；修复其中一项必须防止破坏其余路径。
- `runtime/static/ios_terminal_host.js` 只处理 Lazycat iOS 宿主桥接行为，不应扩散为通用浏览器逻辑。

### 设置、附件与设备

- 设置由字体 store 统一持久化。部分更新必须保留未修改字段，并区分“未传”“显式 null”“显式空数组/空行”。
- 附件上传单批最多 32 个文件、单文件最大 2GB；下载一次最多 64 个条目。文件名、路径、符号链接和压缩目录都必须限制在授权目标范围内。
- 设备在线列表是按 account ID 隔离的短 TTL 心跳视图，不是持久设备数据库。`client_id` 不能脱离 account ID 单独作为全局键。

## 长期 guard

| 风险域 | 必须保持的不变量 | 修改时至少检查 |
| --- | --- | --- |
| 账号与 scope | HTTP、WebSocket、agent socket、输入锁、设备和缓存都按账号及完整 target 隔离 | 缺少账号头、跨账号、同名实例、`client:` target |
| agent 生命周期 | 兼容 agent 和 PTY 不因 Provider 重启丢失；安装/升级失败不能伪装成 ready | ping、缓存命中校验、启动超时、协议不兼容、信号继承 |
| 历史同步 | generation 一致、cursor 连续、trim 后绝对范围正确、snapshot/delta/current 选择正确；容器本地缓存必须绑定完整账号/workspace/tab/pane 身份 | 首次连接、刷新、断网重连、服务端 trim、本地缓存缺块、跨账号/实例/workspace/tab |
| 渲染就绪 | 隐藏 pane 不使用不可测尺寸；旧 fit/replay generation 不能让画面提前显示 | tab 切换、分屏、隐藏恢复、方向变化、Canvas context 恢复 |
| 用户输入 | 用户输入、IME 和终端自动响应分离；输入锁不能吞掉允许的 generated response | composition、粘贴、大输入、回放期间 DSR/OSC、锁过期 |
| 触摸与 iOS | 双击 focus 保持同步用户手势和 capture 顺序；单击、拖动和选择不误触键盘 | iOS WebView、宽触摸屏、长按、终端鼠标模式、快捷键 |
| 工作区恢复 | 最后 selector/tab 持久恢复；用户明确返回首页时清除恢复意图 | 超过 30 秒、WebView 重载、无效 URL、浏览器前进后退 |
| 设置 | PATCH 只更新显式字段，保留其他设置；null 与空值语义稳定 | 字体、scrollback、line height、移动/桌面快捷键 |
| 客户端终端 | 浏览器不可见票据和服务凭据；每次连接前重新验证可见性 | 下线、过期票据、403/401、Device API 失败、附件代理 |
| 依赖边界 | 不引入 `tmux`、`xterm.js` 或其改名/复制实现 | Go/npm/构建依赖、脚本、vendor、示例代码迁入 |

## 验证基线

常规 Go、协议和静态资源改动：

```sh
go test ./...
git diff --check
```

按风险补充验证：

- agent、工作区或历史：覆盖首次 attach、snapshot、delta、current、trim、断线重连和关闭 pane 清理。
- 前端终端：覆盖活动 pane、隐藏 pane、tab 切换、分屏、页面刷新和 Canvas context 恢复。
- 移动端输入：至少验证单击、双击、拖动、长按、IME、快捷键和键盘收起；iOS 专属修复必须在 Lazycat iOS 宿主验证。
- 客户端终端：覆盖可见性校验、票据失败、WebSocket 代理、完整历史和附件代理。
- manifest、runtime 或打包内容：执行 `lzc-cli project release`，确认 Resource Export、WASM、字体、主题和许可证资源齐全。

## 历史修复记录

### LCMD-20260722-01：工作区恢复状态 30 秒后失效

- 日期：2026-07-22
- 来源：commit `dd22f0db8fc7093dab465596c565aa7f8a22e8c8`
- 影响模块：`runtime/static/main.js`、LightOS 管理页与 Provider 的恢复状态
- 错误现象：用户离开页面、折叠屏触发 WebView 重载或后台停留超过 30 秒后，Provider 无法恢复最后使用的实例和 tab。
- 根因：`webshell.workspaceRestore` 被设计成 30 秒 TTL，但这个状态表达的是持续的工作区选择，而不是短期跳转令牌。
- 实施方案：移除 TTL，保存 version、selector、tab、URL 和 `updatedAt`；启动时补全缺失 query；用户明确返回首页时通过抑制标记清除恢复状态，同时继续触碰活动历史缓存避免误判为孤儿数据。
- Guard：`TestRuntimePersistsWorkspaceForLightOSHomeReload` 验证持久状态、显式首页清理及禁止重新引入 TTL。
- 禁止复现：不得重新加入短过期时间；不得让普通刷新等同于用户主动退出工作区。

### LCMD-20260724-01：隐藏终端使用过期尺寸/回放状态提前显示

- 日期：2026-07-24
- 来源：commit `86f137bc5c88d7c72f40987b61f2cb039b8df70f`
- 影响模块：`runtime/static/main.js`、Ghostty Web 初始化、tab/pane resize 与历史回放
- 错误现象：隐藏 tab/pane 恢复、历史回放或尺寸变化后可能显示残留、空白或与当前终端尺寸不一致的画面；定时 full-render 仍可能把旧状态标记为 ready。
- 根因：就绪判断只依赖宽松的 render/timer 条件，没有把一次呈现绑定到实际可测量的 fit generation 和本次 replay generation；隐藏 pane 的尺寸不可测，旧帧可能通过 watchdog 被展示。
- 实施方案：显式传入随包 WASM 路径；引入 measured/pending/presented fit 与 replay generation；使用 ResizeObserver 和 canvas 尺寸校验；回放和尺寸仍未完成时保持画面隐藏；移除周期性 full-render/watchdog 作为就绪依据。
- Guard：`TestRuntimeTerminalCanvasResidueGuard`、`TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs`、`TestRuntimeMobileOrientationReplaysVisibleTerminalAfterViewportSettle`。
- 禁止复现：不得临时激活所有 tab 来获得尺寸；不得仅凭进程时间、定时器或一次 render 回调将 pane 标记为 ready。

### LCMD-20260726-01：iOS 双击未能恢复终端键盘焦点

- 日期：2026-07-26
- 来源：commit `a6cba71fdc22fae4cb726f11dd5084b0dcedfa56`
- 影响模块：`runtime/static/main.js`、触摸手势与终端 helper textarea focus
- 错误现象：iOS/宽触摸屏上双击终端后键盘有时不弹出，尤其在终端自身的 touch 消费、选择或鼠标跟踪逻辑先处理事件时复现。
- 根因：双击监听依赖 terminal host 的冒泡阶段，可能被更早的终端消费者阻断；并且把 focus 延迟到 `requestAnimationFrame` 后会离开 iOS 认可的同步用户手势上下文。
- 实施方案：在 pane shell 的 capture 阶段先记录 touchstart/move/end；只接受来自当前 terminal host 的触点；确认双击后在 `touchend` 中同步 focus；单击在后续冒泡阶段 settle 为 blur，并在 session 销毁时清理监听器。
- Guard：`TestRuntimeTouchKeyboardRequiresDoubleTapOnWideTouchScreens`、`TestRuntimeTouchKeyboardFocusPrecedesTouchConsumers`。
- 禁止复现：双击 focus 路径不得重新使用 `requestAnimationFrame`、`setTimeout` 或 Promise；不得退回依赖 host 冒泡监听。

### LCMD-20260727-01：Claude fullscreen 触摸滚动与 iOS 双击键盘冲突

- 日期：2026-07-27
- 来源：Claude Code fullscreen 移动端现场问题及第一次修复回归
- 影响模块：`runtime/static/main.js`、移动端触摸选择、终端鼠标协议与 iOS helper textarea focus
- 错误现象：Claude Code 默认模式可正常触摸滚动，但 fullscreen 开启终端鼠标跟踪后，单指上下滑动被解释成按下并拖动，表现为扩展文本选区；第一次把 Claude 兼容逻辑加入全局触摸链后，iOS 双击又无法展开键盘，回档后恢复。
- 根因：默认选择、iOS 双击 focus 和通用终端 mouse tracking 竞争同一批 `touchstart/move/end`。第一次修复没有建立事件所有权，第二次 `touchend` 在 iOS 同步 focus 后仍可能继续发送 Claude press/release 并重申终端尺寸，破坏软键盘激活；同时 Claude 特例进入全局 mouse tracking 会扩大到 Codex、Grok 和其他已经稳定的 TUI。
- 实施方案：新增 Claude fullscreen 独立触摸状态机和 DOM adapter，仅在精确识别 Claude、alternate screen 与 mouse tracking 同时成立的手势开始时锁定接管。单指移动达到 8px 后发送 wheel，450ms 长按进入现有 WebShell 本地选择并复用选择手柄、复制操作栏和自动滚动；普通 tap 延迟到 `touchend` 发送点击。iOS 键盘 capture 层用 `WeakSet` 标记已认领的双击 `touchend`，Claude adapter 消费标记后不执行鼠标准备、不发送任何鼠标字节。adapter 安装顺序固定在默认选择之后、通用 mouse tracking 之前，未匹配会话直接返回原路径。
- Guard：`TestClaudeFullscreenTouchBehavior` 执行 JavaScript 状态机和 adapter，覆盖 Claude npm/native/title 识别、Codex/Grok 排除、tap、wheel、长按选择以及键盘认领后零鼠标输出；`TestRuntimeClaudeFullscreenTouchAdapterIsolation` 固定 input focus、默认选择、Claude adapter、通用 mouse tracking 的安装顺序，并禁止通用 mouse tracking 出现 Claude 分支。现有 `TestRuntimeTouchKeyboardFocusPrecedesTouchConsumers`、`TestRuntimeGrokMouseTrackingPreservesMobileDoubleTapKeyboard` 继续通过。
- 验证结果：`go test ./...`、三个相关 JavaScript 文件的 `node --input-type=module --check`、`git diff --check` 和 `lzc-cli project release` 通过，新增模块已进入 LPK 静态资源构建。真实 Lazycat iOS WebView 仍需复验 Claude fullscreen 双击键盘、滑动、长按复制栏，并同时检查 IME、移动快捷键、Claude default、Codex 和 Grok。
- 禁止复现：键盘层认领的 `touchend` 后不得发送 Claude 鼠标序列或执行终端尺寸重申；不得把 Claude fullscreen 分支重新并入默认选择或通用 mouse tracking；不得在 `touchend` 重新判定手势归属；不得用宽泛的命令或标题子串匹配 Claude。

### LCMD-20260728-01：PC 连接后移动端无法重新取得 Claude 触摸模式

- 日期：2026-07-28
- 来源：Claude fullscreen 跨 PC/移动端现场回归；续接 `LCMD-20260727-01`
- 影响模块：共享 PTY 尺寸、浏览器 resize 去重、Claude fullscreen adapter 与 iOS 双击 focus
- 错误现象：Claude fullscreen 只在手机使用时滑动和双击键盘正常；同一 pane 被 PC 打开后，手机返回会继续显示并使用 PC 交互模式，列表无法触摸滚动，iOS 双击也无法展开键盘。
- 根因：pane 的 PTY 尺寸是所有 attach 客户端共享的最后写入状态，但 `sendTerminalSize` 只与当前浏览器的 `lastSentCols/Rows` 比较。手机曾发送窄尺寸后，PC 把共享 PTY 改为宽尺寸；手机恢复前台时本地 cols/rows 没变，因此 resize 被错误去重，服务端继续保持 PC 尺寸。Claude 随尺寸变化重绘后，移动端本地 alternate-screen 状态可能与 fullscreen 语义暂时不一致；旧 adapter 把该客户端派生状态作为硬门槛，于是触摸落入通用 mouse tracking，重新发送 press/move/release，并在 iOS 同步 focus 后破坏键盘激活。
- 实施方案：增加可强制发送的终端尺寸声明，socket 打开、移动端 `visibilitychange`/`focus`/`pageshow` 和终端 `touchstart` 时由当前客户端重新声明本地尺寸；activity 返回的 pane cols/rows 作为服务端尺寸观测值保存，不能再把 `lastSentCols/Rows` 当作共享 PTY 权威状态。Claude adapter 改为只要求精确 Claude 身份和 mouse tracking，alternate-screen 仅是渲染器内部状态，不再决定触摸所有权；Claude default 因未开启 mouse tracking 继续走原路径，Codex、Grok 和其他 TUI 仍被身份 guard 排除。
- Guard：`TestTerminalSizeSyncBehavior` 覆盖同客户端尺寸去重、PC 改写后 force claim、服务端尺寸差异和无效尺寸；`TestRuntimeTerminalSizeClaimSurvivesCrossClientResize` 固定 socket、移动端生命周期和首个 touch 的尺寸声明顺序；`TestClaudeFullscreenTouchBehavior` 增加 alternate-screen 不一致时 Claude + mouse tracking 仍接管，以及 Claude default/Codex 排除。现有 iOS、Grok、通用 mouse tracking 和隐藏 pane resize 测试继续通过。
- 验证结果：`go test ./...`、相关 JavaScript 语法检查、`git diff --check` 和 `lzc-cli project release` 通过；真实 Lazycat iOS WebView 仍需按“手机打开 Claude fullscreen -> PC 打开同一 pane -> 手机回到前台”顺序复验第一次滑动、第一次双击、长按选择、IME、Claude default、Codex 和 Grok。
- 禁止复现：不得用单客户端 `lastSentCols/Rows` 推断共享 PTY 当前尺寸；移动端重新活跃时必须能够声明尺寸所有权；不得重新把 alternate-screen replay 状态作为 Claude fullscreen 触摸硬门槛；不得在通用 PC mouse move 路径强制发送 resize。

### LCMD-20260728-02：Claude fullscreen 鼠标右键无法打开 WebShell 选项栏

- 日期：2026-07-28
- 来源：Claude Code fullscreen 桌面端现场问题；续接 `LCMD-20260727-01`
- 影响模块：Claude fullscreen adapter、通用终端 mouse tracking 与 WebShell context menu
- 错误现象：Claude Code 默认模式可以通过鼠标右键打开 WebShell 选项栏，进入 fullscreen 后右键没有任何选项栏；复制、粘贴、全选、搜索等现有菜单操作无法使用。
- 根因：Claude fullscreen 开启终端 mouse tracking 后，通用 mouse tracking 在 capture 阶段拦截右键 `mousedown`、`mouseup`、`auxclick` 和 `contextmenu`，将右键 press/release 发送给 PTY，并通过 `stopImmediatePropagation` 阻止事件到达后安装的 WebShell context menu 监听器。
- 实施方案：新增 Claude fullscreen 独立右键 adapter，仅在精确 Claude 身份、mouse tracking、真实鼠标右键且现有移动端 context menu guard 未要求抑制时声明事件所有权；右键按下、按住移动、释放、`auxclick` 和 `contextmenu` 都不再发送到 PTY。通用 mouse tracking 只识别中性的 `WeakSet` 事件所有权标记并跳过，不包含 Claude 分支；`contextmenu` 继续传播给现有 WebShell 选项栏。Claude 左键、滚轮、移动端长按、Claude default、Codex、Grok 和其他 TUI 保持原路径。
- Guard：`TestClaudeFullscreenContextMenuBehavior` 覆盖 Claude fullscreen 右键、完整按下/移动/释放序列、Claude default、Codex、左键、移动端 context menu 抑制与清理；`TestRuntimeClaudeFullscreenContextMenuIsolation` 固定 Claude adapter 在通用 mouse tracking 前安装，并禁止通用 mouse tracking 出现 Claude 专用判断。
- 验证结果：`go test ./...`、相关 JavaScript 语法检查、`git diff --check` 和 `lzc-cli project release` 通过；真实桌面浏览器仍需复验 Claude fullscreen 无选区和有选区时的右键菜单，以及左键、滚轮、拖动、Claude default、Codex 和 Grok。
- 禁止复现：不得在通用 mouse tracking 中直接加入 Claude 右键分支；不得只放行 `contextmenu` 而继续向 PTY 发送同一右键手势的 press/release；不得把触摸长按生成的 context menu 误判为真实鼠标右键。

### LCMD-20260728-03：Claude fullscreen 内部选区无法通过 WebShell 菜单复制

- 日期：2026-07-28
- 来源：`LCMD-20260728-02` 现场复验后的复制问题
- 影响模块：Claude fullscreen 桌面鼠标适配、Ghostty 本地选择、通用 mouse tracking 与桌面剪贴板
- 错误现象：Claude fullscreen 已能打开 WebShell 右键菜单，但普通左键拖动形成的高亮属于 Claude TUI 内部选区；点击菜单“复制”时 WebShell 的 `term.getSelection()` 为空，提示没有可复制选区或无法写入期望文本。
- 根因：Claude fullscreen 的 mouse tracking 在 `mousedown` 阶段取得左键手势所有权，press/move/release 全部发送给 PTY，Ghostty 本地 selection manager 无法建立选区。Claude 内部高亮状态不属于终端协议输出，也没有可供浏览器读取的文本范围；右键菜单只能复制 WebShell/Ghostty 本地选区，不能反向读取 Claude 进程内部状态。
- 实施方案：新增 Claude fullscreen 独立桌面选择 adapter，仅在精确 Claude 身份、mouse tracking 和非触摸选择布局中接管普通左键序列。按下后暂缓向 PTY 发送；移动未达到 4px 时在松开后补发原坐标和修饰键的 Claude press/release，保持点击功能；达到阈值后整段拖动留给 Ghostty 建立可复制的本地选区，不向 PTY 发送残缺鼠标序列。`Ctrl`、`Alt`、`Meta/Command` 修饰的左键继续走 Claude 原生 mouse tracking，移动端继续使用独立触摸 adapter 的滑动、双击键盘和长按选择。桌面选择和右键 adapter 共用中性的 `WeakSet` 事件所有权，通用 mouse tracking 不包含 Claude 判断；Codex、Grok、Claude default 和其他 TUI 不匹配。
- Guard：`TestClaudeFullscreenDesktopSelectionBehavior` 覆盖点击补发、拖动本地选择、右键隔离、触摸布局排除、Claude default、Codex、Grok、应用修饰键和 cleanup；`TestRuntimeClaudeFullscreenDesktopSelectionIsolation` 固定“右键 adapter -> 桌面选择 adapter -> 通用 mouse tracking -> 桌面剪贴板”的安装顺序，并要求通用 mouse tracking 在 down/move/up/click-like 阶段尊重本地事件所有权且不包含 Claude 分支。现有触摸、iOS 双击、跨客户端尺寸、右键菜单和 Grok guard 继续通过。
- 验证结果：`go test ./...`、相关 JavaScript 语法检查、`git diff --check` 和 `lzc-cli project release` 通过；真实桌面浏览器仍需复验 Claude fullscreen 单击、普通拖选、右键复制、自动复制开关、滚轮和修饰键鼠标，移动端仍需复验滑动、双击键盘、长按复制与 IME，并回归 Claude default、Codex 和 Grok。
- 禁止复现：不得尝试从 Claude 内部高亮反推文本；不得向 PTY 发送本地拖选手势的部分 press/move/release；不得让桌面选择 adapter 在触摸选择布局、Claude default、Codex、Grok 或其他 TUI 中启动；不得为复制修改移动端长按或 iOS 同步 focus 链路。

### LCMD-20260730-01：容器历史缓存存在但刷新后仍长期显示空终端

- 日期：2026-07-30
- 来源：WebShell 容器实例缓存体验现场反馈
- 影响模块：浏览器历史缓存、Ghostty replay/ready 状态机、Provider workspace/WebSocket 协议、persistent agent、PWA 静态资源
- 错误现象：IndexedDB 未被 iOS 清理时，刷新页面仍需要长时间等待空终端，无法在网络连接后快速看到已有历史；旧缓存路径在连接前读取全部 PTY 字节，且容器缓存只按 selector/pane 隔离，不能满足不同账号、workspace、tab 和历史 generation 的绝对隔离要求。
- 根因：旧缓存保存的是 PTY 原始字节而不是已渲染终端画面；`connectSession()` 在 WebSocket 前等待完整 IndexedDB 读取和待写事务，之后 Ghostty 仍要重新解析全部历史，canvas 又在 replay/fit/render 完成前保持隐藏。旧 IndexedDB 记录只有 selector/pane/generation，缺少账号 scope、workspace generation 和 tab 身份；单纯替换存储介质不会解决空白等待，也不能安全显示视觉状态。
- 实施方案：容器 agent 协议升级为 v7，workspace 和 replay 返回 cache protocol、opaque account scope、workspace generation、tab、pane 与 history generation，attach 无论 Cache API 是否可用都校验 workspace generation。浏览器容器路径改用独立 Cache API v2：只在连接前读取轻量 manifest，收到并验证 replay start 后并行显示精确 cursor 的视觉快照、流式回放不可变本地字节并暂存服务端 delta；replay、连续 cursor、缓存 commit、fit 和真实 canvas render 全部完成后才移除预览并开放输入。manifest 更新串行执行，字节/预览先写后提交 manifest，并增加超时降级、LRU/过期/孤立块清理和旧 generation 删除保护。Cache API 不可用时容器直接完整服务端 replay，绝不回退到隔离不足的 IndexedDB；`client:` 明确保留原 IndexedDB 协议且禁用预览。恢复链记录 manifest、WebSocket、preview、local/server replay、commit、真实 canvas/input ready 耗时及字节数，但不记录账号 scope 或终端内容。PWA Service Worker 只做静态资源 network-first/离线兜底，不缓存 API、WebSocket 或终端数据。
- Guard：`TestTerminalCacheV2Behavior` 执行 `terminal_cache_v2_test.mjs`，覆盖完整身份隔离、连续 cursor、缺块、preview checkpoint、manifest 并发回退、LRU/孤立块和旧 generation 删除；`TestRuntimeContainerCacheV2AndPWAContract` 固定容器/`client:` 分支、workspace attach 身份、预览输入锁、PWA network-only 与静态资源更新策略；`TestAgentHistoryReplayFramesIncludeSelectorAndPane`、`TestPaneForAttachRejectsStaleWorkspaceGeneration`、`TestTerminalCacheScopeIDSeparatesAccounts` 和 client terminal 测试覆盖服务端协议与边界。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 7/7 通过；`go test ./...`、`git diff --check` 和 `lzc-cli project release` 通过。LPK 内确认包含 manifest、Service Worker、PWA 图标和 cache-v2 模块，且不包含 Node 测试文件。当前环境没有浏览器自动化运行时；iOS Safari、主屏 PWA、Lazycat WKWebView、Android WebView 和桌面浏览器 warm-cache 页面级时序仍需按根目录计划真机验收。
- 禁止复现：网络 replay 身份确认前不得显示本地历史；容器不得回退到旧 IndexedDB；不得省略账号 scope、完整 selector、workspace/tab/pane/history generation 或 cursor 任一校验；旧 Promise、图片 decode、canvas capture 和删除操作不得修改新 session/generation；缓存失败只能触发服务端完整 replay，不能阻止真实终端 ready；Service Worker 不得以 cache-first 长期固定旧主程序或缓存终端运行数据；`client:` 未升级桌面 agent 前不得启用 cache-v2/视觉预览。

### LCMD-20260730-02：LPK 升级后旧 Service Worker 继续返回旧前端资源

- 日期：2026-07-30
- 来源：WebShell LPK 更新后的静态资源现场反馈；续接 `LCMD-20260730-01`
- 影响模块：Provider 静态路由、LPK 构建、HTML 入口、ES module/WASM/主题资源和 PWA Service Worker
- 错误现象：更新 LPK 后刷新或重新打开页面仍可能执行旧 JS/CSS，只有手动删除浏览器缓存或 Website Data 才能加载新前端；旧代码会连带保留旧终端恢复逻辑。
- 根因：`index.html` 固定引用 `/static/main.js`、`/static/style.css` 等不变 URL；已经安装的旧 Service Worker 可以继续 cache-first 命中这些请求。把新版 Worker 改为 network-first 不能修复仍在控制页面的旧 Worker，而只给入口 `main.js` 增加 query 也不能覆盖其相对 ES module、WASM 和主题依赖。
- 实施方案：构建阶段从 `package.yml` 提取顶层 LPK version 并写入运行目录 `.lpk-version`；Provider 优先读取该版本，开发环境回退到 `package.yml`，最后回退稳定内容哈希。`index.html` 保持 `no-store`，由 Provider 把全部入口引用注入为 `/assets/<version>/...`；版本化静态路由只接受当前严格校验版本并使用 immutable 缓存，旧 `/static/` 保留兼容。`main.js` 的相对 import 自动继承版本目录，WASM 和主题显式相对 `import.meta.url`。根作用域 Service Worker 的响应也注入当前版本，cache name 和预缓存清单按版本切换，并继续将导航、API、WebSocket 和终端 Cache URL 排除。旧 Worker 不匹配 `/assets/`，因此当前 HTML 可以直接绕过其旧 `/static/` cache。
- Guard：`TestComputeAssetVersionUsesLPKVersionFile`、`TestComputeAssetVersionFallsBackToPackageVersion`、`TestComputeAssetVersionUsesStableContentFallback`、`TestBuildWritesPackageVersionForRuntimeAssets`、`TestHandleIndexInjectsLPKVersionedAssetBase`、`TestVersionedStaticFileServerRequiresExactVersion` 和 `TestServiceWorkerIsServedAtRootScope` 覆盖版本来源、构建产物、HTML/Worker 注入、错误版本、路径穿越与缓存头；`TestRuntimeContainerCacheV2AndPWAContract` 固定版本化入口和 `/assets/` network-first 契约。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 7/7、`go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。`1.0.1` LPK 内 `.lpk-version` 正确，包含 manifest、Service Worker 和 cache-v2 模块且不包含 Node 测试。浏览器旧 Worker 到新版本路径的页面级升级仍需桌面和真机矩阵验收。
- 禁止复现：不得把新页面入口改回不带版本的 `/static/`；不得只版本化 `main.js` 而遗漏其 module/WASM/JSON 依赖；不得让 Service Worker 缓存页面导航、API、WebSocket 或终端数据；每次发布不同内容的 LPK 必须提升 `package.yml` version，同版本重打包不属于可识别的升级边界。

### LCMD-20260730-03：v6 agent 升级 v7 时 tar 无法覆盖旧二进制

- 日期：2026-07-30
- 来源：安装 cache-v2/v7 LPK 后容器 WebShell `/api/workspace` 502 现场日志
- 影响模块：Provider persistent agent 安装、旧协议升级和容器 workspace 启动
- 错误现象：Provider 正确识别已运行的 `lcmd-webshell-agent-v6` 不兼容并生成 v7 归档，但远端执行 `tar -xpf - -C /` 时报告 `/usr/local/bin/lcmd-webshell-agent: 文件已存在`；安装没有 ready marker，Provider 等待新 agent 超时，最终 WebShell 无法打开。
- 根因：升级流程把归档直接解压到最终安装路径，依赖目标环境 tar 覆盖一个已经存在且可能正在运行的二进制。该覆盖语义在目标系统不成立；同时 `lightosctl exec` 可能不透传远端 tar 的退出码，因此 trace 会记录命令成功但仍因缺少 ready marker 判定安装未完成。
- 实施方案：安装脚本改为在 `/usr/local/bin/.lcmd-webshell-agent.install.<pid>` 创建同文件系统 staging 目录，先完整解包归档，检查 agent/manifest 均存在且 manifest 精确匹配期望值，再设置权限并用 `mv -f` 先原子替换 agent、最后提交 manifest。任何中途失败由 trap 清理 staging，旧最终文件保持不变或 manifest 保持旧值，后续请求可以安全重试。修复 LPK version 提升到 `1.0.1`。
- Guard：`TestAgentInstallScriptReplacesExistingBinary` 使用真实 `/bin/sh`、tar 和已有旧文件验证升级后内容、manifest、0755 权限及 staging 清理；`TestEnsureAgentBinaryInstalledVerifiesCacheHit` 禁止恢复直接 `tar -C /` 覆盖，并固定安装入口必须调用 staging 脚本。
- 验证结果：`TestAgentInstallScriptReplacesExistingBinary` 已通过真实 shell/tar/mv 覆盖旧文件场景；`node --check`、Node cache-v2 行为测试 7/7、`go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。已生成并核对 `1.0.1` LPK。目标 LightOS 实例仍需安装该包后确认 v6 -> v7、workspace、WebSocket replay 和旧会话不复用提示。
- 禁止复现：不得直接向最终 agent 路径解包；不得在新二进制校验完成前写入新 manifest；不得把 lightosctl 命令退出码当作唯一成功依据，必须继续要求精确 ready marker。

### LCMD-20260730-04：warm cache 预览仍等到真实终端 ready 后才出现

- 日期：2026-07-30
- 来源：`1.0.1` warm-cache 页面现场反馈，终端右上角灰色连接点消失前始终空白
- 影响模块：浏览器 Cache API v2 preview 预读、WebSocket replay 身份确认、终端 preview/真实 canvas 切换和恢复性能指标
- 错误现象：本地已有终端字节缓存和视觉快照时，重新打开仍显示空终端；只有 history replay、fit 和真实 canvas render 完成、右上角灰点结束后才看到内容，视觉上等同没有首帧缓存。
- 根因：前端直到收到 `history-replay-start` 才开始从 Cache API 读取 preview Blob 并执行 PNG decode，无法利用 workspace/agent 连接等待时间。显示前还要求缓存的 cols、rows、DPR、主题、canvas width/height 与启动瞬间全部精确相等；移动浏览器 viewport settle、DPR 或 fit 的轻微变化会静默返回 false。cache-v2 分支调用 preview/replay 时 `replayVerified` 也尚未显式设为 identified，只依赖异步 Cache API 恰好晚于当前消息栈完成。
- 实施方案：读取 cache-v2 manifest 后立即异步读取 Blob，并用独立 `Image` 提前 decode，但不写入可见 DOM；prepared preview 绑定完整 cache identity、history generation、end cursor 和 prepare sequence。服务端 replay start 再次验证 selector/account scope/workspace/tab/pane/history generation/cursor 后，先设置 identified，再把已解码 object URL 同步交给 preview element。尺寸、DPR或主题不一致不再拒绝同身份预览，而由现有 `object-fit: contain` 和终端背景安全承载，真实 canvas ready 后单帧移除。session 关闭、cache reset/disable、身份变化和真实 canvas ready 都会撤销 prepared/shown URL。指标新增 preview prepared、layout match 和 miss reason。
- Guard：`TestRuntimeContainerCacheV2AndPWAContract` 固定 manifest 后预读、prepared preview 状态、服务端身份确认必须早于 `beginSessionCacheV2Replay`、恢复指标和“布局漂移不能作为拒绝同身份预览的理由”；现有 cache-v2 行为测试继续固定完整身份和 cursor 隔离。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 7/7、`go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。已核对 `1.0.2` LPK 的 `.lpk-version` 和前端资源，Node 测试未进入包。当前环境没有页面级浏览器运行时，真实 warm open 仍需观察 recovery metrics 中 `previewHit=true` 且 `previewVisibleMs < realCanvasVisibleMs`。
- 禁止复现：不得在 replay start 后才首次读取/解码 preview；预读结果不得在服务端完整身份确认前进入可见 DOM；不得因同一会话的 viewport、DPR、主题或 canvas 尺寸漂移直接放弃预览；不得让旧 prepare Promise 或 object URL 跨 session/generation 显示。

### LCMD-20260730-05：Cache API 图片存在但 snapshot 恢复期间仍保持空白

- 日期：2026-07-30
- 来源：`1.0.2` warm-cache 现场复验；浏览器诊断确认 5 个 manifest 均有 preview，Cache Storage 共 2013 个 key，精确对应 2003 个 chunk、5 个 manifest 和 5 个 preview
- 影响模块：容器 `history-replay-start` 分支、snapshot 缓存重置、preview 授权生命周期和恢复诊断
- 错误现象：Cache API 的字节块和图片记录都实际存在，但反复打开页面仍要等右上角灰色连接点消失后才显示画面；现有预览只在服务端接受本地范围并进入 `cache-v2 delta/current` 分支时调用，服务端选择 `snapshot` 时完全不会挂载图片。
- 根因：实现把“本地 PTY 字节是否可作为增量状态来源”和“同一会话视觉快照是否可作为不可交互等待画面”错误绑定为同一个条件。`snapshot` 表示本地字节不能参与状态恢复，并不表示已经通过服务端完整身份与 history generation 验证的 preview 属于其他会话；同时 snapshot 分支立即重置 manifest，会撤销仍在解码的 preview Promise。
- 实施方案：新增独立 preview replay 授权。`delta/current` 继续要求 manifest end 精确等于 `delta_from_cursor`；`snapshot` 只允许完整账号 scope、selector、workspace、tab、pane、history generation 全部匹配，且本地 end 不超过服务端 end 的 preview 显示。snapshot 仍完全使用服务端字节重建隐藏 Ghostty，不读取本地字节作为状态来源，输入继续锁到 replay、缓存提交、fit 和真实 canvas render 全部完成。已授权 preview 在 snapshot manifest 重置期间保留于内存；若图片仍在解码，重置等待该受限 Promise 结束后再删除旧 Cache 记录。新增不含身份和内容的 JSON `preview decision` 与 `preview visible` 日志，直接记录 sync mode、是否授权、是否已预解码和 DOM 图片是否完成挂载。LPK version 提升到 `1.0.3`。
- Guard：`TestRuntimeContainerCacheV2AndPWAContract` 固定 snapshot 顺序必须是终端 reset、服务端 identified、preview reveal、manifest reset，并要求 DOM reveal 绑定精确授权的 snapshot 对象；同时固定 snapshot 的服务端 end 上界、delta/current 的精确 cursor 和 preview prepare 跨 reset 保留规则。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；cache-v2 定向契约测试、完整 `go test ./...`、`git diff --check` 与 `lzc-cli project release` 均通过。已生成 `cloud.lazycat.webshell.lcmd-v1.0.3.lpk`，包内 `.lpk-version` 为 `1.0.3` 且包含 snapshot preview 授权代码，SHA-256 为 `15a730debe352009d4439f9f39e207b27cf3c278f69767446b1dfa76b3f504b8`。当前命令行环境仍没有页面级浏览器运行时，现场需要确认 `preview decision` 为 `authorized:true`、随后出现 `preview visible`，且 preview 在灰点消失前出现。
- 禁止复现：不得重新把 preview 可见性限定为 delta/current；snapshot preview 不得参与 Ghostty 状态恢复或开放输入；不得放宽完整身份/history generation 校验；不得显示 checkpoint 超前于服务端 end 的图片；不得让 snapshot manifest reset 抢先删除同一次已授权但仍在解码的 preview。

### LCMD-20260730-06：取消 preview 等待门槛，缓存字节直接恢复 Ghostty canvas

- 日期：2026-07-30
- 来源：`1.0.3` 现场复验仍然只有灰点消失后才显示内容；用户明确要求本地字节流直接渲染，网络成功后只接续增量
- 影响模块：容器启动恢复状态机、Ghostty canvas ready、Cache API chunk 读取、WebSocket delta/current/snapshot 合并和输入锁
- 错误现象：即使 Cache API 中存在完整字节和 preview，前端仍把任何可见内容绑定在服务端 replay 状态之后；连接或 agent attach 慢时，终端持续空白。图片 preview 路径增加了另一套授权、解码和 DOM 切换状态，却没有兑现“本地字节直接恢复终端”的目标。
- 根因：`replayComplete` 同时承担 canvas 可见和输入可用两个职责，导致本地 Ghostty 已经可以恢复时仍被 CSS 隐藏；cache-v2 字节直到 `history-replay-start` 后才读取，并且服务端 delta 分支会重置 Ghostty再回放一次。大量历史被拆成上千个 Cache 记录时，`readChunks` 又逐个串行 `cache.match()`，本地读取本身也会产生明显等待。
- 实施方案：在 workspace HTTP 响应提供完整当前身份、manifest 校验通过后，WebSocket 构造前立即启动 cache-v2 warm replay。32 路并发读取不可变 chunk，但严格按 cursor 顺序送入 Ghostty；本地 replay 到 manifest end 后直接 full render 并允许 canvas 在灰点存在时显示。新增独立 `cacheV2WarmReplayReady`，只放宽 canvas ready，`isSessionInputReady` 仍要求服务端 `replayComplete` 和 OPEN socket。服务端 `delta/current` 验证 generation/end cursor 后复用已恢复状态，仅追加网络字节；服务端 `snapshot` 保持当前本地 canvas，内存收齐完整权威 snapshot 后在同一任务内重置并批量回放，再等待缓存提交和最终 render 开放输入。warm replay 失败、身份不匹配、cursor 不连续、pane 销毁和 viewport 强制重放都会取消旧 Promise、隐藏不可信 canvas 并降级服务端 snapshot。启动不再预读或显示视觉 preview。LPK version 提升到 `1.0.4`。
- Guard：`TestRuntimeContainerCacheV2AndPWAContract` 固定本地 range 后、WebSocket 构造前启动 warm byte replay；固定 warm canvas 可以绕过 `replayComplete` 的显示门槛但绝不能进入输入门槛；固定 delta/current 复用已恢复状态、snapshot 完成后原子替换，以及启动链不得调用 preview prepare。`terminal_cache_v2_test.mjs` 新增并发读取测试，要求并发度生效但回调顺序仍严格连续。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 8/8、完整 `go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。已生成 `cloud.lazycat.webshell.lcmd-v1.0.4.lpk`，包内 `.lpk-version`、warm byte replay、snapshot 原子替换和 32 路并发读取代码均已核对，Node 测试文件未进入包，SHA-256 为 `8f02b77f5e49ee58ca0257f8b7858d5fc7f6402161973826e12709d855b4880e`。当前环境没有页面级浏览器运行时，现场应在灰点仍存在时先看到 canvas，并观察 `warm canvas ready`、`warm canvas visible` 日志早于最终 recovery metrics。
- 禁止复现：不得再次要求 WebSocket replay start/complete 才读取本地 cache-v2 字节或显示本地 Ghostty canvas；不得把 warm canvas ready 等同输入 ready；不得在 delta/current 已有 warm 状态时清空或重复回放本地字节；不得把本地字节叠加到服务端 snapshot；不得把并发 Cache 读取改成乱序回放；不得在缺少完整 workspace 身份时按 pane 最近记录猜测缓存。

### LCMD-20260730-07：首批缓存字节立即成帧，并补齐未激活 tab 总览

- 日期：2026-07-30
- 来源：`1.0.4` 现场复验；首个进入的 tab 已不受连接灰点阻塞，但仍先显示黑色终端，其他 tab 打开后可秒开；终端总览只有逐个打开过 tab 后才出现对应画面
- 影响模块：Cache API 分批读取、Ghostty warm render ready、workspace 后台预热、tab 总览缩略图和完整身份隔离
- 错误现象：首次进入页面时，本地字节 replay 必须读取并解析到 manifest end 后才第一次 full render，因此在此之前只能看到终端背景。总览直接复制 pane 的 live canvas；隐藏 tab 从未完成可测量 fit 和 replay，canvas 仍是空画布，导致用户必须逐个打开 tab 才能补齐总览。
- 根因：`cacheV2WarmReplayReady` 仍同时表示“已经产生可见本地帧”和“本地 range 已完整到达 manifest end”，没有更早的只读显示状态。Cache API `readChunks` 也未暴露并发批次边界，前端只能在全部读取结束后统一 flush。总览没有独立数据源，也没有使用 cache-v2 manifest 中已按完整身份提交的 preview 记录。
- 实施方案：`readChunks` 为每个有序回调增加 `chunkIndex/chunkCount/batchEnd`。warm replay 在批次结束时 flush 已排序字节，当前 Ghostty viewport 一旦出现可见内容就设置独立 `cacheV2WarmFrameReady`、同步 full render 并记录 `warm canvas first frame`；剩余 chunk 继续读取，只有到 manifest end 才设置 `cacheV2WarmReplayReady`。两个 warm 状态都只放宽 canvas 显示，输入继续只依赖 `replayComplete + renderReady + OPEN socket`。workspace 应用后后台为全部容器 pane 读取轻量 manifest 和总览图片；总览优先使用已完成的 live canvas，否则只在账号 scope、selector、workspace、tab、pane、history generation 全部匹配时使用缓存缩略图。总览图片不进入终端 DOM、启动恢复或同步计算。LPK version 提升到 `1.0.5`。
- Guard：Cache API Node 测试固定 32 路读取仍按 cursor 有序，并验证每个并发 batch 的末尾标记；`TestRuntimeContainerCacheV2AndPWAContract` 固定首批 frame 状态、可见内容检查、输入门禁不读取任何 warm 状态、总览 preview 的完整身份验证、snapshot 对象生命周期和 live canvas/cached preview 选择规则。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 8/8、完整 `go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。已生成 `cloud.lazycat.webshell.lcmd-v1.0.5.lpk`，包内 `.lpk-version`、首批 warm frame、总览缩略图身份校验、32 路读取 batch metadata 和测试文件排除均已核对，SHA-256 为 `f0195ecdc86bcf6e1bb1f7557b527cfc133e06d9f97b5a58baaa787f13a0eb78`。当前环境没有页面级浏览器运行时，现场仍需验证第一个 tab 不再先停留黑屏、未打开 tab 的总览直接出现，并确认总览不会跨完整身份显示旧图。
- 禁止复现：不得重新把第一次 canvas render 推迟到全部本地 chunk 完成；不得让 `cacheV2WarmFrameReady` 进入输入门禁或冒充 manifest end；不得在总览中无条件复制空 live canvas；不得按 pane ID、最近记录或缺失账号/workspace/tab/history 身份的 key 读取缩略图；总览 preview 不得重新进入终端启动显示链。

## 新增记录模板

```md
### LCMD-YYYYMMDD-NN：问题标题

- 日期：YYYY-MM-DD
- 来源：commit/PR/issue/现场问题编号
- 影响模块：浏览器、Provider 后端、agent、客户端终端或目标环境
- 错误现象：用户可见结果、触发条件和影响范围
- 根因：导致错误的状态、协议、时序、权限、缓存或平台原因
- 实施方案：最终采用的修复及关键顺序/边界
- Guard：新增或更新的测试名称；无法自动化时写设备和可重复步骤
- 验证结果：执行的命令、设备/浏览器/系统和结果
- 禁止复现：后续修改不得破坏的不变量
```
