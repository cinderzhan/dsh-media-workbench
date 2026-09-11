# DSH 内容运营工作台

用于管理官号选题、达人合作、Campaign、营销日历、内容数据及每日成果的 DSH Desktop 插件。

界面采用黑白极简风格，日历保留状态颜色。四个窗口支持交换位置、调整大小、收起和恢复；数据支持手动录入，浏览器采集属于实验能力。

## 下载与安装

在本仓库 Releases 下载 `dsh-media-workbench-0.2.0.tgz`，这是 DSH 插件包，不是 Desktop 安装程序。GitHub 托管不会自动安装插件，也不代表已上架插件市场。

v0.2.0 将选题、达人、Campaign 和发布数据整理为紧凑表格。选题输入名称后回车创建，点击名称打开详情；发布数据可筛选官方或达人内容。数据监控支持勾选多条发布记录，以折线图或分组柱状图比较各平台的 24h、72h 和至今数据。至今取最近一次快照，缺失数据保持为空。

在 DSH 中使用需要按对应版本的 Profile 插件流程安装并启用该包，详见 [插件接入说明](packages/dsh-media-workbench/README.md#dsh-插件接入与安装) 与 [宿主插件管理机制](docs/plugin-management.zh.md)。当前未验证通用 Desktop 的一键安装流程。

**兼容性：右侧嵌入的原生 DSH 会话需要 Desktop 提供会话承载接口。** 本仓库附带基于 `@deepseek-ai/dsh-client-ui-layout@0.1.2-rc.1` 的 [宿主参考补丁](patches/@deepseek-ai+dsh-client-ui-layout+0.1.2-rc.1.patch)。它应由 Desktop 维护者集成到匹配版本，不会随插件包自动应用；其他版本需要重新适配。普通浏览器预览只有业务窗口和会话空态。

## 本地预览

需要 Node.js 22 或以上版本：

```sh
npm install
npm run dev:media
```

打开 http://127.0.0.1:4317/ 。如端口已占用，可运行 `MEDIA_PORT=4318 npm run dev:media`。

## 检查与打包

```sh
npm run check
npm test
npm run pack:plugin
```

安装包生成于 `releases/`。常规测试覆盖插件业务和界面布局；`test/media-workbench-layout.test.mjs` 依赖已打补丁的 Desktop 宿主，仅在对应宿主开发环境运行，不包含于独立仓库的默认测试。

默认预览数据位于 `doc/media-workbench-dev/`，被 Git 忽略。发布包不包含业务记录、账号登录状态或联系人数据。

更多功能、数据备份及会话绑定说明见 [插件文档](packages/dsh-media-workbench/README.md)。
