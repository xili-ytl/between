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

API 真源为 api/api-router.ts 和 domain/contracts.ts。

## 聊天与回执

云端追加消息是权威来源。客户端用 accountId + clientMessageId 重试同一次发送，服务器确认后归并乐观消息，避免重复。

接收游标表示已经同步的位置，已读游标表示聊天页真正展示过的位置。按服务器 (createdAt,id) 排序，同毫秒仍有稳定顺序。只提交已看位置，退出后的新消息不算已读。已经看过的回执可在离开页面后完成提交；隐藏失败不持续轮询。

服务层与 CloudBase 事务分别比较位置，旧并发请求不能回退游标。公共回执供另一端显示，旧 unread 字段继续兼容。设备时间不决定顺序，旧会话响应不能污染新账号。Room 迁移应保留历史，正常升级不先清空缓存。

## 问理

@问理 → 稳定任务/mention outbox → 租约 worker → 预算内上下文 → 可选工具 → 校验 reply → 稳定回复 ID → 记忆候选验证。

认证账号锚定说话者。记忆需要主体、来源和有效时间；模型自己的说法不是主人事实来源。纠正/撤回作用于索引，不删除聊天。记忆失败不回滚已存回复。事务保证可见回复幂等，不承诺模型只调用一次。

公开搜索查询不含私聊全文或私人背景。网页是证据而非指令。正文只显示校验后的 reply，不输出推理、计时或工具封装。

## 验收层次

后端业务/并发测试使用合成数据；真实 CloudBase SDK 事务回调配合假传输，不连接生产。SQLite 验收抽取生产 Room 查询，在内存数据库验证身份和游标边界。Android JVM、lint、Debug 构建验证逻辑及编译。instrumentation 需要隔离模拟器/设备。付费模型评测单独预算，不在普通测试或 CI 中运行。

没有设备或云环境证据时，不把编译成功写成通知、手势或部署验收成功。
