# 之间 · Between

世界之外，你我之间。

*Beyond the World, Between You and Me.*

面向两个固定成员的 Android 私密社交项目。Kotlin / Compose / Room 客户端，腾讯 CloudBase 后端，以及共同的 AI 伙伴问理。

## 当前能力

- 文字、图片、引用、搜索和复制；缓存优先显示，重试同一条消息不重复发送。
- 已读回执、未读计数；同步到的数据和实际看过的位置分别维护。
- 共享动态、图片、点赞、评论、双方资料修改。
- 问理的身份识别、连续追问、按需搜索、动态与图片召回、记忆纠正和撤回。
- Markdown、代码块和 LaTeX 渲染；长按问理头像插入 @问理。
- 可选推送，以及校验哈希和签名的应用内升级。

这是固定双人关系，没有公共注册、群聊或多租户能力。数据在自有云环境保存，没有端到端加密。

## 本地验证

Node.js 24 LTS、JDK 17、Android SDK 35 / Build Tools 35.0.0；Gradle Wrapper 固定 8.9。云函数运行 Node 20.19，本地 SQLite 验收使用 Node 24。

~~~sh
cd backend
npm ci
npm test
npm run typecheck
npm run persona:check
npm run build:function
cd ..
node --test android/scripts/wenli-unread.test.mjs
cd android
# Windows 用 gradlew.bat
bash ./gradlew testDebugUnitTest lintDebug assembleDebug
~~~

默认测试使用合成数据、假时钟、假模型和隔离数据库，不需要真人账号、云账号或模型 key。设备手势、系统通知和厂商后台行为仍需隔离设备验收；CI 不部署或发布。

## 自行部署

- [配置与部署](docs/SETUP.md)
- [架构与验证边界](docs/ARCHITECTURE.md)
- [数据与凭据](docs/SECURITY.md)
- [第三方说明](THIRD_PARTY_NOTICES.md)

独立仓库的人格源为 backend/resources/wenli/owner.md。修改后在 backend 执行 `npm run persona:compile` 和 `npm run persona:check`；另选文件使用 `npm run persona:compile -- --source /path/to/owner.md`。编译只读一个明确的角色文档，工程说明、计划和报告不能入模。

## 当前限制

问理默认 40 条上下文消息，相关旧聊天最多检查最近 200 条，共享动态检索最近 100 条、每次最多 4 条入模；不保证无限记忆。没有常驻独立 worker，双端退出后的任务完成时间没有保证。推送受系统权限和厂商后台策略限制。

公开候选使用合成角色和示例头像，不含私人数据、签名密钥、安装包、生产配置或旧 Git 历史。项目总许可证尚待确定，第三方许可仍须保留；当前是在准备源码公开，尚未完成开源发行。
