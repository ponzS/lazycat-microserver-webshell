# WebShell 图片、文件与文本粘贴修复任务清单

## 计划状态

- 状态：用户已批准，修复和验证已完成
- 执行门禁：用户已明确回复“开始执行”
- 当前阶段：实现完成；目标真实浏览器场景、Node、Go 和用户手动验证通过
- 本文用途：保存本次会话中的修复范围、验收口径、实施顺序和验证要求，避免上下文丢失

## 执行结果摘要

- 场景目录：`tests-auto/16-attachment-native-paste/`
- 修复前目标基线：`artifacts/2026-09-04T08-43-15-000Z/`，Chrome 已产生 PNG file paste，但没有附件 POST。
- 修复后最终自动化：`artifacts/2026-09-04T09-06-04-709Z/`，desktop/mobile 文本、系统 PNG、双文件、手动上传路径和权限降级均通过。
- 行为测试：`node --test tests/*.mjs`，432/432 通过。
- Go 测试：`go test ./... -count=1` 通过。
- 构建：`npm run build` 通过，Vite 产物保持 4 个 JavaScript 文件。
- 人工验证：用户于 2026-09-04 确认通过；具体设备、系统和宿主版本未提供。
- 未运行：`./tests-auto/test-all.sh` 全场景串行回归。

## 当前症状

- PC 和移动端均无法可靠地把剪贴板中的图片或文件粘贴到终端。
- 手动选择文件可以正常上传。
- 手动上传完成后界面提示“文件路径已复制到剪切板,粘贴即可”，但随后粘贴可能没有反应。

## 已确认的代码结论

1. 终端当前的原生 `paste` 监听器只读取 `clipboardData.getData("text/plain")`，没有读取 `clipboardData.files`、`clipboardData.items` 或 `DataTransferItem.getAsFile()`，因此原生图片/文件粘贴不会进入附件上传流程。
2. “从剪贴板导入附件”、移动端粘贴按钮和菜单粘贴依赖 `navigator.clipboard.read()` 或 `navigator.clipboard.readText()`；这些主动读取 API 可能被安全上下文、Permissions Policy、iframe 或宿主 WebView 策略拒绝。
3. `clipboard-write` 成功不代表 `clipboard-read` 也被允许，所以“路径已复制”与“程序能够主动读回路径”是两个独立条件。
4. 手动文件选择流程关闭附件弹层时没有恢复终端焦点，文件 input 的 `change/cancel` 路径也没有清理焦点。若浏览器或宿主把焦点留在隐藏的 file input，快捷键控制器会把它当作普通交互输入框并在原生粘贴分支前返回。
5. 现有浏览器回归仅向终端 textarea 人工派发带 `text/plain` 的 `paste` 事件；附件 Node 测试使用假剪贴板和假 reservation，没有覆盖真实 Clipboard 权限、文件 MIME、系统快捷键、文件选择器焦点或图片/文件数据传输。
6. 相关 Node 行为测试在审计阶段共运行 21 项并全部通过，说明当前测试没有捕获上述真实场景缺口，而不是证明粘贴功能在真实设备上正常。

## 拟批准的产品口径

- 原生粘贴文本：文本只输入当前终端一次。
- 原生粘贴图片或文件：文件只上传一次，上传完成后把远端路径自动输入触发粘贴的原终端一次。
- 自动输入路径时不发送 Enter。
- 多文件路径转换为安全的路径参数并以空格分隔，避免换行导致 shell 意外执行命令。
- 手动上传继续保留“复制远端路径到剪贴板”的现有行为，同时恢复终端焦点。
- 主动读取剪贴板被宿主禁止时，显示明确、可操作的提示并聚焦终端，等待用户使用系统粘贴，不得静默失败。
- 上传期间即使切换 pane 或 tab，完成结果也只能进入触发操作的原终端；原终端已关闭、实例已切换或 generation 已失效时不得输入迟到结果。

## 合同摘要

- 服务对象：在 PC 浏览器或移动设备上使用 WebShell 的用户。
- 使用条件：存在活动终端，并使用系统粘贴、粘贴菜单、移动端粘贴按钮或附件文件选择器。
- 业务动作：粘贴文本、图片或文件，或者在手动上传完成后粘贴已复制的远端路径。
- 外部结果：文本进入正确终端；图片/文件上传后路径进入正确终端；权限或能力不足时得到明确反馈。
- 范围边界：本次处理浏览器剪贴板、附件上传、终端输入、焦点恢复和生命周期 fence；不改变附件服务端协议、PTY 协议、WebSocket 架构、终端渲染器，也不引入 `tmux` 或 `xterm.js`。

## 验收场景草案

### AC-1：原生文本粘贴只发送一次

```text
Given 用户在 PC 或移动端打开一个连接真实 Provider、persistent agent 和 PTY 的终端
And 剪贴板中包含普通文本
When 用户在终端执行系统粘贴
Then 文本只进入触发操作的终端一次
And bracketed paste 模式保持生效
And 不产生重复的 paste/beforeinput 输入
```

### AC-2：原生图片或文件粘贴完成上传并输入路径

```text
Given 用户在 PC 或移动端打开一个真实终端
And 剪贴板中包含图片或文件
When 用户在终端执行系统粘贴
Then 文件只上传一次
And 返回路径只输入触发操作的原终端一次
And 不自动发送 Enter
And 核心链路不依赖主动 clipboard-read 权限
```

### AC-3：手动上传后可以立即粘贴路径

```text
Given 用户通过文件选择器上传文件且远端路径已经复制成功
When 用户不额外点击终端并立即执行系统粘贴
Then 远端路径只进入原终端一次
And 隐藏的 file input 不得吞掉粘贴快捷键
```

### AC-4：权限失败不得静默

```text
Given 当前宿主禁止网页主动读取剪贴板
When 用户点击菜单或移动快捷栏中的粘贴动作
Then 界面显示可操作的权限提示
And 终端输入目标获得用于系统粘贴的焦点
And 不发送空输入或错误输入
```

### AC-5：迟到上传结果不得进入错误终端

```text
Given 用户在终端 A 粘贴文件并开始上传
When 用户在上传完成前切换到终端 B，或关闭终端 A，或切换实例
Then 上传结果不得进入终端 B
And 终端 A 已失效时不得发送任何迟到输入
```

## 修复任务清单

### 1. 建立真实场景与修复前基线

- [x] 已确认编号 `15` 被 `tests-auto/15-vite-cold-start/` 使用，创建 `tests-auto/16-attachment-native-paste/`。
- [x] 先创建符合根目录 `AGENTS.md` 固定章节要求的 `README.md`。
- [x] 在 README 中记录触发条件、用户可见现象、怀疑边界、验证目标、通过标准、真实依赖和运行前提。
- [x] 创建 `test.mjs`，覆盖真实浏览器、Provider、persistent agent、PTY、WebSocket 和附件 API。
- [ ] 修复前先运行目标场景并保留失败截图、trace、JSONL 事件和错误摘要。
- [ ] 记录运行命令、目标实例、浏览器/设备、前端资源来源、剪贴板能力和失败指标。
- [ ] 不通过修改断言、增加固定长等待、无限重试或删除失败步骤制造绿色结果。

### 2. 建立单一粘贴编排入口

- [ ] 在 `runtime/static/app/` 下建立独立 paste 模块及模块 README；若实施前发现已有模块能够完整承担该职责，则复用已有模块并记录判断。
- [ ] 提供单一的 `handleNativePaste(session, event)` 编排入口。
- [ ] 从 `clipboardData.items/files` 提取文件，兼容 `DataTransferItem.getAsFile()` 和 `FileList`。
- [ ] 没有文件时读取事件携带的 `text/plain` 并交给终端文本粘贴。
- [ ] 文件优先于文本，防止同一个剪贴板项目既上传文件又发送派生文本。
- [ ] 对同一轮 `paste`、`beforeinput(insertFromPaste)` 做确定性去重。
- [ ] 公开幂等 `dispose()`，并使用 session/dispose/generation fence 拒绝迟到回调。
- [ ] `global-runtime.js` 只负责依赖接线，不承载 MIME 判断、去重、路径格式化或上传算法。
- [ ] `runtime/static/main.js` 不增加业务代码。

### 3. 完善附件模块公开能力

- [ ] 为附件控制器增加公开的“上传粘贴文件”入口，不允许外部深度导入内部实现。
- [ ] 让上传操作暴露可等待的完成结果，包括上传 ID、创建时上下文和远端路径。
- [ ] 保留原始文件名；图片 Blob 没有有效文件名时生成带正确扩展名的稳定临时名称。
- [ ] 保留现有单批 32 个文件、单文件 2GB 限制。
- [ ] 上传创建时绑定实例、tab、pane 和 generation，不在完成时重新读取活动 pane 作为目标。
- [ ] tab 关闭、实例切换或应用销毁时取消上传或拒绝迟到完成结果。
- [ ] 不再吞掉 `navigator.clipboard.read()` 的权限异常；保留可诊断原因并映射为用户提示。
- [ ] 手动上传继续使用 clipboard reservation 或显式“复制路径”按钮。
- [ ] 文件选择器 `change/cancel` 后清理隐藏 input 的焦点并恢复正确终端焦点。

### 4. 统一终端原生 paste 事件所有权

- [ ] 隐藏 textarea 的 `paste` 监听器改为调用统一粘贴编排入口。
- [ ] terminal host 的兜底 `paste` 监听器调用同一入口。
- [ ] 明确 capture/bubble 和 `preventDefault`/`stopImmediatePropagation` 的唯一所有者。
- [ ] 删除或收敛重复的文本提取逻辑，确保一次原生事件只进入一条发送路径。
- [ ] 文本继续经 terminal clipboard controller 和 input controller 发送，保留 bracketed paste。
- [ ] 文件上传完成后的路径也经现有 input controller 发送，不直接操作 WebSocket。
- [ ] 自动输入路径不附加 CR/LF。
- [ ] session 已关闭或 generation 失效时拒绝迟到路径输入。

### 5. 修复快捷键与移动端降级

- [ ] 修复附件 file input 残留焦点导致 `Ctrl/Command+V` 被交互元素过滤器提前忽略的问题。
- [ ] 为附件 file input 增加有界兜底，但不得放宽普通表单 input、textarea、select 的粘贴隔离。
- [ ] PC 的 `Ctrl/Command+V` 优先依赖浏览器原生 `paste` 事件，不主动读取剪贴板。
- [ ] 保留 `Shift+Insert` 兼容行为并纳入统一去重。
- [ ] 移动端和菜单粘贴在 `clipboard-read` 可用时直接读取并发送。
- [ ] 主动读取被拒绝时显示明确提示、聚焦终端输入目标并等待系统粘贴。
- [ ] 权限失败、空剪贴板和不支持的数据类型均提供可见反馈。

### 6. Node 行为测试

- [ ] 新增 paste orchestrator 测试：文件优先、文本降级、空数据、事件去重和 dispose。
- [ ] 新增图片 Blob、具名文件、多文件和缺失文件名的数据提取测试。
- [ ] 验证上传成功后路径只进入原 session 一次且没有 Enter。
- [ ] 验证 pane/tab 关闭、实例切换和 generation 变化后迟到结果被丢弃。
- [ ] 验证手动文件选择完成及取消后的焦点恢复。
- [ ] 验证附件 file input 不再吞掉终端原生粘贴。
- [ ] 验证普通表单输入框仍保留浏览器默认粘贴，不被终端抢占。
- [ ] 验证 `paste` 与 `beforeinput` 不重复发送文本。
- [ ] 验证 `clipboard-read` 权限失败的提示和聚焦降级。
- [ ] 更新受影响的现有附件、快捷键、session installation、IME 和 clipboard controller 测试。

### 7. 真实 PC 与移动场景验收

- [ ] PC 使用真实系统 `Ctrl/Command+V` 粘贴文本，内容进入真实 PTY 一次。
- [ ] PC 粘贴真实图片，附件上传一次并自动输入远端路径一次。
- [ ] PC 粘贴文件，保留文件名并自动输入远端路径。
- [ ] PC 通过文件选择器上传后，不额外点击终端即可粘贴已复制路径。
- [ ] 移动布局或真实移动设备粘贴文本成功。
- [ ] 移动布局或真实移动设备粘贴图片/文件成功。
- [ ] 多文件上传后路径安全输入且不自动执行命令。
- [ ] 上传期间切换 pane，结果不进入新 pane。
- [ ] 上传期间关闭 tab 或切换实例，不产生迟到输入。
- [ ] 测试期间无未预期 console error、pageerror 和 API error。
- [ ] 单页面 Unified 物理 WebSocket 数量不增加。
- [ ] 现有普通输入、IME、composition、resize 和 history replay guard 不回归。
- [ ] 若真实移动设备无法自动化，按场景 README 记录最小人工步骤、限制原因、预期结果和后续自动化计划；在真机验证完成前明确标记未完全验证。

### 8. 文档同步

- [ ] 新 paste 模块包含职责、非职责、公开 API、状态 owner、生命周期、依赖和测试说明。
- [ ] 更新 `runtime/static/attachments/README.md`。
- [ ] 更新 `runtime/static/terminal/input/README.md` 和 `runtime/static/terminal/input/ime/README.md`。
- [ ] 更新 `runtime/static/terminal/interaction/README.md`。
- [ ] 更新 `runtime/static/terminal/session/README.md`。
- [ ] 因跨模块事件所有权和数据流发生变化，同步更新 `docs/ARCHITECTURE_AND_MODULE_MAP.md`。
- [ ] 修复完成后回填 `tests-auto/16-attachment-native-paste/README.md` 的基线、根因、实施方案、修改文件、命令、结果、限制和防回归断言。

## 计划中的验证命令

修复前基线和修复后目标场景均使用：

```sh
WEBSHELL_LOCAL_STATIC_DIR="$PWD/runtime/static" \
node tests-auto/run-playwright.mjs \
tests-auto/16-attachment-native-paste/test.mjs
```

受影响的 Node 测试至少包括：

```sh
node --test \
  tests/attachments_controller_test.mjs \
  tests/terminal_clipboard_controller_test.mjs \
  tests/app_shortcut_controller_test.mjs \
  tests/terminal_session_installation_controller_test.mjs \
  tests/terminal_ime_controller_test.mjs
```

若新增测试文件，将其加入同一轮 `node --test` 命令。随后运行：

```sh
go test ./...
```

完整真实场景回归：

```sh
./tests-auto/test-all.sh
```

## 完成门槛

- [ ] 修复前失败或等价风险不变量已由目标场景锁定。
- [ ] 修复后 PC 和移动目标场景通过。
- [ ] 受影响 Node 测试和 Go 测试通过。
- [ ] console、pageerror、API error、截图、trace 和 JSONL 事件均符合预期。
- [ ] 文件上传、路径输入、焦点、generation fence 和清理行为均有断言。
- [ ] 没有通过放宽预期、固定长等待、无限重试或删除断言获得绿色结果。
- [ ] 场景 README 和受影响模块/架构文档已经回填。
- [ ] 最终回复列出场景目录、实际测试命令、通过结果和所有未验证项。

## 执行批准

在用户明确批准本计划前，不执行以上任务。建议批准口令：

```text
同意执行 CLIPBOARD_PASTE_FIX_PLAN.md
```
