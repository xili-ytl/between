# 之间 · Between

[![Verify source](https://github.com/xili-ytl/between/actions/workflows/ci.yml/badge.svg)](https://github.com/xili-ytl/between/actions/workflows/ci.yml)

世界之外，你我之间。

*Beyond the World, Between You and Me.*

还记得你小时候养过的 QQ宠物吗？本项目将它与 AI Agent 结合，让Q宠企鹅具备和人对话与记忆的能力。桌面端保留原生的 Q宠系统和养成玩法，并接入AI Agent。和伴侣一起养 Q宠企鹅，在二人情侣空间里聊天互动、分享朋友圈，数据保存在云端。

## 功能

- 双人文字、图片聊天，已读回执、引用和搜索。
- 共享朋友圈，发布动态、点赞和评论。
- 在聊天里 @小Q，可以聊日常、问问题，也能结合聊天、动态和图片记住一些事情。
- Markdown、代码块和 LaTeX 渲染。
- 联动桌面 Q 宠，共同喂食、洗澡和玩耍。

桌面 Q 宠基于社区的 [qqpet_automation](https://github.com/xuemian168/qqpet_automation) 改造，连接 Between 的后端。本仓库包含 Android 和后端源码，桌面端暂未包含在内。

## 后续想法

- 做桌面版 Between，与 Android 互通。
- 让桌面 Q 宠和聊天里的 Agent 共用设定与记忆，两个人在桌面一起养同一只企鹅。

## 使用

部署步骤和可选 AI 配置见 [配置与部署](docs/SETUP.md)，小Q的设定可以自行修改。

## 技术栈

| 模块 | 技术 | 用途 |
|---|---|---|
| Android | Kotlin、Jetpack Compose、Material 3、ViewModel | 界面、导航与页面状态 |
| 网络与数据 | Ktor / OkHttp、Coroutines / Flow、Room / SQLite、Coil 3 | 云端同步、消息缓存与图片加载 |
| 消息渲染 | Markwon、JLatexMath | Markdown、代码块与 LaTeX 公式 |
| 后端 | TypeScript、Node.js、腾讯 CloudBase | 云函数、文档数据库与云存储 |
| 聊天 Agent | OpenRouter、MiMo 2.6 Flash | 多模态上下文、按需搜索与记忆 |
| 测试与构建 | Vitest、JUnit 4、Gradle、esbuild、GitHub Actions | 自动回归、类型检查与双端构建 |

Agent 使用持久化任务、租约与事务处理回复；记忆支持来源校验、纠正和撤回。数据流与实现见 [架构文档](docs/ARCHITECTURE.md)。

[架构](docs/ARCHITECTURE.md) · [数据与安全](docs/SECURITY.md) · [第三方说明](THIRD_PARTY_NOTICES.md)

## 许可

[MIT](LICENSE) · 维护者 [xili-ytl](https://github.com/xili-ytl)
