# 配置与部署

## 准备

安装 Node.js 24 LTS、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。

backend/.env.example 是字段说明，脚本不会自动加载它。通过 shell 或云控制台提供实际变量。Android 将 local.properties.example 复制为被忽略的 local.properties，填写 SDK 路径、自己的函数 URL 和客户端 Publishable Key。没有云配置时可以构建，不能登录。

## 本地检查

下面的检查使用合成数据，不需要云账号或模型 API key。

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

只检查 Agent 接线时，可在 backend 执行以下聚焦测试：

~~~sh
npm test -- test/deepseek-vision-reply-generator.test.ts test/wenli-agent-memory-flow.test.ts test/wenli-app-factory-flow.test.ts test/wenli-job-worker.test.ts test/wenli-service-race.test.ts
~~~

Gradle Wrapper 固定 8.9；云函数运行 Node 20.19，本地 SQLite 检查使用 Node 24。npm run eval:wenli 会调用真实模型并产生费用，不属于上述本地检查。

## 自有 CloudBase

1. 新建环境与文档数据库。复制 cloudbaserc.example.json 为被忽略的 cloudbaserc.json，填写自己的 envId。
2. 部署函数前，按下面的精确名称预创建文档集合，权限设为仅管理员可读写，客户端只经过函数访问。函数业务入口不建集合，也不吞掉建集合错误。
3. 在 backend 执行 npm run build:function，部署完整 functions/chat-api 目录，包含其 CommonJS package.json。不能只上传 index.js 后继承 backend 的 ESM 设置。
4. 函数使用 Nodejs20.19、index.main、256 MB、60 秒。设置随机长值 BACKUP_ADMIN_TOKEN；API 和推送密钥只放服务端。
5. 配置函数网关，获取 URL 和客户端 Publishable Key。管理员云密钥不能作为手机 Publishable Key；业务仍需账号/session 鉴权。
6. 只对全新、自有、隔离环境初始化：维护 shell 临时提供 CLOUDBASE_FUNCTION_URL、CLOUDBASE_PUBLISHABLE_KEY、BACKUP_ADMIN_TOKEN、INITIAL_CHAT_PASSWORD，然后 npm run seed。账号见 domain/contracts.ts。登录后分别改密码、昵称与头像。
7. 构建 Debug APK，用隔离账号检查双端流程。不要拿生产账号做自动验收。

| 集合名称 | 用途 |
|---|---|
| users、relationships | 固定双账号与关系 |
| messages、readStates | 追加聊天、接收与阅读状态 |
| moments、momentLikes、momentComments | 共享动态、点赞和评论 |
| contactRemarks、login_attempts、pushRegistrations | 备注、登录失败限流和可选推送注册 |
| pet、petSessions | 共同宠物与独立只读会话 |
| wenliAgentJobs、wenliMemories | 小Q任务与记忆事件 |

这些是 14 个独立集合，名称区分大小写。seed 只补缺失用户与关系，不创建集合。system.health 只证明函数可达，不证明数据库、集合或索引齐备。完整索引配置和从零部署仍待全新环境验收；不要把管理员权限交给手机来绕过配置问题。

smoke:moments 会写入并清理合成动态，仅可在隔离环境执行。seed、restore、smoke 不作生产健康检查。

## 小Q（可选）

服务端变量：

~~~text
WENLI_MOBILE_SHADOW_ENABLED=1
WENLI_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=<server-only>
~~~

OpenRouter 模型常量在 adapters/openrouter-wenli-client.ts，当前为 MiMo 2.6 Flash，固定上游；该路径不读取 WENLI_MODEL_NAME 切模型。更换时应另做合成评测并核对供应商支持。不需要本机代理或常驻 runner。

未设置开关/密钥时，真人聊天可用，小Q执行不可用。API 会产生独立费用。

小Q的设定源为 backend/resources/wenli/owner.md，仓库内使用合成示例。修改后在 backend 执行 npm run persona:compile，再执行 npm run persona:check。另选文件可使用 npm run persona:compile -- --source /path/to/owner.md；角色编译只读取明确指定的文件。

## 推送、升级、备份

推送可选：服务端 JPUSH_APP_KEY、JPUSH_MASTER_SECRET；Android 只配置 JPUSH_APP_KEY。不配置时跳过推送，前台同步仍工作。通知权限和厂商后台限制需要设备验收。

升级必须配置自有 APK 对象、自己的长期签名和真实 sha256，并更新 src/release-manifest.ts。历史清单不是新部署的产物，没有附带生产签名或下载对象。Debug APK 不能用于正式覆盖安装。

备份入口 npm run backup，内部格式 v4，覆盖 users、relationships、messages、moments、momentLikes、momentComments、readStates、wenliAgentJobs、wenliMemories；外层为加密 envelope。用 npm run verify:backup 独立离线验证，口令与文件分开保存。图片对象字节需另做存储备份。restore 需 ALLOW_RESTORE=YES，只补缺失项，正式操作前先审核方案。

部署后先用 system.health 检查可达，再用隔离账号检查互发、离线补收、查看即可清未读、后台回执、重连和小Q。云套餐价格及额度以控制台为准，不保证免费长期运行。
