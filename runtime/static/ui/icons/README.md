# SVG 图标模块

## 职责

`ui/icons/` 维护移动快捷键、上下文菜单和终端截图共用的 SVG path 定义及无状态 DOM 工厂。模块只创建图标节点，不保存 UI 状态、不注册 listener，也不依赖终端、工作区、历史或网络逻辑。

## 文件清单

- `index.js`：唯一公开入口。
- `icon_controller.js`：图标定义、SVG 属性初始化和工厂函数。

## 边界与验证

未知名称使用稳定的默认图标；调用方可以注入 document 和定义集合进行测试。图标创建不会触发 history replay、snapshot、resize 或重连，也不改变 Canvas 呈现状态。
