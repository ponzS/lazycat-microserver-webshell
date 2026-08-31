# 应用 Bootstrap

## 职责与边界

本目录负责应用启动事务：启动 feature controller，并行等待 Ghostty、主题、设置和实例列表，执行首次 workspace 请求/apply/retry 分流，以及启动失败时的错误终端呈现。

本模块不负责终端连接、历史回放、Canvas、resize、输入或 workspace 数据模型，也不申请浏览器持久存储、不注册 Service Worker。任何终端历史、snapshot、resize 或重连中间过程都不得显示。

## 公开入口与状态所有权

外部只能从 `app/bootstrap/index.js` 导入：

- `createAppBootstrapController()`：启动事务和失败处理的唯一 owner。
- `createAppBootstrapLifecycle()`：started/disposed/generation 的唯一 owner。
- `createLegacyWebShellStorageCleanupController()`：迁移期一次性注销本 WebShell 旧 Service Worker，并删除已知旧 app-shell/terminal Cache API 记录。

旧存储清理器不读取终端数据、不参与启动呈现，也不创建新缓存。其 `cleanup()` 和全部 `dispose()` 都必须幂等，并拒绝销毁后的迟到操作。

## 文件清单

- `index.js`：唯一公开入口。
- `bootstrap_controller.js`：启动、首次 workspace 分流、activity 启动和失败终端编排。
- `bootstrap_lifecycle.js`：单次启动、generation 和 dispose fence。
- `legacy_storage_cleanup_controller.js`：精确匹配旧 Worker URL 和已知缓存名的一次性清理。

## 依赖与验证

依赖由 `global-runtime.js` 注入，不直接导入业务模块。行为测试为 `app_bootstrap_controller_test.mjs`、`legacy_storage_cleanup_controller_test.mjs`，静态边界由 `TestRuntimeSnapshotOnlyAndPWARemovalContract` 和 bootstrap/runtime guard 覆盖。

最小回归包括首次进入、无预选 target、settings/workspace 失败、启动期间切换 target、Ghostty 失败、存在旧 Worker/缓存和无旧状态场景；确认不会重复启动、迟到 apply、误删其他应用缓存或显示历史中间帧。
