# 之间 · Between

**可自行部署的双人空间，和一个有来源记录的共同 AI 伙伴。**

*A private space for two, with a shared AI companion.*

世界之外，你我之间。

*Beyond the World, Between You and Me.*

Android 客户端使用 Kotlin、Jetpack Compose 和 Room；TypeScript 后端运行于腾讯 CloudBase。两个固定成员可以聊天、分享动态，并在共同聊天中 @问理。问理读取有界的聊天、动态和图片上下文，记录经过来源校验的偏好，支持纠正与撤回。

目前是源码预览候选，尚未上传 GitHub 或完成生产发行验收。角色、账号和头像均为合成示例，不含原用户内容。原创代码采用 [MIT](LICENSE)；安全问题的报告方式见 [SECURITY](docs/SECURITY.md)。全新云环境和设备验收仍待完成。

## 可以做什么

- 文字、图片、引用、搜索和复制；发送重试复用同一消息 ID。
- 已读回执与未读计数；同步到的数据和实际看过的位置分别维护。
- 共享动态、图片、点赞、评论和双方资料。
- 问理的身份识别、连续追问、按需公开搜索、动态与图片召回、记忆纠正和撤回。
- Markdown、代码块与 LaTeX 渲染；长按问理头像插入 @问理。
- 可选推送、备份与应用内升级；升级需配置自己的产物和签名。

只支持固定双人关系，没有公共注册、群聊或多租户能力。数据保存在部署者自己的云环境，服务端可读取内容，没有端到端加密。启用问理后，选中的上下文会发送给模型供应商。

## 值得读的工程设计

| 遇到的问题 | 处理方式 | 源码与合成验收 |
|---|---|---|
| 两人共同聊天，模型容易混淆“我”和转述对象 | 以认证账号与原消息发送者锚定当前发问者，保留历史消息的角色和来源 | [上下文生成](backend/src/services/deepseek-vision-reply-generator.ts) · [身份与追问测试](backend/test/deepseek-vision-reply-generator.test.ts) |
| 模型说“记住了”不等于写入真实、正确的记忆 | 候选必须能匹配真人原句与主体；纠正和撤回追加索引事件，原聊天保留 | [候选校验](backend/src/domain/wenli-memory-candidate.ts) · [记忆生命周期测试](backend/test/wenli-agent-memory-flow.test.ts) |
| 超时、重复触发和过期 worker 可能制造重复回复 | 任务租约、事务与稳定回复 ID 约束可见结果；回复持久化后再处理辅助记忆，失败不回滚回复 | [执行存储](backend/src/adapters/wenli-job-execution-stores.ts) · [worker 测试](backend/test/wenli-job-worker.test.ts) · [竞态测试](backend/test/wenli-service-race.test.ts) |
| 收到消息、看见消息与回复消息是不同事件 | 接收与阅读游标分离，以服务端 (createdAt,id) 单调推进；离开页面不丢失已看位置 | [阅读状态仓库](android/app/src/main/java/com/privatechat/couplechat/core/data/ReadStateRepository.kt) · [页面测试](android/app/src/test/java/com/privatechat/couplechat/feature/chat/ChatViewModelTest.kt) |

事务保证可见回复幂等，不保证上游模型只调用一次。来源校验降低上下文与记忆误归属风险，不保证模型的每句话都正确。这些是应用层设计，没有向量数据库或大规模召回、延迟与成本基准。

## 先运行不花模型额度的检查

安装 Node.js 24 LTS。在 backend 运行下面的聚焦测试，可检查身份、记忆、工厂接线与重复执行，不需要云账号或 API key：

~~~sh
cd backend
npm ci
npm test -- test/deepseek-vision-reply-generator.test.ts test/wenli-agent-memory-flow.test.ts test/wenli-app-factory-flow.test.ts test/wenli-job-worker.test.ts test/wenli-service-race.test.ts
~~~

这里使用假模型与合成数据，验证应用契约；它不是实际模型智能或语气评测。npm run eval:wenli 会调用真实模型并产生费用，不能作为免费演示命令。当前还没有无需部署即可登录的离线界面演示。

完整本地检查：

~~~sh
# 在 backend
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

Android 需要 JDK 17、Android SDK 35 / Build Tools 35.0.0；Gradle Wrapper 固定 8.9。云函数运行 Node 20.19，本地 SQLite 验收使用 Node 24。普通测试和 CI 不部署，不登录原用户，也不调用付费模型。

## 自行部署与角色配置

- [配置与部署](docs/SETUP.md)：独立云环境、合成账号、模型与可选推送。
- [架构与验证边界](docs/ARCHITECTURE.md)：数据流、事务、阅读游标与已知可靠性问题。
- [数据与凭据](docs/SECURITY.md)：模型数据流、公开源码边界与依赖审计。
- [第三方说明](THIRD_PARTY_NOTICES.md)：依赖与素材的许可信息。

仓库的人格源为 backend/resources/wenli/owner.md。修改后在 backend 执行 npm run persona:compile 和 npm run persona:check；另选文件使用 npm run persona:compile -- --source /path/to/owner.md。编译只读一个明确的角色文档，工程说明、计划和报告不能入模。

## 验证状态与当前限制

2026-10-10 在独立源码候选中重新 npm ci，随后通过后端 842 项测试、实际 SQLite 4 项测试、类型检查、角色同步和函数构建。2026-10-09 的 Android JVM 328 项测试、Debug 构建及 instrumentation 编译通过，此后 Android 源码未再改变；lint 为 0 errors、12 warnings。设备测试没有运行，也没有实际 GitHub runner、隔离双设备或全新云环境的端到端验收；本机通过不代表这些已通过。

已修正普通升级清聊天缓存、每请求重复建集合、并发登录失败计数、旧会话分页状态污染及登录来源解析。仓库、入口及安装 SDK 的假传输回归已通过；Room 迁移、手机切换与真实云事务仍需隔离验收。首发前还需处理运行时依赖审计与可选升级默认状态，并在新环境验证集合、索引及部署流程。详见架构与安全文档。

问理默认 40 条上下文消息，相关旧聊天最多检查最近 200 条，共享动态检索最近 100 条、每次最多 4 条入模；不保证无限记忆。没有常驻独立 worker，双端退出后的任务完成时间没有保证。推送受系统权限和厂商后台策略限制。

公开候选不含私人数据、签名密钥、安装包、生产配置或旧 Git 历史。

## 许可与维护

维护者：[xili-ytl](https://github.com/xili-ytl)。原创源码、文档及合成示例采用 [MIT License](LICENSE)。第三方资源、Gradle Wrapper 及依赖保留各自的许可和版权声明，见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)；项目许可不改变第三方条款。

普通问题欢迎提供合成复现步骤与相关测试。涉及凭据或数据访问的安全问题，请按 [安全报告方式](docs/SECURITY.md) 联系，不在公开 Issue 中附上私人内容。
