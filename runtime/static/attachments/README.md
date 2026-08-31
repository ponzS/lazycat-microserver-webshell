# Attachments 模块

## 职责

本目录负责附件弹层、剪贴板导入、文件选择上传、上传进度面板、远端文件浏览、排序、选择和下载。上传仍限制为单批最多 32 个文件、单文件最大 2GB；下载最多 64 个条目。

本模块不负责实例权限、账号鉴权、远端路径解析、符号链接安全或归档实现。浏览器只调用 Provider 的 `/api/attachments`、`/api/attachments/files` 和 `/api/attachments/download` 路由；目标可见性、路径授权和客户端票据仍由服务端校验。

## 公开入口

外部只能从 `index.js` 导入 `createAttachmentsController()`。控制器公开 `start()`、`dispose()`、`openDialog()`、`closeDialog()`、`openBrowser()`、`closeBrowser()`、`closeAll()`、`importFromClipboard()`、`selectFiles()`、`handleEscape()`、`handleTargetChange()`、`handleTabRemoved()`、`refreshUploadPanels()`、`isAnyOpen()` 和只读 `snapshot()`。

`global-runtime.js` 只转发快捷键和菜单动作，在 tab 激活、搜索面板变化、实例切换、tab 删除、全局 Escape、启动和销毁时调用这些公开方法。外部不得读取或修改附件内部状态。

## 状态所有权

`attachments_controller.js` 是以下状态的唯一 owner：

- 附件选择弹层和文件浏览器开关。
- 当前浏览目标、路径、父路径、entries、排序、选择集合和请求 generation。
- 上传记录、XHR、进度、结果路径、自动关闭 timer 和创建时绑定的实例/tab。
- 剪贴板读取 generation 与文件选择前建立的 ClipboardItem reservation。
- 移动端边缘返回手势和延迟聚焦 generation。

View 只维护实际 DOM 节点及上传面板节点映射；API 只执行白名单 HTTP/XHR 请求；clipboard 只适配浏览器剪贴板能力；lifecycle 只注册和移除静态事件。它们都不能修改 controller 状态。

## 生命周期

- `start()` 幂等注册附件弹层、浏览器、触摸和文件输入 listener。
- 浏览器请求同时校验目标、browser generation、打开状态和 dispose 状态；实例切换或关闭弹层后，旧响应不能覆盖当前 UI。
- 每个上传绑定创建时的实例和 tab。关闭 tab、切换目标或 `dispose()` 会先从 owner map 移除，再取消 XHR、timer、ClipboardItem reservation 和 DOM 面板，迟到回调只能成为空操作。
- 剪贴板读取使用独立 generation；读取期间切换实例或销毁页面后不能继续发起上传。
- `dispose()` 幂等移除全部 listener、RAF、timer、XHR、剪贴板 reservation、body class 和动态上传面板。

## 文件清单

- `index.js`：模块唯一公开入口。
- `attachments_controller.js`：状态 owner、浏览/上传事务和跨层编排。
- `attachments_api.js`：Provider 附件白名单 URL、列表 fetch 和上传 XHR。
- `attachments_clipboard.js`：剪贴板文件读取、文本降级和延迟 ClipboardItem reservation。
- `attachments_model.js`：路径、entry、排序、大小、下载文件名和上传限制的纯逻辑。
- `attachments_view.js`：弹层、文件列表、面包屑、排序控件、下载触发和上传面板 DOM 适配。
- `attachments_lifecycle.js`：静态 listener 的注册与清理。

## 依赖方向

`global-runtime.js -> attachments/index.js -> attachments_controller.js`。Controller 可以依赖本目录 API、clipboard、model、view 和 lifecycle；内部文件不得反向导入 `global-runtime.js`、工作区、终端 transport、历史或渲染实现。

当前目标、cwd、tab ID、活动 tab 和搜索面板状态通过只读 `getContext()` 进入模块；上传面板通过 `getTabHost(tabId)` 获取指定 tab 的挂载节点。模块不得修改 workspace 或 terminal session 对象。

## 测试与回归

- `attachments_controller_test.mjs`：目标切换迟到响应、客户端根路径、排序/选择/下载、上传进度与路径复制、tab/dispose 清理和真实 listener 移除。
- `runtime_shortcuts_test.go`：公开入口、README、`global-runtime.js` 边界、Service Worker 资源和旧实现移除契约。
- `attachments_test.go`：服务端账号与实例授权、客户端代理、32 文件/2GB 上传限制、64 条下载、路径和归档安全。

最小回归步骤：从剪贴板和文件选择器分别上传；确认进度、路径复制、手动关闭和 5 秒自动关闭；在上传中关闭 tab 或切换实例；打开文件浏览器验证容器 cwd 与客户端 `/` 起点、目录导航、三种排序、单文件和多选下载；在列表请求过程中关闭浏览器或切换实例，确认旧响应不再更新页面。
