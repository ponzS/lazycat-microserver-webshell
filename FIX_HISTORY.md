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
- 页面静态资源位于 `runtime/static/`，随二进制一起打包。HTML 禁止缓存并由 Provider 注入当前资源版本路径；独立 LPK 使用 `<lpk-version>-<content-revision>`，缺少构建元数据的内嵌/开发环境使用内容哈希。新页面通过该内容寻址的 `/assets/<asset-version>/` 读取 JS/CSS/JSON/WASM/manifest/图标并使用 immutable 缓存，旧 `/static/` 只保留兼容和可重验证策略。
- PWA Service Worker 由 Provider 注入当前 LPK 版本与资源基路径；当前版本的 immutable 静态资源执行 cache-first，版本 URL 变化负责更新，缓存未命中或旧版本资源才访问网络，非成功响应可以回退已有静态缓存。页面导航、`/api/*`、`/ws` 和终端虚拟 Cache URL 不进入 app-shell 缓存。

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
- Ghostty renderer 在修改 canvas 前必须一次性物化当前可见活动屏幕和 scrollback 行；活动 viewport 每帧只导出一次。任一可见行缺失时保留上一帧和 dirty 状态，由事件驱动 scheduler 退避重试，失败帧不得触发成功 `onRender` 或 pane presented generation 推进。
- tab 总览不得只复制已经激活过的 live canvas。未激活 pane 可以按完整 cache-v2 身份读取已提交的图片缩略图，但缩略图只用于总览，不能参与终端启动显示、Ghostty 状态恢复或输入就绪判断。
- 服务端接受本地 range 时，`delta/current` 必须复用已经恢复的 Ghostty 状态，不得再次清空和重复回放本地 chunk。服务端返回 `snapshot` 时，保持已显示的同身份本地 canvas，先在内存收齐服务端 snapshot，再一次性重置并回放权威字节；本地缓存字节不得参与 snapshot 状态计算。
- 已经呈现且身份仍有效的终端画面是网络故障期间的 last-known-good 状态。HTTP 502、Agent 不可用、WebSocket close/error、workspace refresh 重试和历史 snapshot 等待不得清空或隐藏该画面；输入继续锁定。只有成功的权威 workspace 响应确认账号/实例/workspace/tab/pane 身份变化、pane 被删除，或收到与当前会话不匹配的数据时才能销毁旧呈现。
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

### LCMD-20260731-01：历史裁剪后 canvas 只显示底部内容，resize 才恢复

- 日期：2026-07-31
- 来源：`1.0.5` 现场复验；页面重载约 10% 概率出现终端上半部分纯黑且仍可滚动，继续输出时部分已存在历史从画面消失，调整窗口尺寸后无需重新拉取即可恢复受行数限制的完整历史
- 影响模块：Ghostty Screen/WASM scrollback ABI、WebShell 定制 Ghostty viewport 锚点、Cache API warm replay 批次刷新和 pane canvas 呈现状态
- 错误现象：缓存字节已经进入 Ghostty/WASM，但历史达到容量并裁剪旧页时，canvas 可能只在底部绘制最新一段内容，上方留下可滚动的黑区；刷新仍可能保持错误画面，只有 resize 触发整帧重绘后恢复。大量 warm replay 时首批之后的 chunk 也可能一直积压到最终 flush，削弱渐进显示并放大错误窗口。
- 根因：前端仅以 `getScrollbackLength()` 的差值判断新增历史；达到逻辑或物理容量后，新行进入历史与旧行裁剪同时发生，长度保持不变，viewport 因而没有随历史前进。Ghostty 已请求的 full render 又会被 replay 写入后的 rAF 取消逻辑清除。WebShell 只在首个可见 batch 和 manifest end 强制 flush/render，且 pane current 判断只绑定 fit/replay generation，没有绑定实际终端内容代际，旧 canvas 可以在内容继续变化后仍被视为 current。
- 实施方案：Ghostty `Screen` 增加可回绕的 `scrollback_generation`，普通屏幕每有一行进入历史即递增，并通过 C/WASM ABI 暴露；JS 使用无符号 generation 差值维护历史 viewport，generation 前进时要求 full redraw。容器 cache-v2 warm replay 在每个 32-chunk 有序批次末尾都强制 flush 并同步 full render，首个有内容批次仍单独标记 warm frame。pane 增加 terminal/pending/presented content generation，只有当前内容已真实绘制才允许 presentation 判定为 current；取消旧 rAF 时保留已有 full-render 意图，同步 full render 完成后再消费该意图。LPK version 提升到 `1.0.6`。
- Guard：Ghostty `Scrollback Viewport Stability` 测试覆盖可见 scrollback 长度保持不变时的历史锚点，以及活动屏幕删除行不得推进 generation；Ghostty `test-lib-vt` 覆盖 `Screen` 的普通滚屏、区域滚屏和 clear-to-history 计数。`TestRuntimeContainerCacheV2AndPWAContract` 固定每个 `batchEnd` 都 flush/render；`TestRuntimeTerminalCanvasResidueGuard` 固定 WASM generation 导出、定制 bundle 的无符号 generation 差值/full redraw、pane content generation 和 full-render 取消保留逻辑。
- 验证结果：Ghostty `prettier --check`、Biome、TypeScript、380 个 Bun 测试和正式 build 通过；`zig build test-lib-vt -Dtarget=x86_64-linux-gnu.2.28` 与 wasm32 ReleaseSmall 构建通过，WASM 导出表已确认包含 `ghostty_terminal_get_scrollback_generation`。WebShell 的 Node cache-v2 行为测试 8/8、相关 JavaScript 语法检查、完整 `go test ./...`、`git diff --check` 和 `lzc-cli project release` 均通过。已生成 `cloud.lazycat.webshell.lcmd-v1.0.6.lpk`，包内 `.lpk-version`、generation WASM 导出、逐 batch render 和 content generation 已核对，SHA-256 为 `b6b9608c53664faf161df32cc3293442be0bd20035e9358836d4cff69020f49c`。真实浏览器仍需复验长历史重载、持续输出、滚动停留和 resize 前后画面一致性。
- 禁止复现：不得再用保留历史长度代替历史前进量；达到 scrollback 上限后 generation 仍必须递增。不得在取消 replay rAF 时丢弃已请求的 full render；不得只渲染 warm replay 的首批和最终批次；不得在 presented content generation 落后时把 pane 视为 current。resize 只能作为恢复验证，不得成为正常渲染依赖。

### LCMD-20260731-02：LPK 热更新后 Provider 继续发布旧 JS/WASM

- 日期：2026-07-31
- 来源：`1.0.6` 现场复验仍出现 `LCMD-20260731-01`，用户怀疑 WASM 未更新；包内和工作区 WASM 均确认包含 `ghostty_terminal_get_scrollback_generation`
- 影响模块：Provider 版本化静态路由、首页与 Service Worker 注入、server revision 轮询、Ghostty WASM 初始化兼容性
- 错误现象：LPK 中 `ghostty-vt.wasm` 已是新文件，但升级后浏览器仍可能执行旧 `main.js`、旧 `ghostty-web.js` 和旧 WASM，继续出现历史只渲染底部、resize 后恢复；清理浏览器缓存后才可能切到新文件。
- 根因：Provider 在进程启动时只计算一次 `assetVersion` 和 `serverRevision`。LPK 热更新若没有重启 Provider，首页和 Service Worker 仍注入 `/assets/<旧版本>/`，静态 handler 也只接受旧版本 URL；该 URL 带一年 `immutable`，浏览器因此持续复用旧资源。固定 `serverRevision` 又使现有轮询无法发现 LPK 文件已经切换。Ghostty JS 对 generation ABI 缺失还会静默回退到 scrollback 长度差，使现场看不到明确的版本不兼容错误。
- 实施方案：Provider 每次请求都优先读取当前 `.lpk-version`/`package.yml`；首页、Service Worker 和 `/assets/` handler 使用同一次请求解析出的当前版本，版本切换后旧 asset URL 立即 404，新 URL 继续 immutable。对外 server revision 在稳定进程 revision 后拼入当前 asset version，workspace、activity 和 revision observation 全部使用动态值；前端也直接比较前后 revision，不能持久化 revision 状态的 target 同样能提示刷新。Ghostty 初始化强制要求 `ghostty_terminal_get_scrollback_generation`，缺失时抛出明确错误，并移除长度差 fallback。LPK version 提升到 `1.0.7`。
- Guard：`TestVersionedStaticFileServerTracksLPKVersionWithoutRestart` 模拟同一 handler 运行期间改写 `.lpk-version`，固定旧 URL 404/新 URL 200；`TestDynamicAssetResponsesTrackLPKVersionWithoutRestart` 固定首页、Service Worker 和 server revision 同步切换；`TestRuntimeTerminalCanvasResidueGuard` 固定 runtime WASM ABI 硬校验、禁止长度差 fallback，并要求前端主动比较 revision。Ghostty `Ghostty WASM compatibility` 测试覆盖缺失 generation 导出时必须失败。
- 验证结果：`go test ./...`、Node cache-v2 8/8、运行时 JavaScript 语法检查、Ghostty Prettier/Biome/TypeScript、两个仓库的 `git diff --check` 和 `lzc-cli project release` 均通过；当前环境没有 Bun，因此新增 Ghostty Bun 单测未单独执行，但同一兼容性分支已通过运行时 bundle 的 Node 构造测试。已生成 `cloud.lazycat.webshell.lcmd-v1.0.7.lpk`，SHA-256 为 `54be66f9c5d91cc4c78432f04d6e45207a14ba0d9dd10921ffcd6bc482715e8c`；包内 `.lpk-version` 为 `1.0.7`，WASM SHA-256 与工作区一致为 `04c1a6f1ae963c4665886073d275d373d1b1f3b81bf71952b4f4ff77c537129a`，导出表包含 generation API，JS bundle 包含硬校验、动态 revision 比较和无 fallback generation 逻辑。由于旧 `1.0.6` Provider 本身没有动态版本逻辑，如果平台升级 LPK 时不自动重启 Provider，从 `1.0.6` 升到 `1.0.7` 需要让 Provider 至少重启一次；新 Provider 生效后，后续纯前端资源版本切换无需依赖清理浏览器缓存。
- 禁止复现：不得在 Provider 启动时冻结对外 asset version；不得让旧版本 asset URL 在 `.lpk-version` 变化后继续返回新文件；不得只修改 Service Worker 而遗漏首页、静态 handler 和 server revision；不得在 generation ABI 缺失时退回 scrollback 长度差并继续运行。

### LCMD-20260731-03：普通 PTY 输出发生整屏位移时只重画底部脏行

- 日期：2026-07-31
- 来源：`1.0.7` 现场复验；多次刷新可高概率复现终端上半部分为可滚动黑区，且不只发生于初始化，Agent 持续输出内容时也会出现；调整窗口尺寸后无需重新获取字节即可恢复完整画面
- 影响模块：Ghostty Web canvas render 调度、WebShell 缓存回放、WebSocket PTY 批量输出和即时错误输出
- 错误现象：终端模型中仍保留受行数限制的历史内容，但 canvas 偶发只显示底部最新一段，上方为纯黑且仍可滚动；继续输出时已有画面也可能消失。resize 强制整帧绘制后内容立即恢复，说明不是 Cache API、IndexedDB、WASM 数据丢失或单纯首次 fit 失败。
- 根因：`scrollback_generation` 只能识别有新行进入历史，不能完整表达活动屏幕行删除、插入、滚动区域滚动及部分控制序列造成的多行像素位移。Ghostty renderer 的局部 dirty row 范围在这些组合状态下可能只覆盖底部新行；旧区域已被清除或发生逻辑位移，却没有被重新绘制，因此留下黑区。此前只在 generation 前进、回放批次结束或 resize 时要求 full render，普通 Agent 输出仍可能走不完整的局部重绘。
- 实施方案：所有进入 Ghostty 的 PTY 输出均在 write 后合并请求下一动画帧 full render；Ghostty Web 的 `writeInternal` 本身无条件设置 full-render 意图，WebShell 的队列批量输出与即时输出路径再显式固定该契约。缓存 replay 取消待执行 rAF 时保留 full-render 标记，并继续在有序批次边界同步整帧绘制。多个 write 在同一动画帧内只合并为一次整帧绘制，不按字节或单条 WebSocket 消息重复绘制。
- Guard：Ghostty `active-screen line edits do not move a history viewport` 同时断言 generation 不变、历史 viewport 不移动且下一帧仍必须 full render；`TestRuntimeTerminalCanvasResidueGuard` 要求定制 bundle 的每次 write 无条件 full render，要求 WebShell 队列和即时输出路径均显式请求 full render，并禁止恢复 generation-only 的 `this.requestRender({ full: s })`。
- 验证结果：`node --check` 通过 `runtime/static/main.js`、`runtime/static/ghostty-web.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 8/8、完整 `go test ./...`、Ghostty Prettier/Biome/TypeScript 和两个仓库的 `git diff --check` 均通过。`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.8.lpk`，包内 `package.yml` 与 `.lpk-version` 均为 `1.0.8`，Ghostty write、WebShell 队列输出和即时输出的 full-render 路径均已核对；包内 WASM SHA-256 为 `04c1a6f1ae963c4665886073d275d373d1b1f3b81bf71952b4f4ff77c537129a` 且包含 generation 导出，LPK SHA-256 为 `223a2a5ca4e0c08e609667607c7a9484161c2c381ef32da97f23025992d7fa90`。当前环境没有 Bun，Ghostty Bun 单测无法执行；真实浏览器仍需复验多次刷新、长历史缓存回放和 Agent 持续输出期间不再出现黑区。
- 禁止复现：不得再以 scrollback generation 是否变化作为 PTY 输出需要整帧绘制的唯一条件；不得让 replay 的 rAF 取消路径清除尚未消费的 full-render 意图；不得把修复退化为逐字节同步绘制。resize 只能作为结果对照，不能成为恢复终端历史画面的正常依赖。

### LCMD-20260731-04：越界 viewport 导致终端上半屏被当作不存在的历史行

- 日期：2026-07-31
- 来源：`1.0.8` 现场稳定复现；续接 `LCMD-20260731-03`，全量 full render 后问题仍存在
- 影响模块：Ghostty Web viewport/平滑滚动状态、Canvas renderer、定制 WASM RenderState ABI、WebShell 运行时 bundle
- 错误现象：刷新、缓存回放或 Agent 持续输出时，终端偶发且可稳定复现上半部分纯黑、仅底部显示最新内容；黑区仍可滚动，但高度小于真实历史。继续 full render 无法恢复，调整窗口大小后立即恢复，且无需重新拉取历史字节。
- 根因：Ghostty Web renderer 信任传入的 `viewportY`，没有在每帧绘制前按当前 `scrollbackLength` 重新约束。当回放、平滑滚动、history trim 或尺寸/状态切换留下 `viewportY`/`targetViewportY` 大于当前历史长度时，顶部行会计算出负的 scrollback offset；取行返回 `null`，而 full render 已先清空 canvas，因此顶部保持纯黑，只在底部绘制活动屏幕。WebShell 的 `resizePane()` 会通过 `restoreTerminalViewport()` clamp 这两个值，所以 resize 看似“重新渲染历史”并立即恢复。另一个一致性风险是定制 `ghostty_render_state_get_viewport` 在 `RenderState.update()` 后仍绕过官方 `row_data`，直接读取 `active.pages`，使页重排时导出帧不再遵循 Ghostty 的 viewport 快照。
- 实施方案：Canvas renderer 每次绘制前调用 Terminal 的 `normalizeViewportBounds()`，原子地把当前 viewport 和平滑滚动 target 限制到 `[0, scrollbackLength]`，再计算历史 offset、fractional scroll 和 scrollbar；运行时定制 bundle 同步相同逻辑。WASM viewport 与 grapheme 导出改为只读取官方 `RenderState.row_data` 中已复制的 raw cell、style 和 grapheme，不再重新 pin `active.pages`。Ghostty Web 增加 render-state freshness 标记，在 write/resize 后失效、update 后提交；直接调用 `getViewport/getGrapheme` 时只在快照过期时补一次 update，保持旧 API 的即时读取语义且避免每个 grapheme 重复同步。LPK version 提升到 `1.0.9` 并携带新 WASM。
- Guard：Ghostty `render clamps stale viewport state to retained scrollback bounds` 人为注入越界 viewport/target 并要求一次 render 即同时修正；Zig `render state viewport export follows the official viewport snapshot` 将 Ghostty viewport 固定在 history top，要求导出结果与 `RenderState.row_data` 相同且明确不同于 active area；既有 Grapheme Cluster Support 测试固定 write 后直接读取 viewport/grapheme 仍返回新内容；WebShell `TestRuntimeTerminalCanvasResidueGuard` 固定运行时 bundle 必须在 renderer 入口调用 `normalizeViewportBounds()`，并保留 render-state freshness guard。
- 验证结果：Ghostty WASM `ReleaseSmall wasm32-freestanding` 重新构建通过；Zig `test-lib-vt -Dtarget=x86_64-linux-musl -Dtest-filter='render state viewport export follows the official viewport snapshot'` 通过；Ghostty Web 全量 Bun 测试 `382/382`、Prettier、Biome、TypeScript 和 Vite production build 通过，包含 ESC reset/滚屏压力测试及越界 viewport 回归。`node --check runtime/static/ghostty-web.js`、完整 `go test ./...` 和两个仓库 `git diff --check` 通过。`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.9.lpk`，包内 `package.yml` 与 `.lpk-version` 均为 `1.0.9`；包内 WASM SHA-256 为 `65a99188312ad92780b3af2fa410b8af395536dfe1e777ec24573d8be1436f16`，运行时 Ghostty bundle SHA-256 为 `1a8cf2df40b252eca546bf0e943cfd1b74990dc77407f8a914e6e9f169ae49e5`，LPK SHA-256 为 `e2004f2a13bc9b06caf8aaaae2ffbc312e6204acc838489e6526a6513def445c`。真实浏览器仍需复验连续刷新、缓存首帧和 Agent 持续输出期间不再出现顶部黑区。
- 禁止复现：renderer 不得用未经当前 scrollback 长度校验的 viewport 计算历史 offset；修复不得只放在 resize、首次 fit 或 WebShell 外层，因为普通输出和库调用同样会进入该状态；WASM `render_state_get_viewport/get_grapheme` 不得再次绕过 `RenderState.row_data` 直接读取活动 PageList。

### LCMD-20260731-05：502/Agent 故障期间销毁终端最后一帧并中断恢复

- 日期：2026-07-31
- 来源：现场反馈；终端运行中偶发突然黑屏，控制台同时出现 workspace 502，PWA 无法保留离线终端观感
- 影响模块：Provider 到 persistent agent 的 HTTP/WebSocket 控制面、浏览器 workspace 重试、PTY 退出协议、Ghostty canvas 呈现和历史增量恢复
- 错误现象：Agent、`lightosctl`、socket 或 workspace 请求短暂不可用时，部分 attach 基础设施错误被包装为非重试 `process-exit`。浏览器收到后先删除历史缓存并销毁 pane，再只请求一次 workspace；该请求若返回 502，页面永久留下黑屏。历史校验和缓存重放失败还会通过 `markPaneRenderPending()` 主动 clear renderer/canvas，并由 `renderReady=false` CSS 隐藏已经成功呈现的画面。普通 WebSocket 重连虽然支持 `current/delta`，这些破坏性分支却会丢弃本地 cursor 并退化为黑屏 snapshot。
- 根因：连接、同步、呈现和会话身份共用同一套 ready/reset 状态；基础设施故障与权威 PTY 退出没有稳定协议边界；workspace refresh 没有持续退避重试；pane 销毁发生在权威 workspace 确认之前。
- 实施方案：Provider attach 的 Agent ensure、pipe、start 和转发错误统一发送可重试 `connection-error`，pane not found 改为请求 workspace refresh；真实 PTY 退出帧标记为 authoritative。浏览器增加独立 workspace 指数退避重试，网络恢复时恢复全部已有 pane；`connection-error` 和普通 close/error 只断开、锁输入并使用现有 history generation/cursor 重连，继续优先选择 `current/delta`。非重试 `process-exit` 只标记 pending exit并保留最终画面，成功 workspace 响应确认 pane 不存在后才执行原有 cache/pane 清理。`markPaneSyncPending()` 不再清 canvas；CSS 只隐藏从未产生过真实帧的 canvas。已有画面需要 snapshot 时先收齐网络字节，并用独立 canvas 冻结旧帧覆盖 reset/replay，成功 render 后再释放；失败继续保留旧帧。身份不匹配仍立即调用独立的 presentation invalidation，维持跨账号、实例和会话隔离。LPK version 提升到 `1.0.10`。
- Guard：`TestAgentConnectionErrorPayloadIsRetryable`、`TestAgentAttachInfrastructureFailuresDoNotMasqueradeAsPaneExit` 固定基础设施错误协议；`TestRuntimeOfflineFrameAndWorkspaceRetryGuard` 固定 workspace 持续重试、`connection-error` 非破坏处理、process exit 延迟销毁、snapshot 旧帧冻结和网络恢复全 pane 重连；`TestRuntimeTerminalCanvasResidueGuard` 禁止 `markPaneSyncPending()` 重新调用 renderer clear、canvas clear 或 runtime reset，并固定 `hasPresentedFrame` CSS 门禁。既有 history sync 测试继续固定 generation/cursor 合法时选择 `current/delta`，范围失效时才选择 snapshot。
- 验证结果：`node --check runtime/static/main.js`、完整 `go test ./...` 和 `git diff --check` 通过；`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.10.lpk`。包内 `package.yml` 与 `.lpk-version` 均为 `1.0.10`，`main.js` 包含 workspace 15 秒封顶退避、`connection-error`、pending exit、snapshot frame hold 和 `markPaneSyncPending`，CSS 包含 `hasPresentedFrame` 门禁，Provider 二进制包含 `connection-error` 与 `workspace-refresh-required`。LPK SHA-256 为 `7be6c5aeb799209fce920994ec4bd8823b69b87df89284ca13360e513bb7b40d`。当前环境没有针对实际 Lazycat WebView 的网络/Agent 故障注入能力，仍需现场验证运行中制造 workspace 502、短时停止 Agent 和服务恢复后的 delta 字节数、画面连续性及输入解锁。
- 禁止复现：不得把 Agent/Provider/网络错误重新编码为权威 pane exit；不得在 workspace 成功确认前删除 pane 或缓存；不得让 502、重连或 snapshot 等待清空/隐藏已有同身份帧；不得为了恢复连接无条件设置 `history_replay_mode=snapshot`。增量数据只能追加到完全匹配的 account scope、selector、workspace generation、tab、pane 和 history generation。

### LCMD-20260731-06：可见历史行非原子读取导致 full render 提交黑区

- 日期：2026-07-31
- 来源：`1.0.10` 前后现场稳定复现；刷新或 Agent 持续输出时偶发只显示底部最新字节，上半区域为可滚动黑区，resize 后恢复；补充观察到旧版本断流恢复会先黑屏再只绘制新字节
- 影响模块：Ghostty Web RenderState/Canvas renderer、事件驱动 render scheduler、WebShell 同步 full render 与离线帧保留
- 错误现象：终端模型和历史 cursor 未丢失，但一次 full render 可以先清空 canvas，再逐行读取活动屏幕或 scrollback；任一可见行临时返回 `null` 时，该行保持黑色，renderer 仍清除 dirty 状态并把帧报告为成功。活动屏幕底部路径虽已有一次 `getViewport()` 快照，滚动历史、fractional viewport、hover 扫描和部分重绘仍会重复跨 WASM 读取；源码还保留常驻 60 FPS loop，与实际发布 bundle 的按需调度不一致。断流清屏属于 `LCMD-20260731-05` 的独立问题，本条继续固定网络故障不得破坏最后一帧。
- 根因：canvas 提交与终端行读取不是一个事务。full clear 发生在所有可见行确认可用之前；失败行没有 retry 语义，`getViewport()` 导出失败还会返回旧 cell pool。`getLine()` 每行重新导出整个 viewport，full render 接近 `O(rows² × cols)`，放大大量缓存 replay 和持续输出时的时序窗口。fractional viewport 若直接拿浮点值判断历史/活动屏幕边界，还可能请求等于 scrollback length 的越界行。
- 实施方案：Ghostty renderer 每帧先物化完整可见窗口：活动屏幕只调用一次 `getViewport()` 并复制 grapheme 文本，scrollback 中每个可见行只读取一次，统一使用整数 viewport line 映射；移动端 fractional scroll 额外物化顶部半行。所有行成功后才允许 resize/full clear、逐行绘制、`clearDirty()` 和 `onRender`。任一行缺失时直接返回失败，保持 last-known-good canvas 和 dirty 状态，并由 Terminal 以 16ms 到 250ms 退避强制重试；新输出会立即抢占退避。`getViewport()` 只接受完整 cell 数，RenderState freshness 在 write/resize 后失效并在同帧复用。Ghostty TypeScript 源码同步切换为发布 bundle 已使用的按需 render scheduler；WebShell `renderPaneFullNow()` 只在 `renderNow(true)` 实际成功时返回成功，并在同步渲染前取消旧 retry timer。LPK version 提升到 `1.0.11`。
- Guard：Ghostty `CanvasRenderer > Atomic viewport materialization` 覆盖单帧只导出一次活动 viewport、历史缺行时零 canvas 提交/不清 dirty、fractional viewport 不请求越界 offset；`failed frame materialization preserves render state and retries` 固定失败不触发 `onRender`、保留 full-render 意图并建立退避，成功后清理 retry。WebShell `TestRuntimeTerminalCanvasResidueGuard` 固定 materialization 必须早于 canvas clear，禁止提交阶段重新读取历史行，并固定 retry、同步 full render 返回值及断流不清屏边界。
- 验证结果：Ghostty Prettier、Biome、TypeScript、386 项 Bun 全量测试和 Vite production build 通过；WebShell `runtime/static/main.js`/`ghostty-web.js` 语法检查、Node cache-v2 行为测试和完整 `go test ./...` 通过。`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.11.lpk`，包内 `package.yml` 与 `.lpk-version` 均为 `1.0.11`，包含原子 materialization、退避 retry、同步 render 返回值和 `connection-error` 保帧路径。运行时 bundle SHA-256 为 `428c3daf38f1183d3a5eb633a46b3ac6d4894db2a2b303fc29cca534d9362182`，WASM SHA-256 为 `65a99188312ad92780b3af2fa410b8af395536dfe1e777ec24573d8be1436f16`，LPK SHA-256 为 `979bb6999200e653c9254c1ac8d54a757ac3259e17dd94b69c317db3be097d56`。真实浏览器仍需复验连续刷新、断流恢复、长历史滚动和 Agent 持续输出时不再出现部分黑屏。
- 禁止复现：不得在所有可见行准备完成前清空或部分提交 canvas；行读取失败不得调用 `clearDirty()`、发出成功 `onRender` 或隐藏最后一帧；不得让 full render 按行重复导出活动 viewport；fractional viewport 不得以浮点边界请求 `scrollbackLength` 行。断流、502 和重连仍不得调用 renderer clear 或 presentation invalidation。冷历史按需解析属于后续 Cache v3/row-block 架构，不能用未经 checkpoint 的原始 PTY 字节裁剪替代本条修复。

### LCMD-20260731-07：受保护 PWA manifest 反复 401 且首屏恢复被启动瀑布和碎片缓存拖慢

- 日期：2026-07-31
- 来源：`1.0.11` 现场反馈；几乎每次刷新都出现 `/assets/1.0.11/manifest.webmanifest` 401，同时首次进入页面明显慢于同页后续 tab
- 影响模块：LightOS 外层 Cookie 鉴权、PWA manifest、Service Worker 静态资源策略、浏览器 bootstrap、Cache API v2 字节块布局和恢复指标
- 错误现象：浏览器反复请求版本化 manifest 并收到 401，PWA 安装元数据不可用；同版本刷新仍先等待代理返回 JS/CSS/WASM/JSON。终端缓存恢复要等 Ghostty WASM、主题、设置、自定义字体、实例列表和启动输入锁依次完成后才请求 workspace；workspace 应用前还创建一个随后因权威 cache identity 到达而销毁的临时 pane。历史缓存虽然只有数百 KB，却可能积累上千个小 Cache 条目，放大首次 warm replay 的 `Cache.match()` 开销。
- 根因：Web App Manifest link 未声明 `crossorigin="use-credentials"`，浏览器按 manifest 的默认 credentials mode 省略同源认证 Cookie，401 由 Provider 之前的 LightOS 代理返回。Service Worker 对已经带 LPK 版本且服务端声明 immutable 的资源仍执行 network-first，并且只在 fetch 抛异常时回退缓存，401/502 会直接返回。bootstrap 在模块顶层先 await WASM，之后串行请求主题、设置和字体、实例、输入锁、workspace；Cache v2 又把每次小输出提交为独立不可变块，没有尾块合并或旧 manifest 压缩。
- 实施方案：manifest link 增加 `crossorigin="use-credentials"`。Service Worker 对当前 `assetBase` 先查当前版本 app-shell cache，命中立即返回；缓存未命中才联网，网络非 2xx 或异常时回退已有静态响应，导航/API/WebSocket/终端虚拟 URL 仍保持 network-only。Ghostty 初始化改为启动即发起但不阻塞模块定义；主题、设置、实例、启动输入锁并行，URL 已有 selector 时 workspace 与实例列表并行请求；初始设置先应用 scrollback、主题关联和字体族，自定义字体文件后台加载。删除启动时必然被权威 workspace identity 淘汰的临时 pane，workspace 应用后优先预读活动 pane manifest，只连接活动 tab，其他总览图片延后到 idle。Cache v2 后续追加会把连续小块合并到约 128KB 尾块；网络同步和输入就绪完成后在 idle 中按完整身份与 history generation 压缩旧碎片，仍坚持新块先写、manifest 后提交、旧块最后删除。恢复日志补充从 navigation/module、WASM、设置、实例、workspace 到真实 canvas 的页面级时间点。LPK version 提升到 `1.0.12`。
- Guard：`TestRuntimeContainerCacheV2AndPWAContract` 固定 manifest credentials、当前版本 cache-first、非成功响应回退、启动并行、活动 pane 优先、隐藏 tab 延后和 compaction 调度；`TestRuntimeMobileDeployRestartUsesBottomSheet` 禁止恢复初始临时 pane；`terminal_cache_v2_test.mjs` 新增小 append 自动合并和旧碎片压缩测试，覆盖 cursor 顺序、preview 保留、替换块数量及压缩前后字节一致。
- 验证结果：`node --check` 通过 `main.js`、`service-worker.js` 和 `terminal_cache_v2.js`；Node cache-v2 行为测试 10/10、完整 `go test ./...` 和 `git diff --check` 通过。`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.12.lpk`，包内 `package.yml` 与 `.lpk-version` 均为 `1.0.12`，并确认包含 manifest credentials、当前版本 cache-first、并行 bootstrap、活动 pane manifest 预读和 Cache v2 compaction。包内 `main.js` SHA-256 为 `1bd8262c7ed55dbba18e3df3abf6f43de8164d9fc6efb8e25410f24d3ae15da4`，Service Worker 为 `63ef55510a15e64f94b53b15a34f8f9ac9a0fdc96400947546a7d41ccfa695ef`，Cache v2 为 `7dd0ca2fd4f09162f56870b7f97cafa8438ebe7865f66e6ccee8ab79392a22a2`，LPK 为 `78fbbe5ad4a8b9f2fb775012c85435691e4a0ef86be251ff9fc8ec7fd26e65c9`。真实 LightOS 域名仍需在安装后确认 manifest 不再 401，并用新增 `pageWorkspaceRequestStartMs`、`pageWorkspaceReadyMs`、`pageRealCanvasVisibleMs` 对比连续刷新时序。
- 禁止复现：受保护的 manifest 不得恢复为省略 credentials；当前版本 immutable 资源不得重新执行每次刷新 network-first；非 2xx 静态响应不得覆盖可用本地 app shell。不得在 workspace 完整身份到达前读取或显示终端历史，不得让 warm canvas 解锁输入；后台字体、总览和缓存压缩不得进入活动 pane 首帧关键路径。压缩不得改变 cursor、generation、preview checkpoint 或完整账号/workspace/tab/pane 身份，也不得在 manifest 提交前删除旧块。

### LCMD-20260803-01：嵌入终端覆盖最后工作区并持久化嵌入模式

- 日期：2026-08-03
- 来源：Safari 客户现场反馈；第三方应用终端使用 `embed=1`，关闭应用后 LightOS 恢复到第三方实例且右上角选项栏不显示
- 影响模块：`runtime/static/main.js` 工作区恢复状态、页面生命周期写入和 5 秒恢复心跳
- 错误现象：第三方应用打开 `abc` 实例的嵌入终端后，WebShell 的 `pageshow`、`pagehide`、`beforeunload`、`visibilitychange` 或定时心跳可能把它写成最后工作区；随后从 LightOS 根页面恢复时直接进入该实例，并因保存 URL 含 `embed=1` 持续隐藏右上角选项栏。
- 根因：所有生命周期写入最终都会调用 `persistWorkspaceRestoreState`，但该函数没有区分临时终端，也原样保存当前 URL 的 `embed` 参数。共享 localStorage 单槽因此采用“最后写入者获胜”，Safari 的页面挂起和恢复时序只提高了第三方页面最后写入的概率。
- 实施方案：在最底层 `persistWorkspaceRestoreState` 对 `last` 去除首尾空白并忽略大小写，值等于 `false` 时直接跳过写入且保留原有恢复状态；其他页面保存前统一删除 `view`、`embed` 和 `last`，只持久化可独立打开的普通 WebShell URL。读取旧状态时拒绝并清除 URL 中含 `last=false` 的无效记录，避免直接打开 `/webshell/` 时继续恢复已被旧版本污染的临时实例。
- Guard：`TestRuntimePersistsWorkspaceForLightOSHomeReload` 固定 `last=false` 的底层写入门禁、旧状态清理以及 `embed`/`last` 参数删除；所有生命周期和定时写入继续只经 `persistWorkspaceRestoreState` 更新共享恢复槽。
- 验证结果：`go test ./...`、`node --check runtime/static/main.js`、Node 隔离状态模拟（`last=false` 不写入、普通 embed 去参数保存、旧 `last=false` 清除）、`git diff --check` 通过。
- 禁止复现：不得在各生命周期事件中绕过统一持久化入口；`last=false` 页面不得写入或清空已有最后工作区；允许保存的恢复 URL 不得包含 `embed`、`last` 或 `view`。

### LCMD-20260803-02：Agent 空响应、并发冷启动与 socket 争用导致 WebShell 启动失败

- 日期：2026-08-03
- 来源：客户截图、根目录现场日志与测试机确定性故障注入；续接 `LCMD-20260730-03` 和 `LCMD-20260731-05`
- 影响模块：Provider persistent agent 请求/安装/启动、目标实例 daemon/socket、并发 workspace/WebSocket 冷启动和浏览器启动错误面板
- 错误现象：把目标实例 `/usr/local/bin/lcmd-webshell-agent` 替换为空脚本并保持 manifest 不变后，WebShell 可稳定出现 `invalid agent response: unexpected end of JSON input: output=<empty>`。并发冷启动还可能启动多个同 scope daemon，互相删除或抢占 socket，产生 `EOF`、502、socket bind 冲突或启动命令已经返回 ready 但 daemon 尚未 listen 的假成功；已有 warm frame 时真实启动错误只写入控制台，页面没有错误面板。
- 根因：`agent request` 客户端把 Unix socket 零字节 EOF 当作成功，Provider 随后直接对空 stdout 做 JSON 解码；安装 cache 只比较可执行权限与 manifest 文本，没有核对最终 agent 二进制 SHA-256，因此被替换的空脚本仍被视为已安装。同 scope 的 ensure/install/start 没有共享 flight，HTTP/WebSocket 请求取消又会取消各自启动；starter 与 daemon 都会无条件删除 socket，daemon 没有跨进程锁，starter 在后台命令提交后立即打印 ready。`lightosctl` 使用的现有 exec-stream 仅定义 stdin/stdout/stderr/control 字节流，control 在 core 端被丢弃，没有可供调用方读取的远端退出码，不能把本地流正常结束等同于远端脚本成功。
- 实施方案：`agent request` 在 socket 响应为零字节时返回 `io.ErrUnexpectedEOF`，Provider 在 JSON 解码前单独拒绝空响应。manifest 解析必须得到当前协议和合法 SHA-256；每次 install cache 命中都在目标实例用 `sha256sum` 或 BusyBox fallback 校验实际 agent，staging 解包后也先校验 payload SHA，再原子替换 agent 和 manifest。Provider 新增按完整 scope key 的共享 ensure flight，使用独立 60 秒后台 context；单个调用方取消只停止等待，32 路冷启动只执行一次 resolve/install/start。daemon 对 `<socket>.lock` 持有非阻塞 `flock`，获得锁后才清理不可连接的 stale socket；退出时通过 inode 身份只删除自己创建的 socket。starter 不再删除 socket，向 daemon 传递本次唯一 ready 文件并等待 marker 内容精确匹配且子进程仍存活；daemon 仅在 bind/listen、socket stat/chmod 全部完成后原子写 ready。跨 Provider 启动竞争失败后再次 ping，若另一 daemon 已就绪则直接复用。warm/last-known-good frame 保持不被终端错误文本覆盖，但同时显示启动错误面板。LPK version 提升到 `1.0.13`。
- Guard：`TestRunAgentRequestClientRejectsEmptyResponse`、`TestParsePersistentAgentResponseRejectsEmptyOutput` 固定空响应失败；`TestAgentInstallScriptRejectsPayloadHashMismatch` 和 `TestEnsureAgentBinaryInstalledVerifiesCacheHit` 固定实际 SHA 校验与 staging 原子替换；`TestPersistentAgentEnsureCoordinatorSharesConcurrentColdStart` 以 32 路调用固定单 flight，`TestPersistentAgentEnsureCoordinatorCallerCancellationDoesNotCancelSharedStart` 固定请求取消边界；`TestReconcileAgentDaemonsPreservesSocketOwnerAndStopsDuplicates`、`TestReconcileAgentDaemonsStopsAllOrphansWhenSocketIsMissing` 和 `TestAgentDaemonArgsMatchRequiresExactScope` 固定升级时只保留 socket 真实 owner、socket 缺失时清理全部孤儿且不跨 scope 杀进程；`TestAgentDaemonLockAllowsOnlyOneOwner`、`TestAgentDaemonSocketCleanupPreservesReplacementOwner`、`TestRemoveStaleAgentSocketRejectsActiveListener`、`TestRemoveStaleAgentSocketRemovesClosedListener` 和 `TestWriteAgentReadyFileIsAtomicAndExact` 固定 daemon 锁、socket 所有权、stale 清理和 ready 合同；`TestStartPersistentAgentChecksExecutableBeforeReadyMarker` 禁止 starter 重新删除 socket或提前 ready；`TestRuntimeOfflineFrameAndWorkspaceRetryGuard` 固定 warm frame 保留且错误面板可见。
- 验证结果：`node --check runtime/static/main.js`、完整 `go test -race ./...` 和 `git diff --check` 通过。本机真实进程验收中，一个 daemon 完成 ready 后 32 路并发 ping 全部成功，32 个同 socket 重复 daemon 全部被锁拒绝，主 daemon 最终 ping 继续成功。测试机从 17 字节故障脚本、3 个同 scope 孤儿 daemon 且 socket 缺失的状态原地升级后恢复：agent SHA-256 为 `6747abf65066867ff3cd3187a36dd7c8c4020bf685a4c331c09100fe7f068360`，reconcile 清理旧孤儿后同 scope 仅 1 个 daemon，socket 与 lock 存在，32 路并发请求零失败；用户确认截图复现链和 WebShell 修复验收通过。`lzc-cli project release` 生成 `cloud.lazycat.webshell.lcmd-v1.0.13.lpk`，包内版本为 `1.0.13`，LPK SHA-256 为 `895053f508e20d7d5524cfd7c4d34c52b7afd91241a1b7b3c6b78e309b4dbe0f`。
- 禁止复现：不得把零字节 agent stdout 当作成功或继续交给 JSON 解码；不得仅凭 manifest 文本跳过实际二进制 SHA 校验；同 scope 启动不得绑定任一请求的取消生命周期或并发执行 install/start；starter 不得删除 daemon socket或在 listen 前打印 ready；daemon 不得在未持有 scope 锁时清理 socket，退出时不得删除其他进程替换后的 socket；不得因为已有 warm frame 就隐藏真实启动错误。远端退出码在 exec-stream 协议正式定义前不得伪造，关键脚本必须继续用可验证的精确成功 marker。

### LCMD-20260804-01：实例重启残留 agent socket 阻断 WebShell 自愈

- 日期：2026-08-04
- 来源：安装桌面的 LightOS 实例进入 WebShell 现场截图；续接 `LCMD-20260803-02`
- 影响模块：`agent_reconcile_linux.go`、persistent agent reconcile/start 链路、实例重启后的 `/tmp/lcmd-webshell-agent-*.sock`
- 错误现象：实例重启后 `/tmp` 中保留旧 agent Unix socket，但原 daemon 已退出；WebShell reconcile 连接该路径得到 `connect: connection refused` 后直接失败，后续重复进程清理、stale socket 删除和新 daemon 启动均不会执行，页面持续显示启动错误。
- 根因：`activeAgentSocketPID` 把所有 Unix socket connect 错误都视为致命错误，没有区分仍有活跃 listener 的 socket 与 inode 存在但已无 listener 的 `ECONNREFUSED` stale socket；LightOS 的 `/tmp` 不随实例重启清空，使该状态可以稳定跨重启保留。
- 实施方案：Linux reconcile 在 socket 类型校验通过后，只把 `ECONNREFUSED` 以及 `Lstat` 与 connect 之间路径消失的 `ENOENT` 解释为当前没有活跃 socket owner，继续按 scope 清理孤儿 daemon并进入既有启动流程；权限错误、非 socket 文件和其他未知连接错误继续显式失败。daemon 启动仍由已有 `removeStaleAgentSocket` 在持有 scope lock 后删除 stale inode，不在 reconcile 中绕过锁抢先删除。LPK version 提升到 `1.0.16`。
- Guard：`TestReconcileAgentDaemonsAcceptsRefusedStaleSocket` 创建关闭 listener 后仍保留 inode 的确定性 `ECONNREFUSED` 状态，固定 reconcile 成功且后续 daemon stale 清理可以继续；既有 `TestReconcileAgentDaemonsPreservesSocketOwnerAndStopsDuplicates` 继续固定活跃 owner 不被终止。
- 验证结果：`go test ./... -run 'Test(ReconcileAgentDaemons|RemoveStaleAgentSocket)' -count=1`、新增 stale socket 测试连续 10 次运行、`go test -race ./...`、`git diff --check` 和工作区根目录 `./lightos-build.sh` 通过。构建产物 `local-lcmd-webshell.lpk` 版本为 `1.0.16`，LPK SHA-256 为 `f38482f47fb3a5ddf4db8ee5d245603b052180867c80a9a8e673c730bdff02d3`，内嵌二进制 SHA-256 为 `91361264d8bb1dd6b86a326dd8c819a9b1e63fa0f766f6a3b8fda1a5ee6c38ab`。实际 LightOS 实例仍需在保留 `/tmp/lcmd-webshell-agent-*.sock` 后重启并复验 WebShell 自动恢复。
- 禁止复现：不得把 `ECONNREFUSED` stale socket 再次作为 reconcile 的终止条件；不得吞掉权限、路径类型或未知连接错误；不得在未持有 daemon scope lock 时删除 socket。

### LCMD-20260806-01：v6 活跃 agent 被保留导致 v7 无法接管 socket

- 日期：2026-08-06
- 来源：旧版本升级到 `1.0.16` 后的现场截图 `微信图片_20260806153141_166_8.png`；续接 `LCMD-20260730-03`、`LCMD-20260803-02` 和 `LCMD-20260804-01`
- 影响模块：Provider agent 协议识别、安装后 reconcile、目标实例活跃 daemon/socket 和 v6 -> v7 原地升级
- 错误现象：旧版本已有 `lcmd-webshell-agent-v6` daemon 时，Provider 能识别协议不兼容并成功原子安装 v7 二进制，但普通 reconcile 输出清理 0 个进程；随后 v7 daemon 在 readiness 前以状态 1 退出，WebShell 稳定显示启动错误。重启 LightOS 后旧 v6 进程消失，新 v7 才能启动，因此表现为所有旧版本升级用户必现、重启后恢复。
- 根因：安装只替换 `/usr/local/bin/lcmd-webshell-agent` 路径，已经运行的 v6 进程继续执行旧 inode 并持有 Unix socket。reconcile 无条件保留 socket 的活跃 owner，没有区分该 owner 是否仍使用兼容协议；新 v7 daemon 获得自身锁后发现旧 socket 仍可连接，按既有安全守卫返回 `agent socket is already accepting connections` 并退出。安装前协议结果也不能直接授权稍后终止进程，因为跨 Provider 竞争期间该 socket 可能已经被兼容 v7 owner 接管。
- 实施方案：协议不兼容改为可通过 `errors.As` 识别的结构化错误，普通超时、EOF、权限或 JSON 错误不再通过字符串命中升级分支。安装和普通 reconcile 后重新 ping 当前 socket；只有这次最新 ping 仍明确返回不兼容协议时，Provider 才调用新 `agent reconcile --replace-active`。替换模式要求 socket peer PID 必须同时出现在相同 socket、selector 和 account 的精确 daemon 进程集合中，否则显式拒绝；目标端在发信号前还会直接 ping socket 复核协议，若并发 Provider 已完成 v7 接管则返回并保留该 owner。确认仍为旧协议后只结束当前活跃 PID，先 SIGTERM、超时再 SIGKILL 并等待退出；同 scope 孤儿由此前的普通 reconcile 清理，随后由现有 daemon 锁和 stale socket 清理接管启动。默认 reconcile 继续保留活跃兼容 owner，跨账号 owner、普通连接故障和并发期间已经启动的 v7 都不会被替换。LPK version 提升到 `1.0.17`。
- Guard：`TestParsePersistentAgentResponseClassifiesProtocolMismatch` 固定只有结构化协议错误可以授权替换；`TestReconcileAgentDaemonsReplacesActiveOwnerAfterProtocolMismatch` 固定先由普通模式清理同 scope 孤儿、再由显式模式结束旧协议活跃 owner；`TestReconcileAgentDaemonsPreservesCompatibleOwnerDuringReplacementRace` 固定目标端复核发现 v7 后不再执行过期的替换意图；`TestReconcileAgentDaemonsRejectsReplacingDifferentScopeOwner` 固定跨账号 socket owner 不被终止；`TestReconcileAgentDaemonsPreservesSocketOwnerAndStopsDuplicates` 继续固定默认模式保留兼容 owner；`TestEnsurePersistentAgentPingsBeforeInstalling` 固定替换入口位于安装后最新 ping 的协议类型守卫内。
- 验证结果：协议、notice、启动和 reconcile 定向测试通过；活跃旧 owner 替换、并发 v7 owner 保留、跨 scope 拒绝和默认保留测试连续 20 次通过；完整 `go test -race ./...` 与 `git diff --check` 通过。使用 `843f2bf~1` 构建真实 v6 agent、当前源码构建 v7 agent 的临时升级验证中，v7 request 先收到 `lcmd-webshell-agent-v6`，`reconcile --replace-active` 精确移除 1 个旧 owner，随后新 daemon ping 返回 `lcmd-webshell-agent-v7`。工作区根目录 `./lightos-build.sh` 通过，`local-lcmd-webshell.lpk` 内版本为 `1.0.17`，LPK SHA-256 为 `89fd162e6cce87291970ac561acc4b911659e2d1fed25f1c266b82de64e2be55`，内嵌二进制 SHA-256 为 `b3d08dde789faf7eac6d406e6bc68ca4d97559f0e144643630f24e265d426ea5`；Admin LPK SHA-256 为 `b32ec6b269909aa57683b92a832a7b4114aed464898237b1f3bc66e041ac6212`。
- 禁止复现：不得仅凭安装前的旧协议结果或错误字符串终止活跃 daemon；不得让超时、EOF、权限、空响应或未知协议解析错误进入 `--replace-active`；替换前不得省略 socket peer PID 与完整 selector/account scope 的一致性校验；普通 reconcile 不得重新杀死兼容的活跃 owner。

### LCMD-20260806-02：频繁 resize 切换 tab 产生 Canvas 残影并偶发卡顿

- 日期：2026-08-06
- 来源：用户现场截图 `截图_2026-08-06_13-45-35.png`、Electron 日志与用户对 resize 行为的补充观察
- 影响模块：WebShell `ResizeObserver`、分屏拖动、窗口/tab 激活布局、Ghostty Web Canvas 渲染和 WASM resize/write 时序
- 错误现象：连续调整 WebShell 窗口或 pane 宽高后切换到下一个 tab，上一个 tab 的部分画面会以不规则形状残留到当前 tab；再次调整窗口或重开窗口后恢复，少数情况下 renderer 主线程高负载导致窗口卡死。用户观察到每次 resize 都会让终端内容从顶部重新滚到底部，说明 resize 期间重复 full-render/reflow 正在争用主线程。
- 根因：ResizeObserver、分屏拖动、tab 激活和 window settle 路径可以在同一 pane 上重复提交 resize；每次提交都会触发 Ghostty WASM reflow 和整帧绘制，旧的 Canvas 帧可能在新尺寸提交前被清空，tab 切换又可能在下一帧才完成 fit/render，形成跨 tab 合成残影。resize 与 PTY write 没有明确的原子边界时，WASM 重分配 buffer 期间的写入会与 renderer 读取交错；隐藏 tab 仍持续调度 Canvas RAF，进一步放大主线程负载和 XSync timeout 概率。
- 实施方案：新增按 pane 合并 resize 请求的 `terminal_resize_scheduler.js`，以约 80ms throttle 和 120ms settle 保留最后一次尺寸，`immediate` 只应用最新请求。resize 前复制最后一帧到 frame-hold Canvas，并在尺寸或 Canvas 变化期间保持旧帧可见，成功的 full-render 通过现有 presentation generation 校验后才释放；失败时保留旧帧并进入既有 validation/retry。tab 激活先同步切换 DOM active 状态，再在同一任务中对目标 tab 做最终 fit/full-render；隐藏 pane 继续解析 PTY 数据但取消待执行 Canvas RAF，激活时再做整帧绘制。Ghostty bundle 在 resize 前取消待执行 render，resize 期间把输入写入队列，完成后通过正常 `writeInternal` 路径 flush，dispose 时清空队列；Canvas 尺寸变化但列行数不变时也调用 renderer resize，避免物理尺寸不同步。
- Guard：新增 `terminal_resize_scheduler_test.mjs` 覆盖快速 resize 合并、trailing settle、immediate 覆盖旧请求和 cancel；`TestTerminalResizeSchedulerBehavior` 接入 Go 测试；`TestRuntimeTerminalCanvasResidueGuard` 与 `TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs` 固定 frame-hold、Canvas 尺寸 resize、隐藏 pane RAF 取消、tab 同步激活和 Ghostty resize/write 队列保护；Service Worker precache guard 固定新模块随 runtime 发布。
- 验证结果：`node --check` 通过 `main.js`、`ghostty-web.js` 和 `service-worker.js`；Node resize scheduler 与 terminal cache-v2 行为测试 13/13 通过；`TestRuntimeTerminalCanvasResidueGuard`、`TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs`、`TestTerminalResizeSchedulerBehavior` 及完整 `go test ./...` 通过；`git diff --check` 通过。当前尚未完成真实 Electron 连续拖拽 resize/tab 切换压力截图，因此实机残影和卡死概率仍需在目标 LightOS 环境复验。
- 禁止复现：不得恢复每个 ResizeObserver 回调直接调用 `term.resize()`；不得在 resize 尚未完成时清空或隐藏唯一可见旧帧；不得让隐藏 tab 持续运行 Canvas render loop；不得在 Ghostty buffer 可能重分配时直接写 WASM；不得把列行数不变误认为 Canvas 物理尺寸已经同步。

### LCMD-20260807-01：resize 中间 full-render 暴露终端从顶部滚到底部的重排过程

- 日期：2026-08-07
- 来源：LCMD-20260806-02 修复后的用户复验；残影不再复现，但连续 resize 仍能看到终端内容从顶部逐步滚到下方
- 影响模块：`terminal_resize_scheduler.js` settle 调度、WebShell Canvas frame-hold、PTY 输出期间的 render 请求
- 错误现象：调整窗口尺寸时，终端模型最终位置正确，但用户能看到每个中间尺寸的重排/full-render 过程；页面首帧使用缓存时没有同样的可见滚动，因此问题集中在 resize 的展示提交策略，而不是终端 viewport 最终值错误。
- 根因：原 scheduler 虽然合并请求，但 throttle frame 也会立即调用 `resizePane()`、同步 full-render 并释放 frame-hold。连续拖拽期间每个中间尺寸都被提交给用户；resize 同时到达的 PTY 输出又会请求新的 Canvas RAF，使中间帧更容易暴露。该行为不是 FlashList 能解决的列表排序问题，而是“模型更新”和“可见帧提交”没有分成两个阶段。
- 实施方案：scheduler 增加 `settled` 上下文。throttle frame 只更新 Ghostty/WASM 尺寸并保留旧 raster frame，settle timer 始终执行最后一次提交；单次 resize 也保证有 trailing settled commit。pane 增加 `resizePresentationHold`，full-render 回调在 hold 期间只更新已呈现 generation，不释放旧帧。resize hold 期间到达的输出仍写入终端模型，但取消其待执行 Canvas RAF，并标记最新 content generation 必须在最终提交时 full-render；最终 render 成功后才释放 hold。
- Guard：resize scheduler Node 测试新增中间 `{ settled: false }`、最终 `{ settled: true }` 以及单次 resize trailing commit；`TestRuntimeTerminalCanvasResidueGuard` 固定 `resizePresentationHold`、settled scheduler apply、resize 期间延后 render 和最终 full-render 条件。
- 验证结果：`node --check` 通过；resize scheduler 与 terminal cache-v2 Node 测试 14/14 通过，其中 scheduler 4/4；目标 Go 静态 guard、完整 `go test ./...`、`go test -race ./...` 和 `git diff --check` 通过；真实 Electron 连续拖拽压力截图仍需在目标 LightOS 环境复验。
- 禁止复现：不得在 resize burst 的 throttle frame 释放用户可见旧帧；不得让 resize 期间的 PTY 输出抢占中间 Canvas 提交；settle timer 不得被中间 frame 取消；最终提交必须覆盖 resize 期间积累的最新终端内容。

### LCMD-20260807-02：resize hold 快照被拉伸并暴露底层中间重排

- 日期：2026-08-07
- 来源：LCMD-20260807-01 修复后的用户复验；残影已消失，但仍能看到短距离快速滚动和闪烁
- 影响模块：WebShell frame-hold Canvas、pane resize scheduler、window resize 与 ResizeObserver 提交路径
- 错误现象：resize 时旧终端内容没有稳定停留在原位置，而是出现一小段快速位移；底部缓存快照看似存在但视觉上不起作用。不同尺寸事件结束后偶尔还会出现一次额外的最终帧闪烁。
- 根因：hold Canvas 原先使用 `width: 100%`、`height: 100%` 和 `object-fit: contain`，窗口尺寸变化时浏览器会缩放旧位图，终端行高和底部锚点随容器连续变化。与此同时 throttle 回调仍实际执行 `term.resize()`、full-render 和 PTY resize，快照只是遮盖了这些中间重排；`window.resize` 自己的 settle timer 又和 ResizeObserver scheduler 形成第二个最终提交来源。根因是展示快照、终端模型更新和 PTY 尺寸通知没有形成单一的 settled 提交边界，不是普通列表虚拟化问题。
- 实施方案：hold 快照先按当前 Canvas 的 CSS 逻辑尺寸重采样，保持全容器盒子但使用 `object-fit: none`、`object-position: left bottom`，避免随新窗口缩放；scheduler 的非 settled 回调只保留 hold，不执行终端 resize/render，`resizePane` 自身也拒绝 hold 期间的非 settled 旁路调用，最终 settle 才一次性应用尺寸、恢复 viewport、通知 PTY 并提交 full-render；最终选项合并整个 burst，避免早期强制渲染标志丢失；window resize 改为直接进入同一个 pane scheduler，移除独立 settle timer。
- Guard：scheduler 测试固定最终提交合并早期选项；`TestRuntimeTerminalCanvasResidueGuard` 固定逻辑像素快照、非 settled 路径和 hold 几何；`TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs` 固定不存在第二个 `activeTabResizeTimer`。
- 验证结果：Node terminal cache-v2 与 resize scheduler 测试 14/14 通过；完整 `go test ./...`、`go test -race ./...`、JS `node --check` 和 `git diff --check` 通过。真实 Electron 连续拖拽和 tab 切换压力截图仍需在目标 LightOS 环境复验。
- 禁止复现：不得在 resize burst 的非 settled 回调执行 `term.resize()`、full-render 或 PTY resize；不得用 `contain` 拉伸 hold 位图；不得恢复独立 window settle timer；最终可见帧只能由 scheduler 的 settled 提交释放旧帧。

### LCMD-20260807-03：移动端键盘输入被 resize presentation hold 长时间阻塞

- 日期：2026-08-07
- 来源：LCMD-20260807-02 修复后的用户复验；PC 输入正常，多台移动设备出现输入无响应、延迟数分钟或不显示
- 影响模块：移动端 visual viewport/IME resize、输入 pending/queue、pane `renderReady` 与 resize presentation hold
- 错误现象：移动端键盘弹出或收起后，输入事件有时已经进入本地 pending 队列，但迟迟没有通过 WebSocket 发送；即使连接正常，也可能因为 `renderReady=false` 无法 flush。PC 不触发移动键盘 viewport 链路，因此不受影响。
- 根因：`isSessionInputReady` 同时要求网络连接已 ready 和终端画面 `renderReady=true`。移动键盘调整 viewport 时 window resize 会先把 pane 置为 presentation hold；此前 hold 在键盘抑制期间可能无法进入 settled resize，键盘收起后的直接 resize 又被非 settled 门禁拒绝，导致 `renderReady` 长时间保持 false。输入传输状态与画面展示状态被错误绑定。
- 实施方案：输入 readiness 只依赖 replay 已完成、preview 未显示和 WebSocket OPEN，不再依赖 `renderReady`；移动 IME viewport 抑制期间不创建 terminal resize hold；移动设备恢复尺寸统一通过 scheduler 的 immediate settled 路径提交，确保旧 hold 能释放。键盘 viewport 的滚动/平移继续由专用 inset/pan 逻辑处理。
- Guard：容器契约测试固定 input readiness 不包含 `session.renderReady`；`TestRuntimeTerminalCanvasResidueGuard` 固定 IME 抑制期间跳过 resize hold；`TestRuntimeTabResizeDoesNotTemporarilyActivateAllTabs` 固定移动设备恢复调用 scheduler immediate。
- 验证结果：Node 14/14、完整 `go test ./...`、`go test -race ./...`、JS `node --check` 和 `git diff --check` 通过；真实移动设备输入和键盘收放压力仍需在目标 LightOS 环境复验。
- 禁止复现：不得用 Canvas 展示状态阻塞已连接终端的用户输入；IME viewport 变化期间不得创建或永久保留 terminal resize hold；移动端尺寸恢复必须经过 settled 提交释放 hold。

### LCMD-20260810-01：Ghostty-Web 终端忽略 Kitty Graphics 原始图片序列

- 日期：2026-08-10
- 来源：用户要求在当前 Ghostty-Web WebShell 终端中直接渲染项目根目录 `image.png`，而不是字符画或外部图片查看器
- 发布：LPK version `1.0.21`（`1.0.18` 初版未正确隔离 Kitty generated input，`1.0.19` 仍依赖浏览器经 WebSocket 回传探测回复，`1.0.20` 未同步 ANSI 整屏清除到图片图层；版本化静态资源 immutable，因此每次现场协议修正均提升版本）
- 影响模块：WebShell `runtime/static/kitty_graphics.js`、`main.js`、resize 消息与 Go PTY/Agent 尺寸链路，以及 Service Worker 静态资源预缓存；Ghostty Web/WASM 仅作为能力边界背景
- 错误现象：PTY 输出中的 Kitty Graphics APC（`ESC _ G ... ESC \`）被 Ghostty-Web WASM 构建忽略，`kitty icat` 无法在终端 Canvas 中显示原始 PNG；使用 `xdg-open` 只能启动外部程序，不能满足终端内渲染要求。初版接入后，Kitty 探测回复若未标记为内部 generated input，还会被 shell 回显为 `Gi=1;OK`。图片显示成功后，shell 的 `Ctrl+L`/`clear` 只让 Ghostty 清除字符网格，独立绘制的 Kitty 图片仍残留在 Canvas 上。
- 根因：原生 Ghostty 虽支持 Kitty Graphics，但当前 ghostty-web WASM 构建把 `oniguruma` 设为 false，连带禁用 Kitty Graphics；其 Canvas 层也没有图片放置绘制接口。WebShell 还维护了包含历史回放和 resize/write 队列修复的定制 Ghostty bundle，直接替换 bundle 会覆盖这些定制。另一个独立问题是 Kitty 0.48.2 的 `icat` 直接读取 Linux PTY `TIOCGWINSZ.ws_xpixel/ws_ypixel`，而原链路只设置了行列，像素字段为 0。图片适配器最初只挂接 JavaScript `Terminal.clear()`/`reset()`，但 shell 的 `Ctrl+L` 是由 PTY 输出 `CSI 2 J` 等 ANSI 序列驱动，不会调用这些方法。
- 实施方案：不修改 Ghostty WASM 和 `ghostty-web` 源码仓库，在 WebShell 运行时新增独立 `kitty_graphics.js` 适配器，以 Terminal 原型包装方式接入现有定制 bundle，按顺序把普通文本交给 WASM、把图片 APC 交给图片管理器，并通过异步 `createImageBitmap` 解码后在同一 Canvas 上按终端光标单元格绘制。支持 `a=T`/`a=t`/`a=p`/`a=d`、`f=100` PNG、Kitty 0.48 `icat` 实际输出的 `f=24`/`f=32` 原始像素与 `o=z` 压缩、`m=1/0` 分块、图片/placement 生命周期和单元格尺寸。Go PTY 输出过滤器直接消费 `a=q` 探测 APC，在同一 PTY 内同步回复：只声明浏览器可读取的直接传输，不误报服务器临时文件或共享内存；回复不再经过浏览器 `Terminal.input`、WebSocket 输入队列或 shell。浏览器将 Canvas CSS 像素尺寸随 resize/input 发送，Go PTY/持久 Agent 写入 `Winsize.X/Y`，使 Kitty 能获取窗口像素大小；同时兼容拦截 `CSI 14 t` 并回复 `CSI 4;height;width t`。图片适配器持续观察交给终端的普通输出，跨分块识别 `CSI 2 J`、`CSI 3 J` 和 RIS 全复位并清除图片 placement，局部 `CSI J` 不误删图片。Service Worker 将新模块加入 app-shell 预缓存。
- Guard：`kitty_graphics_test.mjs` 覆盖 APC 不泄漏到 WASM、图片查询响应与传输方式筛选、完整及跨输出分块的终端像素尺寸查询、真实 PNG base64 分块、Kitty `icat` zlib RGB 分块、光标坐标和 `drawImage` 尺寸，以及跨输出分块的整屏擦除和局部擦除保留；`TestKittyGraphicsBehavior` 接入 Go 测试；`TestTerminalPaneTracksKittyGraphicsQueryResponses` 固定 Go 后端消费完整/分块 Kitty 查询、直接传输返回 `OK`、临时文件返回 `EINVAL`，并禁止任何探测 APC 或回复进入浏览器/shell；`TestTerminalPaneResizeAppliesPixelSizeToPTY` 固定 `Winsize.X/Y`；`TestTerminalSizeSyncBehavior` 固定像素尺寸变化不能被行列去重；`TestRuntimeTerminalCanvasResidueGuard` 固定运行时模块、安装入口和 Kitty Graphics 关键能力字符串；Service Worker guard 固定新模块进入预缓存。
- 验证结果：运行时 `node --test kitty_graphics_test.mjs` 7/7 通过；相关 Go guard、完整 `go test ./...`、`node --check` 和 `git diff --check` 通过；实测 Kitty 0.48.2 的 stream 输出为 `f=24,o=z`，已用真实项目根目录 PNG 做解码回放，确认图片放置为光标 `(2,3)`、`20x10` 单元格；`ghostty-web` 仓库保持零改动。当前仍需在目标 WebShell 页面重启后刷新静态资源，执行真实 `kitty +kitten icat ./image.png` 后按 `Ctrl+L` 做最终复验。
- 禁止复现：不得用字符画代替 Kitty Graphics；不得直接覆盖 WebShell 定制 `ghostty-web.js` bundle；不得绕过 PNG 分块状态机把 APC 发送给 WASM；图片存在时不得仅做局部 Canvas 重绘导致透明 PNG 重复合成或残留；新增静态模块必须同步 Service Worker 预缓存和版本化资源发布。

### LCMD-20260810-02：Kitty Graphics 图片未跟随终端回滚视口

- 日期：2026-08-10
- 来源：用户现场复验：图片显示后拖动终端滚动条，图片位置固定，未与字符内容同步移动
- 影响模块：`runtime/static/kitty_graphics.js` 图片 placement 绘制与 Ghostty-Web renderer viewport
- 根因：placement 只保存活动屏幕 `cellY`，绘制时没有使用终端 scrollback 长度和 `viewportY` 换算；滚动渲染也只在底部视口绘制图片。
- 实施方案：记录 placement 的绝对缓冲行号；每次 renderer 绘制按 `absoluteRow - scrollbackLength + viewportY` 计算屏幕行，并在任意 viewport 强制完整重绘后绘制图片。
- Guard：`kitty_graphics_test.mjs` 新增 scroll viewport 测试，验证回滚 2 行后图片从第 3 行移动到第 5 行；原有整屏清除、局部清除、PNG 和 Kitty `icat` 压缩流测试继续通过。
- 验证结果：Node Kitty 测试 8/8 通过，JavaScript 语法检查和 `git diff --check` 通过；待安装 `1.0.22` 后在目标 WebShell 实机滚动复验。

### LCMD-20260810-03：Kitty 图片未占用字符网格导致后续提示符被遮挡

- 日期：2026-08-10
- 来源：用户安装 `1.0.22` 后复验：图片已随滚动条移动，但回车后的下一行出现在图片下层
- 影响模块：`runtime/static/kitty_graphics.js` Kitty placement 光标移动语义
- 根因：Kitty 0.48.2 `icat` 在图片 APC 后只输出一个尾随 CRLF，依赖 Graphics Protocol 默认 `C=0` 先把终端光标移动到图片网格之后；运行时适配器此前忽略 `C`，Canvas 图片没有在字符网格中占用对应行。
- 实施方案：对齐 Ghostty 原生 Kitty Graphics 行为。`C=0` 时根据 `r`，或根据 `s/v`、PNG IHDR 与终端单元格尺寸计算图片网格行列，按图片行数注入 IND 以正确处理屏幕底部和 scrollback，再定位到图片右侧；`C=1` 和虚拟 placement 不移动光标。移动序列在 APC 与后续普通文本之间同步交给 VT parser，避免异步图片解码打乱顺序。
- Guard：新增默认光标移动和 `C=1` 测试，固定图片 APC 后的 VT 字节顺序；Kitty Graphics Node 测试共 10/10 通过。
- 验证结果：抓取 Kitty 0.48.2 `icat --transfer-mode=stream` 的真实 PTY 输出，确认传输为 `a=T,f=24,o=z,s=800,v=551` 且 APC 后仅有 CRLF；完整 Go 测试、竞态测试、JavaScript 语法检查和 `git diff --check` 通过。待安装 `1.0.23` 后实机复验提示符位置。

### LCMD-20260810-04：Kitty 图片左侧出现额外空白

- 日期：2026-08-10
- 来源：用户安装 `1.0.23` 后现场复验：图片可随终端滚动且后续文字位于图片下方，但图片左侧仍出现额外空白，未贴合终端左边缘
- 影响模块：`runtime/static/kitty_graphics.js` Kitty placement 坐标和源图裁剪绘制
- 根因：Kitty Graphics 协议的大写 `X/Y` 表示当前字符格内的像素偏移，小写 `x/y/w/h` 表示源图裁剪矩形；运行时适配器错误地把 `X/Y` 加到字符列/行，把 `x/y` 当作目标像素偏移并把 `w/h` 当作目标尺寸。`icat` 为单元格对齐发送 `X=2` 时，2 像素会被放大成 2 个字符格，形成明显的左侧空白。
- 实施方案：placement 固定以 Ghostty 当前光标字符格为原点，大写 `X/Y` 仅作为 Canvas 目标像素偏移；小写 `x/y/w/h` 按协议裁剪源图，`c/r` 单独决定目标字符格尺寸，只指定一个维度时按源图比例推导另一个维度。保留 `icat` 在 APC 前发送 `CR` 后从第 0 列放置全宽图片的顺序语义。
- Guard：`kitty_graphics_test.mjs` 将 `X=3,Y=4` 固定为 3/4 像素目标偏移，新增小写源图裁剪九参数 `drawImage` 测试，并模拟真实 `icat` 的 `CR + APC` 顺序，要求全宽图片最终绘制坐标严格为 `x=0`；Kitty Graphics Node 测试共 12/12 通过。
- 验证结果：`node --test kitty_graphics_test.mjs` 12/12、相关 JavaScript 语法检查、完整 `go test ./...`、`go test -race ./...` 和 `git diff --check` 通过。`lzc-cli project release` 已生成 `cloud.lazycat.webshell.lcmd-v1.0.24.lpk`，包内 `.lpk-version` 与 `package.yml` 均为 `1.0.24`，包含修正后的 Kitty placement 坐标和源图裁剪代码且不包含 Node 测试文件；LPK SHA-256 为 `3f9448dee59caa0090100c3da399c66f13d1b357dba454e75a9f21393bdac4aa`。

### LCMD-20260810-05：同版本 WebShell 更新继续命中旧 WASM

- 日期：2026-08-10
- 来源：用户怀疑 WebShell 更新后前端通常不会更新 `ghostty-vt.wasm`，对构建、LPK 内容、静态响应与 Service Worker 缓存链进行核查
- 影响模块：LPK 静态资源版本、Service Worker app-shell cache、Ghostty WASM 构建与 WebShell runtime 同步
- 错误现象：独立 WebShell LPK 如果在内容变化后复用相同 `package.yml` 版本，页面刷新和部署重启提示仍请求相同 `/assets/<version>/ghostty-vt.wasm`。该响应被声明为一年 immutable，Service Worker 又对当前版本资源 cache-first，因此浏览器会持续返回旧 WASM。另一个独立风险是 WebShell 发布脚本只复制现有 `runtime/`，不会构建或校验 `ghostty-web/ghostty-vt.wasm`，源码 WASM 与随包 WASM 可能依赖人工同步。
- 根因：静态资源身份只包含声明版本，没有包含实际内容摘要；同 URL 与 immutable/cache-first 合同要求内容永不变化，但构建脚本没有强制版本唯一性。Ghostty Web 和 WebShell 是两个独立源码目录，根构建入口此前没有任何跨目录哈希 guard。
- 实施方案：LPK 构建在二进制和 runtime 复制完成后生成 `.lpk-content-revision`，Provider 将资源版本统一组成 `<lpk-version>-<24位内容摘要>`；声明版本或内容摘要任一变化都会使旧 URL 立即 404，并生成新的 Service Worker cache。缺少构建元数据的 Admin 内嵌和开发环境继续使用现有内容哈希回退。WebShell 仓库新增 `tools/sync-ghostty-web-assets.sh` 并由 `lzc-build.yml` 直接执行 `--check`：相邻 Ghostty 源码可用时比较源 WASM 与随包 WASM，独立检出时至少验证随包 WASM 文件头；`--sync` 只构建 JavaScript 并同步现有 WASM/许可证，`--rebuild-wasm` 仅用于 Ghostty 子模块、patch 或 ABI 变化。LPK version 提升到 `1.0.25`。
- Guard：`TestComputeAssetVersionUsesLPKVersionAndContentRevision` 固定声明版本与内容摘要组合；`TestVersionedStaticFileServerTracksSameVersionContentWithoutRestart` 固定同版本摘要变化后旧 URL 404、新 URL 200；`TestBuildWritesPackageVersionForRuntimeAssets` 固定 LPK 执行仓库内 WASM 校验并同时生成版本与内容摘要元数据。
- 验证结果：定向及完整 `go test ./...`、`go test -race ./...`、Kitty Graphics Node 测试 12/12、相关 JavaScript 语法检查、shell 语法检查和 `git diff --check` 通过；`tools/sync-ghostty-web-assets.sh --check` 确认两份 WASM SHA-256 均为 `65a99188312ad92780b3af2fa410b8af395536dfe1e777ec24573d8be1436f16`，并验证 Ghostty 源码目录缺失时仍能检查随包 WASM 文件头。`lzc-cli project release` 生成 `dist/cloud.lazycat.webshell.lcmd-v1.0.25.lpk`，LPK SHA-256 为 `ec71e36d8151d667802e71735021410ae5f6448cabfaba00128e8dc2b3cd9dcb`；包内 `.lpk-version` 为 `1.0.25`，`.lpk-content-revision` 为 `ee3bd1377d40d1890b8a9167f340712ef8a55b50f9d041cca32ab4b8046980b8`。运行包内 Provider 后，首页和 Service Worker 均注入 `1.0.25-ee3bd1377d40d1890b8a9167`，对应 WASM 返回 `application/wasm` 与 `public, max-age=31536000, immutable`。
- 禁止复现：不得让 immutable 资源 URL 只依赖可复用的人工版本号；不得把同 URL 指向不同 JS/WASM 内容；不得让 LPK 构建跳过仓库内 Ghostty WASM 校验；纯 TypeScript 修改不得无条件触发昂贵的 WASM 重建。

### LCMD-20260812-01：高频终端输出导致主线程高 CPU 和超大批次内存风险

- 日期：2026-08-12
- 来源：Codex/Agent WebShell 高频实时输出 CPU 现场问题
- 影响模块：`runtime/static/main.js`、`runtime/static/ghostty-web.js`、`runtime/static/kitty_graphics.js`、运行时静态 guard
- 错误现象：终端持续输出时 CPU 从个位数升至 50%～70%；异常大输出可能形成超大前端队列、一次性 WASM 分配和主线程长任务。
- 根因：每个输出批次都请求整屏 Canvas 渲染；`force flush` 可以无上限合并队列；Ghostty WASM 写入入口没有单次输入边界和分配失败检查；Kitty 适配器为每个二进制块创建完整字符串并扫描控制序列。
- 实施方案：WASM 写入按 128 KiB/32 KiB 字符块处理并检查分配失败；所有 flush 批次保持 128 KiB 上限；输出消息和队列设置 4 MiB 硬边界，过载通过历史游标重同步恢复；普通输出改为 33ms 合并渲染请求，结构性事件继续 full render；普通输出交由 Ghostty dirty 状态决定脏行/整屏；Kitty 使用复用 `TextDecoder` 的 128 KiB 流式解码。
- Guard：`TestRuntimeTerminalOutputBatchingGuard` 固定输出软/硬限制、force flush 分片和过载重同步；`TestRuntimeTerminalCanvasResidueGuard` 固定 WASM 分片、分配失败保护、渲染限频和 dirty/full 渲染边界；`kitty_graphics_test.mjs` 继续覆盖跨 chunk 控制序列与图片行为。
- 验证结果：核心改造阶段的 `go test ./...`、`go test -race ./...`、Kitty Graphics Node 测试、相关运行时 JS `node --check` 和 `git diff --check` 已通过。本轮控制边界、指标、零拷贝与 Canvas 热路径收尾尚待统一回归；真实浏览器 CPU、内存峰值和长任务时长仍需在目标 WebShell 页面使用纯文本、ANSI/TUI 和 Kitty 输出分别录制 Performance profile。
- 禁止复现：不得恢复无上限 `force flush` 合并；不得绕过统一 WASM 分片入口；输出过载不得静默丢弃且必须能够通过历史游标恢复；普通高频输出不得重新强制每批 full Canvas render；Kitty 不得每 chunk 新建完整解码器或把大块二进制一次性转成字符串。
- 后续收尾：Kitty 控制扫描只保留未完成的 `ESC`/`CSI` 尾巴，普通文本在控制序列后恢复快速路径，并复用流式 `TextDecoder` 保证跨二进制分片 UTF-8 不损坏；输出队列在入队前执行 4 MiB 硬阈值，性能指标增加峰值语义且所有指标访问带兼容 guard；历史缓存队列复用已有不可变 `Uint8Array` 视图，持久化边界仍由 Cache API/IndexedDB 完成复制；大文本字节数测量改为固定缓冲分片编码，避免为整条字符串分配等长临时字节数组；Canvas 空格快速路径保留悬停超链接装饰例外。

### LCMD-20260813-01：调试模式增加移动端远程桌面入口开关

- 日期：2026-08-13
- 来源：用户需求
- 影响模块：`runtime/static/index.html`、`runtime/static/main.js`、LightOS 首页返回链路
- 错误现象：移动端远程桌面入口默认隐藏，缺少调试模式下可控的恢复入口。
- 根因：WebShell 只有调试模式总开关，没有独立保存并传递移动端远程桌面授权的设置。
- 实施方案：在调试选项中增加默认关闭的“允许移动端启用远程桌面”开关；设置值保存在本地，返回 LightOS 首页时通过一次性查询参数同步，首页消费后立即清理参数。
- Guard：`TestRuntimeDebugModeOnlyTogglesOptionsList` 固定开关位于调试选项、默认读取关闭并持久化；`TestRuntimeHomeNavigationUsesResolvedAdminURL` 固定返回首页携带开关值。
- 验证结果：运行时包版本提升至 `1.0.27`；`node --check runtime/static/main.js`、`go test ./... -run 'TestRuntime(DebugModeOnlyTogglesOptionsList|HomeNavigationUsesResolvedAdminURL)' -count=1` 和完整 `go test ./... -count=1` 通过；LightOS 首页定向测试另行通过。
- 禁止复现：不得默认开启移动端远程桌面；不得把开关状态混入性能监视器或调试模式总开关；不得长期把设置值暴露在首页 URL 中。

### LCMD-20260813-02：opencode 与 herdr fullscreen TUI 在移动端无法滚动

- 日期：2026-08-13
- 来源：用户现场问题
- 影响模块：`runtime/static/main.js`、fullscreen TUI 触摸适配、移动端终端 mouse tracking
- 错误现象：opencode、herdr 等 fullscreen TUI 在手机上上下滑动时，列表不滚动，历史对话无法查看；单指手势被通用终端 mouse tracking 当成按下/拖动。
- 根因：现有 Claude fullscreen 触摸适配只识别 Claude，其他开启终端鼠标跟踪的 TUI 继续进入通用 touch mouse 路径，发送 press/move/release 而不是把位移转换为终端 wheel 事件。
- 实施方案：保留 Claude 现有专用适配和 Grok 既有行为；新增独立的 `opencode_fullscreen_touch.*` 与 `herdr_fullscreen_touch.*` 模块，分别负责各自命令/标题识别和安装入口。二者只共享不含工具身份判断的底层触摸手势机械模块：单指移动超过阈值后按终端行高累积并发送 wheel，tap 发送 click，长按复用 WebShell 本地选择；适配器按“默认选择 -> Claude -> opencode -> herdr -> 通用 mouse tracking”顺序安装，未匹配会话保持原路径。
- Guard：`TestOpencodeAndHerdrFullscreenTouchAdapters` 覆盖两种工具的命令、路径、Node launcher、标题识别、互斥匹配和 wheel 手势；`TestRuntimeOpencodeHerdrFullscreenTouchAdapterIsolation` 固定独立模块、安装顺序，并禁止 Claude 和通用 mouse tracking 出现 opencode/herdr 分支。
- 验证结果：定向 Go/Node 行为测试、完整 `go test ./... -count=1`、`node --check`（新增模块、`main.js`、Service Worker）和 `git diff --check` 均通过；真实 iOS Safari、Lazycat WKWebView 与 Android WebView 仍需按设备矩阵复验 opencode/herdr 的滑动、点击、长按选择、双击键盘以及 Claude/Grok 回归。
- 禁止复现：不得把 opencode/herdr 身份判断并入 Claude、Grok 或通用 mouse tracking；不得在通用路径中增加针对工具名称的分支；不得在未确认工具身份和 mouse tracking 的情况下抢占所有 TUI 触摸事件；工具行为变化时只修改对应工具适配层。

### LCMD-20260814-01：中文预编辑文本增长导致终端逐级上移

- 日期：2026-08-14
- 来源：用户现场问题；中文输入法处于未确认 composition 状态时，每增加若干中文字符页面底部留白继续增大，终端内容被逐级向上推
- 影响模块：`runtime/static/main.js` 终端 helper textarea、IME composition 预览、移动端 `visualViewport` 键盘避让与终端 viewport pan
- 错误现象：英文输入或短中文预编辑时终端位置稳定；中文预编辑文本持续增长后，输入区域看似不断增高，页面底部出现越来越大的空白。实际 textarea CSS 高度没有主动增加，未确认文本也尚未发送到 PTY。
- 根因：Ghostty helper textarea 被定位在终端光标处并限制为一个字符格宽，但浏览器仍需在该原生可编辑控件内维护完整 IME 预编辑值和组合光标。部分移动 WebView/IME 会随狭窄控件中的预编辑内容增长调整内部组合光标、候选窗锚点或 `visualViewport`；WebShell 又把这些 composition 期间的瞬时 viewport 高度/inset 变化当成键盘几何变化，更新底部 dock 并重新计算 `terminalViewportPanY`，从而把宿主波动逐级放大为终端上移和底部留白。现有 host viewport guard 只清理 `terminal-host` 的滚动和多余节点，没有固定 textarea 自身的单行几何，也没有为 composition 建立稳定 viewport 基线。
- 实施方案：helper textarea 显式设置 `rows=1`、`wrap=off`、固定且相同的 height/min-height/max-height、禁止纵向 overflow/wrap，并使用从当前光标到终端右边界的稳定宽度，不再保持单字符格宽；预编辑预览继续由独立绝对定位元素绘制并限制在剩余终端宽度。composition 开始前先同步一次真实键盘 viewport，然后锁定当前 viewport height、reference height、键盘 inset、安全偏移和终端 pan；composition update 期间忽略后续 IME 瞬时 viewport 波动，composition end、blur、session 清理或方向变化时释放锁并重新同步真实 viewport。保留原生 composition 默认行为和现有重复上屏去重，不通过清空 textarea 或 `preventDefault()` 修复。
- Guard：扩展 `TestRuntimeMobileIMECompositionPreviewVisible`，固定单行 textarea 属性、稳定宽高、预览边界、composition viewport 锁的捕获/应用/释放路径，并禁止恢复成单字符格宽；原有 guard 继续禁止 composition 分支清空 textarea、镜像写入 `event.data` 或阻止默认事件。
- 验证结果：IME/resize 定向 Go 测试、完整 `go test ./... -count=1`、`go test -race ./... -count=1`、`node --check runtime/static/main.js`、Service Worker JavaScript 语法检查和 `git diff --check` 通过。真实 iOS Safari、Lazycat WKWebView、Android WebView 与 Windows WebView 仍需复验连续中文预编辑、候选词切换、删除、语音输入、确认上屏、键盘收起和屏幕旋转。
- 禁止复现：终端 helper textarea 不得恢复为单字符格宽的多字符原生预编辑载体；composition 文本长度不得改变 textarea 块方向尺寸；composition 期间不得把 IME 候选窗引起的 viewport 波动继续累加到 terminal pan 或移动底部 dock；不得以阻止原生 composition 默认行为换取几何稳定。

### LCMD-20260814-02：终端行尾继续中文输入仍触发一次上移

- 日期：2026-08-14
- 来源：LCMD-20260814-01 修复后的用户复验；普通位置已稳定，但单行最后一个中文字符后继续输入仍会向上移动
- 影响模块：`runtime/static/main.js` helper textarea 锚点、中文 composition 生命周期和移动端 viewport 锁
- 错误现象：上一版把 textarea 宽度改为“终端光标到行尾的剩余宽度”，所以问题不再每个字符触发，而是在光标到达行尾、textarea 再次退化为一个字符格宽时触发。每个候选确认后的 `compositionend` 还会释放锁，下一次 `compositionstart` 把已经发生的上移重新保存为新基线。
- 根因：原生 IME 输入载体仍随终端光标列/行移动，且其几何边界在行尾变窄；composition 预览虽然独立绘制，但浏览器仍会为原生 textarea 的组合光标和候选窗执行避让。viewport 锁按单次 composition 生命周期工作，无法覆盖连续中文候选之间的焦点会话。
- 实施方案：textarea 在焦点会话内固定在首次输入位置，使用终端整行宽度和固定高度，并通过 text indent 保留初始候选锚点；终端光标位置只更新独立 `.terminal-composition-preview`。viewport 锁改为焦点会话级，compositionend 不释放，只有 textarea 失焦、键盘检测到真实收起、方向变化或 session 清理才释放；键盘重新收起时仍允许真实 viewport 恢复。
- Guard：扩展 `TestRuntimeMobileIMECompositionPreviewVisible`，禁止恢复按光标剩余宽度计算的 textarea、固定焦点锚点和整行宽度，并固定 compositionend 不释放 viewport 锁、blur/keyboard close/方向变化释放锁。
- 验证结果：本轮定向 Go IME/resize 测试、完整 `go test ./... -count=1`、`go test -race ./... -count=1`、`node --check runtime/static/main.js`、Service Worker JavaScript 语法检查和 `git diff --check` 均通过。真实 iOS Safari、Lazycat WKWebView、Android WebView 与 Windows WebView 仍需复验连续中文、行尾换行、候选切换、删除、语音输入、键盘收起和旋转。
- 禁止复现：textarea 不得再次跟随终端光标列缩小或跟随光标行移动；不得在每个 `compositionend` 释放并重建 viewport 基线；不得让候选预览承担原生 IME 输入载体职责；不得通过阻止 composition 默认事件修复几何问题。

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
