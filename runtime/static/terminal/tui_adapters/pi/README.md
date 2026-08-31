# pi Fullscreen 适配

本模块只负责精确 pi 身份判断和 fullscreen 触摸 adapter，通用手势机械逻辑来自 `../common/index.js`。外部通过 `pi/index.js` 导入；listener、timer 和手势状态由通用 adapter 的 cleanup 随 session 销毁。

文件为 `pi_fullscreen_touch.js` 和 `pi_fullscreen_touch_adapter.js`。相关 guard 位于 `pi_fullscreen_touch_test.go`；必须同时验证 Claude、opencode、herdr 和普通终端不被误匹配。
