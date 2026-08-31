# Service Worker 退役真实环境回归

本用例使用真实 Chrome 和临时同源 HTTP fixture，并允许浏览器 Service Worker。fixture 在 `/service-worker.js` 上先提供模拟历史 Worker，让页面进入受控状态并写入旧 app-shell/terminal Cache；随后把同一 URL 切换为当前工作区的 `legacy_service_worker_retirement.js`，并通过一次普通页面导航执行生产 `runtime/static/index.html` 中的前置更新脚本。测试代码不得直接调用 `registration.update()`，以确保真实页面能够主动发现退役 Worker。用例验证退役 Worker 自动接管、精确删除旧 Cache、注销 registration，并在用户触发的导航之外只让原受控页面再导航一次。测试结束后返回真实 `debug123` WebShell，确认终端重新连接并显示。Provider 的实际路由、响应头和 LPK 打包内容由 Go/构建测试独立固定。

运行：

```sh
HEADLESS=1 \
WEBSHELL_LOCAL_STATIC_DIR= \
node tests-auto/run-playwright.mjs tests-auto/11-service-worker-retirement/test.mjs
```

不得设置 `WEBSHELL_LOCAL_STATIC_DIR`，因为统一运行器在本地静态映射模式下会阻止 Service Worker。测试还验证干净的移动浏览器上下文没有 registration、不请求 `/service-worker.js` 且只发生用户要求的一次页面导航；退役完成后的桌面页面必须恢复终端 Canvas，且等待窗口内不得发生第二次自动导航。发布前仍应在设备允许安装 LPK 时补做一次不经过路由替换的真实包升级验证。
