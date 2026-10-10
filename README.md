# 之间 · Between

[![Verify source](https://github.com/xili-ytl/between/actions/workflows/ci.yml/badge.svg)](https://github.com/xili-ytl/between/actions/workflows/ci.yml)

**把童年的 Q 宠带回来，和喜欢的人一起养一只 AI 宠物。**

*A private home for two, and the AI pet you raise together.*

世界之外，你我之间。

*Beyond the World, Between You and Me.*

## 为什么做 Between

QQ 宠物在 2018 年 9 月 15 日停止运营，具体时间见[当年的停运公告报道](https://www.xinhuanet.com/politics/2018-07/11/c_1123107784.htm)。我想把小时候的 Q 宠带回来，再给它一个新的家：一个只属于情侣两个人的空间。

于是有了 Between。两个人可以聊天、分享动态，也有一只共同照顾的小企鹅。接入 Agent 后，它可以参与对话，结合聊天、动态和图片理解上下文，在有来源依据时记录偏好，并接受纠正或撤回。它的公开示例名字叫 **小Q**，设定可以自行修改。

原项目还改造了社区的 [qqpet_automation](https://github.com/xuemian168/qqpet_automation) 桌面 Q 宠，将它连接到 Between 自己的后端。手机里留下两个人的聊天与生活，桌面上保留喂食、洗澡和玩耍的养成体验。这是一个从“复活 Q 宠”出发、逐步加入 AI 与情侣互动的个人项目。

Android 客户端使用 Kotlin、Jetpack Compose 和 Room；TypeScript 后端运行于腾讯 CloudBase，可以部署到自己的云环境。

当前提供源码预览，尚未完成生产发行验收。角色、账号和头像均为合成示例，不含原用户内容。原创代码采用 [MIT](LICENSE)；安全问题的报告方式见 [SECURITY](docs/SECURITY.md)。全新云环境和设备验收仍待完成。

## 可以做什么

- 文字、图片、引用、搜索和复制；发送重试复用同一消息 ID。
- 已读回执与未读计数；同步到的数据和实际看过的位置分别维护。
- 共享动态、图片、点赞、评论和双方资料。
- 小Q的身份识别、连续追问、按需公开搜索、动态与图片召回、记忆纠正和撤回。
- Markdown、代码块与 LaTeX 渲染；长按小Q头像插入 @小Q。
- 可选推送、备份与应用内升级；升级需配置自己的产物和签名。

只支持固定双人关系，没有公共注册、群聊或多租户能力。数据保存在部署者自己的云环境，服务端可读取内容，没有端到端加密。启用小Q后，选中的上下文会发送给模型供应商。

## 桌面 Q 宠怎样联动

| 部分 | 与共同宠物的关系 | 本仓库的公开范围 |
|---|---|---|
| Android App | 在两人的共同聊天中 @小Q，分享动态、图片和记忆 | 客户端源码与合成示例 |
| 自有后端 | 维护共同养成状态，提供桌宠独立会话、聊天/动态上下文与 AI 接口 | 服务端源码与回归测试 |
| 独立桌面 Q 宠 | 连接同一后端，读取状态并进行喂食、洗澡、玩耍等操作 | 桌面客户端与素材暂未随本仓库分发 |

桌宠通过 `pet.login` 使用独立会话，不轮换手机的主登录；`pet.get`、`pet.act` 处理共享养成状态，`pet.ai.*` 提供桌宠 AI 接口。可以从[后端路由](backend/src/api/api-router.ts)、[鉴权实现](backend/src/services/auth-service.ts)与[接口测试](backend/test/api-router.test.ts)核对。桌宠的 AI 行为尚未与 App 的 Agent 记忆能力完全对齐，公开版也没有桌宠安装包或联动设备验收。

这是基于社区怀旧项目的独立改造，不连接原 QQ 宠物游戏服务器，也不代表腾讯官方恢复运营。桌宠来源、素材与许可独立于本仓库的 MIT 许可；本仓库使用中性头像，不分发原 QQ 宠物素材。

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

2026-10-10 的 [GitHub Actions 验收](https://github.com/xili-ytl/between/actions/runs/38058825452) 在提交 `3e85999` 上双端通过：后端独立 npm ci、842 项测试、实际 SQLite 4 项测试、类型检查、角色同步和函数构建；Android 单测、lint 与 Debug 构建。CI 显式安装 Android SDK，优先使用官方 Maven 仓库。

本地 Android 验证为 2026-10-09 的 JVM 328 项测试、Debug 构建和 instrumentation 编译，lint 为 0 errors、12 warnings；该计数不是从 GitHub 测试报告读取的。设备测试、隔离双设备及全新云环境的端到端验收尚未运行，CI 通过不代表这些已通过。

已修正普通升级清聊天缓存、每请求重复建集合、并发登录失败计数、旧会话分页状态污染及登录来源解析。仓库、入口及安装 SDK 的假传输回归已通过；Room 迁移、手机切换与真实云事务仍需隔离验收。首发前还需处理运行时依赖审计与可选升级默认状态，并在新环境验证集合、索引及部署流程。详见架构与安全文档。

小Q默认 40 条上下文消息，相关旧聊天最多检查最近 200 条，共享动态检索最近 100 条、每次最多 4 条入模；不保证无限记忆。没有常驻独立 worker，双端退出后的任务完成时间没有保证。推送受系统权限和厂商后台策略限制。

公开候选不含私人数据、签名密钥、安装包、生产配置或旧 Git 历史。

## 许可与维护

维护者：[xili-ytl](https://github.com/xili-ytl)。原创源码、文档及合成示例采用 [MIT License](LICENSE)。第三方资源、Gradle Wrapper 及依赖保留各自的许可和版权声明，见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)；项目许可不改变第三方条款。

普通问题欢迎提供合成复现步骤与相关测试。涉及凭据或数据访问的安全问题，请按 [安全报告方式](docs/SECURITY.md) 联系，不在公开 Issue 中附上私人内容。
