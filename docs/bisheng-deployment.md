# 毕昇平台部署

平台版复用工作台的选题、达人、Campaign、营销日历、发布记录、数据监控及北极星指标。首次部署为空数据，不包含本机 Desktop 的业务数据、会话、登录 Cookie 或配置。

## 数据与权限

- 访问权限由毕昇平台管理；应用读取平台注入的用户和租户身份，不提供独立登录。
- 同一租户内、有应用访问权限的同事共同维护一份运营数据。不同租户隔离。
- 数据写入平台 SQLite 持久化卷，版本更新保留数据。数据库事务和 revision 校验处理并发编辑。
- 图表和窗口布局继续保存在使用者浏览器本地；业务记录和采集快照由团队共享。

## 与 Desktop 版的区别

- DSH 原生会话由 Desktop 提供，平台版隐藏相关入口，不会伪装成已接入毕昇 AI 会话。
- 保留 B 站、小红书公开页面的直接采集，以及当前指标和到期快照调度；网页登录要求、反爬限制或缺失数据可能导致采集失败，仍可手动录入。
- 平台版不会启动本机 Chrome。抖音、视频号、公众号等现有未验证的自动采集仍使用手动录入。
- 24/72 小时快照依赖应用在线并在相应时间采集。已有历史作品无法凭当前数字补出过去的快照。

## 构建和发布

从仓库根目录运行：

```sh
node scripts/prepare-bisheng.mjs
cd deploy/bisheng
npm ci
bisheng dev . --port 4388 --no-proxy
# 本地验证完成后
bisheng deploy . --dry-run --no-proxy
bisheng deploy . --yes --wait --no-proxy
```

平台使用 Node 20；本地也应使用 Node 20 安装与运行，以保持 SQLite 原生依赖的 ABI 一致。打包脚本只复制明确列出的运行模块和前端资源。`.bisheng/`、`node_modules/`、本地数据库不上传。

SQLite 驱动使用 `libsql`，按平台架构从 npm 安装预编译组件，不在构建阶段从 GitHub 下载组件或调用本地编译器。

验证命令（仓库根目录，已完成准备与依赖安装）：

```sh
node --test test/bisheng-hosting.node.mjs
```

发布可能需要平台管理员审批。只有审批通过且应用上线后，入口才可使用；提交成功不代表上线完成。部署标识由 CLI 保存在 `deploy/bisheng/.bisheng/app.json`，后续从同一目录发布会更新此应用。
