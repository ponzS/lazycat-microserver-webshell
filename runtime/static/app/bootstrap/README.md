# 应用 Bootstrap

## 职责与边界

本目录负责应用启动阶段的模块 start 顺序、Ghostty/主题/设置/实例并行准备、首次 workspace 请求与 apply/retry 分流、启动失败呈现、浏览器持久存储申请和 Service Worker 注册。它只通过显式回调协调公开模块，不实现终端连接、历史回放、Canvas 渲染、resize、输入或 workspace 数据模型。

启动失败必须先等待 Ghostty 初始化完成，再创建不可连接的错误 tab；已有终端的历史 replay、snapshot、resize 或重连中间过程仍不得显示。

## 公开入口与状态所有权

外部只能从 `app/bootstrap/index.js` 导入。`bootstrap_controller.js` 唯一拥有启动事务；`bootstrap_lifecycle.js` 唯一拥有 started/disposed/generation；`storage_persistence_controller.js` 唯一拥有一次性 storage request 状态；`service_worker_controller.js` 唯一拥有注册 Promise。所有 `dispose()` 幂等，迟到的 prerequisites、workspace 和错误终端创建必须受 generation/disposed guard 限制。

## 文件

- `index.js`：唯一公开入口。
- `bootstrap_controller.js`：启动、首次 workspace 分流、activity 启动和失败终端编排。
- `bootstrap_lifecycle.js`：单次启动、generation 和 dispose fence。
- `storage_persistence_controller.js`：`navigator.storage` persisted/persist/estimate 请求与日志。
- `service_worker_controller.js`：安全上下文中的 Service Worker 单次注册与错误日志。

## 依赖与验证

依赖由 `global-runtime.js` 注入，不直接导入业务模块。行为测试为 `app_bootstrap_controller_test.mjs`，静态边界为 `TestRuntimeAppBootstrapModuleBoundary`。最小回归是首次进入、无预选 target、settings 加载失败、workspace 暂时失败、target 在启动期间切换、存储授权拒绝、Service Worker 注册失败和 Ghostty 启动失败；确认没有重复启动、迟到 apply 或历史中间帧。
