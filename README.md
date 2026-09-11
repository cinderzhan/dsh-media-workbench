# DSH 内容运营工作台

用于管理官号选题、达人合作、Campaign、营销日历、内容数据及每日成果的 DSH Desktop 插件。

界面采用黑白极简风格，日历保留状态颜色。四个窗口支持交换位置、调整大小、收起和恢复；数据支持手动录入，浏览器采集属于实验能力。

## 下载与安装

在本仓库 Releases 下载 `dsh-media-workbench-0.2.2.tgz`，这是 DSH 插件包，不是 Desktop 安装程序。仓库根目录也是可安装的 DSH Bundle，可以直接作为插件源码目录使用。v0.2.2 修复了源码 link: 安装时的宿主依赖解析问题，已实际恢复本机 Desktop 0.8.1 启动并打开工作台。

v0.2.0 将选题、达人、Campaign 和发布数据整理为紧凑表格。选题输入名称后回车创建，点击名称打开详情；发布数据可筛选官方或达人内容。数据监控支持勾选多条发布记录，以折线图或分组柱状图比较各平台的 24h、72h 和至今数据。至今取最近一次快照，缺失数据保持为空。

仓库为私有。请先登录有权限的 GitHub 账号下载，DSH 不能直接匿名获取私有仓库或 Release 链接。可在终端执行：

```sh
gh release download v0.2.2 --repo cinderzhan/dsh-media-workbench --pattern '*.tgz'
mkdir dsh-media-workbench-install
tar -xzf dsh-media-workbench-0.2.2.tgz -C dsh-media-workbench-install --strip-components=1
```

然后在 DSH 中让 Agent **通过插件管理流程安装并启用这个解压目录**，提供它的绝对路径。也可克隆本仓库后提供仓库根目录。安装结束按宿主提示重载；侧栏应出现「内容运营」。仅复制到 plugins 目录不会自动启用。不要直接改写正在使用的 generation。

此机器也可直接使用已经准备好的源码目录：`/Users/cinder/Desktop/Coding/DSHCoding/dsh-media-workbench`。

**兼容性（2026-09-11）：** v0.2.2 已实际重启并打开本机 Desktop 0.8.1，验证源码 link: 插件入口、工作台和选题输入框；已用相同链接方式启动隔离 Harness。此前还通过了 0.8.1 generation 安装器验证及 0.8.0 原版 Harness 的业务与会话导航验证。修复页查询 npm 返回404表示本插件未在 npm 发布，请从 GitHub 或本地源码更新。

原版 0.8.0 / 0.8.1 中，会话通过 DSH 原生页面继续，「返回工作台」按钮切回业务面板，无需修改 Desktop。支持会话承载接口的定制宿主仍可嵌入右侧对话。普通浏览器预览不含真实 DSH 会话。

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
