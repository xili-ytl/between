# 数据与公开源码边界

两个固定账号共享一段关系。手机不持有数据库管理员凭据，业务走服务端鉴权。session 在同账号新登录时轮换。TLS 保护传输，服务器能读保存的内容，没有端到端加密。

启用问理后，选中的聊天、图片、动态与记忆会送到配置的模型供应商。预算限制规模，不代表内容已匿名化。公开搜索只发受约束的查询。为他人部署前应让双方了解数据流。

密钥、管理员 token、session、密码、签名/备份私钥、真实配置、备份、私人角色档案、真实聊天图片与诊断输出不能进入 GitHub。客户端 Publishable Key 也应使用公开版自己的配置。

公开候选按路径允许清单导出，排除 Git 元数据、旧工程文档、原角色和头像，使用合成示例。关键词扫描只能辅助检查；正式公开前仍需检查内容、历史与素材许可。

仅删除文件或加 .gitignore 不会清掉旧提交的内容。公开时使用经审查快照建立独立新仓库，原私有历史保留本地。参考 [GitHub 的敏感数据清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

默认测试不登录真人、不写生产合成数据。模型评测与云端冒烟单独授权和预算；备份必须独立验证，真实明文不能做 fixture。漏洞复现用合成内容，不在公开日志泄露 token、聊天或图片 URL。安全联系入口和项目许可证会在正式公开前补齐。

## 依赖审计：2026-10-09

对独立候选的 package-lock.json 使用 npm 官方 registry 执行 npm audit --json，退出 1：10 个受影响的包条目，6 high、4 moderate、0 critical。随后单独执行 npm audit --omit=dev --json，退出 1：6 个运行时条目，4 high、2 moderate、0 critical。

这些计数包括受传递依赖影响的父包，不是独立漏洞数量。它们说明当前锁定依赖需要处理，不证明已发生攻击，也不证明所有条目都能从应用入口触发。审计结果会随公告更新，不能作为永久安全状态。

运行时安装链为 @cloudbase/node-sdk 3.18.3 及其依赖：axios 0.27.2、@cloudbase/database 1.4.3 的 lodash.set / lodash.unset，以及 signature-nodejs → npm url → qs 6.15.3。开发工具条目还涉及 Vitest 与构建工具树。

安装源码复查：lodash.set / unset 的相关调用点位于实时 watch 差量处理，应用没有使用 watch；签名模块的 require("url") 在本机 Node 24 实测解析为内置模块，未经过 npm url / qs。Axios 条件性用于固定地址的 SDK 环境探测，应用没有使用 SDK requestClient 或扩展，也未发现把外部请求者的 URL 交给 Axios。常规数据库传输使用原生 http/https，问理上游使用 fetch。

这不是全依赖动态覆盖或线上利用验收，不能据此宣布风险消失。仍需核对供应商修复、运行环境与版本兼容，再重新独立安装及回归；本轮没有改依赖。

npm 给出的部分 CloudBase fixAvailable 建议为 3.0.0，属于主版本变更且低于当前安装版本，不能直接执行 npm audit fix --force。依赖处理完成前，不把此候选标为适合生产的首发版本。
