# 工作台内原生会话接入

v0.3.0 保持工作台业务面板挂载，新建与切换会话只更新右侧原生会话。缺少宿主接口时，新建会话按钮不可用并显示能力待适配；仅用户明确点击退出按钮时进入普通对话。

## 宿主适配的边界

`conversationHostVersion: 1`、`claimConversationHost(id)`、`renderConversation()` 是本次提供的过渡性宿主接口，不是上游已经发布的工作台 SDK。正式市场接入仍应由 Desktop 统一维护这些接口。

目前适配器只接受实测的 Desktop 0.8.1 / layout 0.1.2-rc.1 构建，并验证原始文件 SHA-256。它为工作台发放排他会话承载权，普通中央会话停止渲染；释放后恢复。多个工作台不能同时占用同一原生输入框。

## 本机 Profile 适配

先退出 Desktop，在仓库根目录执行（路径以实际 Profile 为准）：

```sh
node scripts/conversation-host-bridge.mjs --profile "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web" --check
node scripts/conversation-host-bridge.mjs --profile "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web" --apply
```

适配器把已验证的宿主布局模块复制到指定 Profile 的模块目录，然后只修改会话承载逻辑；不修改 /Applications 中的签名应用，不改业务数据或插件启用清单。这是显式的宿主开发适配步骤，不是插件偷偷执行的安装钩子。已有其他布局链接时拒绝覆盖。

回退会校验文件未被其他人修改，再恢复原始布局代码，并将 Profile 覆盖模块移出解析位置留作备份，恢复使用应用自带布局：

```sh
node scripts/conversation-host-bridge.mjs --profile "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web" --restore
```

Desktop 升级、Profile 依赖重建后需要重新核验。遇到未知构建，适配器拒绝修改；不可据此声明任意 Desktop 版本兼容。升级前应先恢复本适配，避免旧布局覆盖新宿主。已具备正式接口的版本不需要此适配器。

## 验收

- 新建 A/B 两条会话不退出工作台；各自未发送草稿分别保留。
- 切换后业务输入和 iframe 节点保留，页面只有一个可见原生输入框。
- 收起和恢复会话窗口保留草稿；刷新恢复工作台及最近会话。
- 承载权不可抢占，过期释放函数不能释放后来工作台的承载权。
- 未提供接口时明确显示依赖缺失，不自动降级成普通聊天并宣称验收通过。
