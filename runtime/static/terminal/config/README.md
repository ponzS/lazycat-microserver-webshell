# 终端配置模块

## 职责

本目录只保存终端责任域使用的不可变默认值、阈值和超时参数。它不创建连接，不维护 session、workspace、缓存或 UI 状态，也不注册浏览器资源。

## 公开入口

外部只能从 `index.js` 导入 `TERMINAL_RUNTIME_CONFIG` 和 `TERMINAL_STORAGE_PREFIX`。配置对象被冻结，调用方不得修改其字段。

## 文件清单

- `index.js`：终端配置模块的唯一公开入口。
- `terminal_config.js`：终端交互、连接、缓存、回放、resize 和活动轮询的共享常量。
- `README.md`：职责、边界和验证说明。

## 状态与生命周期

本模块没有可变状态、timer、observer、listener 或 socket，也不负责任何启动和销毁流程。全局 runtime 负责在创建各 controller 时读取配置并保持初始化顺序。

## 依赖方向与验证

配置模块不依赖 `global-runtime.js` 或任何具体 controller。相关行为由各终端子模块测试覆盖；`terminal_config_test.mjs` 验证公开入口、默认值和不可变性，静态 runtime guard 验证根入口不再重复声明这些常量。
