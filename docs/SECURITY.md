# 数据与公开源码边界

两个固定账号共享一段关系。手机不持有数据库管理员凭据，业务走服务端鉴权。session 在同账号新登录时轮换。TLS 保护传输，服务器能读保存的内容，没有端到端加密。

启用小Q后，选中的聊天、图片、动态与记忆会送到配置的模型供应商。预算限制规模，不代表内容已匿名化。公开搜索只发受约束的查询。为他人部署前应让双方了解数据流。

密钥、管理员 token、session、密码、签名/备份私钥、真实配置、备份、私人角色档案、真实聊天图片与诊断输出不能进入 GitHub。客户端 Publishable Key 也应使用公开版自己的配置。

公开候选按路径允许清单导出，排除 Git 元数据、旧工程文档、原角色和头像，使用合成示例。关键词扫描只能辅助检查；正式公开前仍需检查内容、历史与素材许可。

仅删除文件或加 .gitignore 不会清掉旧提交的内容。公开时使用经审查快照建立独立新仓库，原私有历史保留本地。参考 [GitHub 的敏感数据清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

默认测试不登录真人、不写生产合成数据。模型评测与云端冒烟单独授权和预算；备份必须独立验证，真实明文不能做 fixture。漏洞复现用合成内容，不在公开日志泄露 token、聊天或图片 URL。原创源码使用 [MIT License](../LICENSE)，第三方内容仍遵守各自许可。

## 报告问题

维护者：[xili-ytl](https://github.com/xili-ytl)。普通缺陷可以在仓库 Issues 提交合成复现步骤、版本和预期行为。

账号冒用、跨账号数据访问、凭据泄露等安全问题请私下报告。若仓库 Security 页面提供 **Report a vulnerability**，使用该入口；该功能需要维护者在仓库设置中启用，本文不表示它已经开启。

若没有私密报告入口，请创建标题为“请求安全联系渠道”的 Issue，只说明希望私下联系。不要附上漏洞细节、利用代码、token、聊天、图片链接或备份；待维护者提供私密渠道后再提交合成复现。不要用实际用户的数据证明漏洞。

## 依赖审计：2026-10-10

对独立候选的 package-lock.json 使用 npm 官方 registry 执行 npm audit --json 和 npm audit --omit=dev --json，两项均退出 1：各有 6 个受影响的包条目，4 high、2 moderate、0 critical。前一天的全树审计为 10 个条目；本轮补丁后不再有额外的开发依赖条目，运行时告警仍保留。

这些计数包括受传递依赖影响的父包，不是独立漏洞数量。它们说明当前锁定依赖需要处理，不证明已发生攻击，也不证明所有条目都能从应用入口触发。审计结果会随公告更新，不能作为永久安全状态。

本轮更新 [Vitest 4.1.11](https://registry.npmjs.org/vitest/4.1.11) 及七个同版配套包、[nanoid 3.3.18](https://registry.npmjs.org/nanoid/3.3.18)、[source-map-js 1.2.2](https://registry.npmjs.org/source-map-js/1.2.2)，下载地址与 integrity 核对官方元数据。只改十个 dev 包及根版本要求，保留其余锁定节点；独立 npm ci 已退出 0。没有连带升级 Vite、构建器或运行时 SDK。

运行时安装链仍为 @cloudbase/node-sdk 3.18.3 及其依赖：axios 0.27.2、@cloudbase/database 1.4.3 的 lodash.set / lodash.unset，以及 signature-nodejs → npm url → qs 6.15.3。

安装源码复查：lodash.set / unset 的相关调用点位于实时 watch 差量处理，应用没有使用 watch；签名模块的 require("url") 在本机 Node 24 实测解析为内置模块，未经过 npm url / qs。Axios 条件性用于固定地址的 SDK 环境探测，应用没有使用 SDK requestClient 或扩展，也未发现把外部请求者的 URL 交给 Axios。常规数据库传输使用原生 http/https，小Q上游使用 fetch。

这不是全依赖动态覆盖或线上利用验收，不能据此宣布风险消失。仍需核对运行时供应商修复、运行环境与版本兼容；运行时依赖本轮未改，不能用开发工具补丁代替处理。

npm 给出的部分 CloudBase fixAvailable 建议为 3.0.0，属于主版本变更且低于当前安装版本，不能直接执行 npm audit fix --force。依赖处理完成前，不把此候选标为适合生产的首发版本。
