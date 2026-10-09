# 架构与验证边界

| 目录 | 职责 |
|---|---|
| android/app/src/main | Compose、ViewModel、仓库、Room、网络、图片、推送、升级 |
| android/app/src/test | JVM 合成测试 |
| android/app/src/androidTest | 需要设备的迁移/交互测试 |
| android/scripts | 使用真实 Room 查询的 SQLite 隔离验收 |
| backend/src/api | action/payload 路由 |
| backend/src/services | 业务与问理执行 |
| backend/src/ports | 存储、模型与图片接口 |
| backend/src/adapters | CloudBase、模型 HTTP 和内存测试实现 |
| backend/src/domain | 纯规则、结构校验、角色编译与上下文选择 |
| backend/resources/wenli | 角色正文快照 |

API 真源为 [api-router.ts](../backend/src/api/api-router.ts) 和 [contracts.ts](../backend/src/domain/contracts.ts)。

## 聊天与回执

云端追加消息是权威来源。客户端用 accountId + clientMessageId 重试同一次发送，服务器确认后归并乐观消息，避免重复。

接收游标表示已经同步的位置，已读游标表示聊天页真正展示过的位置。按服务器 (createdAt,id) 排序，同毫秒仍有稳定顺序。只提交已看位置，退出后的新消息不算已读。已经看过的回执可在离开页面后完成提交；隐藏失败不持续轮询。

服务层与 CloudBase 事务分别比较位置，旧并发请求不能回退游标。公共回执供另一端显示，旧 unread 字段继续兼容。设备时间不决定顺序，旧会话响应不能污染新账号。

Room 迁移应保留历史，这是设计约束，当前实现尚未完全满足：CacheVersionStore 根据应用版本号触发 ChatRepository.initialSync 清本地缓存，发生在联网同步之前。普通升级后离线首次打开可能失去本地历史可读性；这不等于删除云端消息。首发前需要独立回归与修复。

## 问理的数据流

~~~mermaid
flowchart TD
    A["Android：提交 @问理 消息"] --> B["服务端鉴权与稳定消息 ID"]
    B --> C["消息与 mention outbox"]
    C --> D["事务领取任务租约"]
    D --> E["核对原消息发送者与请求者"]
    E --> F["装配有界聊天、动态、图片与有效记忆"]
    F --> G{"是否需要公开搜索"}
    G -->|需要| H["受约束查询与来源证据"]
    G -->|不需要| I["模型生成 JSON"]
    H --> I
    I --> J["本地 reply 校验与有界格式重试"]
    J --> K["事务检查租约，持久化稳定 ID 回复"]
    K --> L["客户端增量接收"]
    K --> M["核验记忆候选并追加索引事件"]
~~~

模型调用在事务外。租约和稳定回复 ID 保证可见回复幂等，不保证上游模型只调用一次；旧 worker 完成后不能覆盖新租约的结果。没有常驻独立 worker，任务推进依赖现有客户端与请求路径。

认证账号锚定说话者。记忆需要主体、原句来源和有效时间，模型自己的说法不是主人事实来源。纠正/撤回作用于索引，不删除聊天；组装上下文时抑制过期来源。记忆写入发生在回复持久化之后，失败不回滚已存回复，等待有界但不代表底层 IO 一定被取消。

公开搜索按需执行，查询受隐私约束；网页是证据而非指令。正文只显示校验后的 reply，不输出推理、计时或工具封装。来源校验不能替代事实正确性与真实模型评测。

## 首发前的可靠性缺口

2026-10-09 源码审查发现，下列项目尚未修复，不能按完成状态介绍：

| 问题 | 当前证据 | 验收要求 |
|---|---|---|
| 普通升级清本地缓存 | [CacheVersionStore](../android/app/src/main/java/com/privatechat/couplechat/core/data/CacheVersionStore.kt) 与 [initialSync](../android/app/src/main/java/com/privatechat/couplechat/core/data/ChatRepository.kt) | 升级且离线时仍可查看原缓存，不借用生产数据 |
| 每次请求尝试建 4 个集合并吞错误 | [function-entry.ts](../backend/src/function-entry.ts) 在 main 中串行执行 ensureCollections | 初始化与业务请求分离，或只复用成功初始化；未知错误可诊断，不忽略失败 |
| 登录失败计数读改写没有并发保护 | [auth-service.ts](../backend/src/services/auth-service.ts) 与 [cloudbase-stores.ts](../backend/src/adapters/cloudbase-stores.ts) | 并发失败计数不能丢失，锁定规则在共享存储层成立 |
| 新环境部署步骤不完整 | [部署说明](SETUP.md) 未给出已验收的完整集合/索引配置 | 全新环境初始化后通过隔离双端流程，管理员权限不能传给客户端 |
| 默认升级清单引用未随仓库交付的产物 | [release-manifest.ts](../backend/src/release-manifest.ts) 与 [release-service.ts](../backend/src/services/release-service.ts) | 未启用升级应有明确状态；不能因不存在的对象破坏基础体验 |

云函数重复建集合会增加请求开销；本轮没有账单或阶段计时，不能据此推算费用与延迟节省。登录 source 的代理头信任边界也需要独立网关核实，尚未证明线上可被伪造。

依赖风险另见 [安全文档](SECURITY.md)。这是聚焦审查，不是全面安全认证。

## 验收层次

后端业务/并发测试使用合成数据；真实 CloudBase SDK 事务回调配合假传输，不连接生产。SQLite 验收抽取生产 Room 查询，在内存数据库验证身份和游标边界。Android JVM、lint、Debug 构建验证逻辑及编译。instrumentation 需要隔离模拟器/设备。付费模型评测单独预算，不在普通测试或 CI 中运行。

没有设备或云环境证据时，不把编译成功写成通知、手势或部署验收成功。合成契约测试也不能证明实际模型的人情味、无限记忆或整体准确率。
