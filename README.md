# DSH 内容运营工作台

用于管理官号选题、达人合作、Campaign、营销日历、内容数据及每日成果的 DSH Desktop 插件。

界面采用黑白极简风格，日历保留状态颜色。四个窗口支持交换位置、调整大小、收起和恢复；数据支持手动录入，浏览器采集属于实验能力。

## 下载与安装

在本仓库 Releases 下载 `dsh-media-workbench-0.3.0.tgz`，这是 DSH 插件包，不是 Desktop 安装程序。仓库根目录也是可安装的 DSH Bundle，可以直接作为插件源码目录使用。v0.3.0 将新建、切换会话保留在右侧原生会话窗口，业务面板继续保留。

v0.2.0 将选题、达人、Campaign 和发布数据整理为紧凑表格。选题输入名称后回车创建，点击名称打开详情；发布数据可筛选官方或达人内容。数据监控支持勾选多条发布记录，以折线图或分组柱状图比较各平台的 24h、72h 和至今数据。至今取最近一次快照，缺失数据保持为空。

仓库为私有。请先登录有权限的 GitHub 账号下载，DSH 不能直接匿名获取私有仓库或 Release 链接。可在终端执行：

```sh
gh release download v0.3.0 --repo cinderzhan/dsh-media-workbench --pattern '*.tgz'
mkdir dsh-media-workbench-install
tar -xzf dsh-media-workbench-0.3.0.tgz -C dsh-media-workbench-install --strip-components=1
```

然后在 DSH 中让 Agent **通过插件管理流程安装并启用这个解压目录**，提供它的绝对路径。也可克隆本仓库后提供仓库根目录。安装结束按宿主提示重载；侧栏应出现「内容运营」。仅复制到 plugins 目录不会自动启用。不要直接改写正在使用的 generation。

此机器也可直接使用已经准备好的源码目录：`/Users/cinder/Desktop/Coding/DSHCoding/dsh-media-workbench`。

**兼容性（2026-09-11）：** 工作台内嵌原生会话需要宿主提供会话承载接口。对于实测的 Desktop 0.8.1，本仓库提供显式的 [Profile 适配步骤](docs/conversation-host-bridge.md)，需退出 Desktop 后执行。单独安装插件包不会自动修改宿主。原版宿主缺少接口时，会明确显示依赖缺失，不再自动跳去普通对话。

已在隔离的 0.8.1 Harness 实测：A/B 会话创建及切换、独立未发送草稿、业务输入与 iframe 保留、仅一个原生输入框、窗口收起恢复、刷新恢复最近会话。普通浏览器预览不含真实 DSH 会话。适配器限定已验证构建；Desktop 升级前需恢复适配，升级后重新核验。

修复页查询 npm 返回 404 表示本插件未在 npm 发布，请从 GitHub 或本地源码更新。

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
