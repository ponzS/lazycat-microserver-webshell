# WebShell 真机自动测试

## 测试机

- 地址示例：`https://lightos.debug123.heiyu.space/webshell/?name=devos-core%40cloud.lazycat.lightos.entry&tab=tab-4`
- 用户名：`debug123`
- 密码：`123456`
- 这是内网专用测试账号，脚本会在页面出现登录页时自动填写并登录；已有登录态时不会重复登录。
- 示例 URL 中的实例名可能随测试机状态变化。运行器会先读取 `/webshell/api/instances`；指定实例对当前账号不可用时，自动选择第一个 `running` 实例，并把选择结果写入事件日志。
- 测试使用本机安装的 Google Chrome，并以有界面模式打开两个独立窗口。运行环境需要可用的 X11 `DISPLAY`。
- 默认使用 `lzc-os/onbox-tester/e2e/node_modules` 中已安装的 Playwright；也可通过 `PLAYWRIGHT_NODE_PATH` 指定包含 `@playwright/test` 的 Node 模块目录。
- 独立使用本项目时可先在 `tests-auto` 执行 `npm install`，运行器会优先使用本目录的依赖。

## 目录约定

每组用例一个独立目录，目录内至少包含一个 `test.mjs` 和一个 `README.md`。脚本产生的截图、JSONL 点击事件日志、trace 和错误摘要写入该组的 `artifacts/`，不会混入源码。

## 运行全部用例

```sh
cd lazycat-microserver-webshell
./tests-auto/test-all.sh
```

配置文件：

- `tests-auto/.env` 是所有真机用例的统一配置入口，默认账号为 `debug123`、密码为 `123456`，默认 `TEST_FOREGROUND=1`。
- `test-all.sh` 和 `run-playwright.mjs` 都会自动读取该文件，因此直接运行单个测试入口也遵循同一套配置。
- `TEST_FOREGROUND=1`（或 `true/on/yes`）会在桌面前台显示两个 Chrome 窗口；`TEST_FOREGROUND=0`（或 `false/off/no`）使用无头浏览器后台运行。
- 命令行中显式设置的同名变量优先于 `.env`；`HEADLESS=1` 仍可作为兼容方式强制无头运行。

可选环境变量：

- `WEBSHELL_TEST_URL`：覆盖默认 WebShell 地址。
- `HEADLESS=1`：兼容旧调用方式，强制无头模式；真机回归默认不要设置。
- `TEST_ROUNDS`：PC/移动端交替点击轮数，默认 `3`。
- `PW_CHANNEL`：Chrome channel，默认 `chrome`。

总入口按目录名排序后逐组串行执行；任何一组失败会立即停止并返回非零退出码。
