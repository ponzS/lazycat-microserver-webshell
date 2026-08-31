# Node 行为测试

本目录统一维护前端模块的 Node 行为测试。测试文件使用 `*_test.mjs` 命名，根目录不再放置 Node 测试；真实浏览器和设备用例继续放在 `tests-auto/`。

## 运行

在仓库根目录执行全部 Node 测试：

```sh
node --test tests/*.mjs
```

单个测试也从仓库根目录执行，例如：

```sh
node --test tests/terminal_presentation_controller_test.mjs
```

测试从 `tests/` 目录引用运行时代码时使用 `../runtime/...`。Go 行为测试和脚本中的 Node 调用必须使用 `tests/<file>_test.mjs` 路径。测试只验证模块行为和边界，不属于发布到 `runtime/static/` 的资源。
