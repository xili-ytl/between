# 之间 · Between

[![Verify source](https://github.com/xili-ytl/between/actions/workflows/ci.yml/badge.svg)](https://github.com/xili-ytl/between/actions/workflows/ci.yml)

世界之外，你我之间。

*Beyond the World, Between You and Me.*

Between 最初是一个仿微信的二人情侣空间，有聊天、朋友圈和云端存储。

后来，我们想一起养一只企鹅，于是加上了小时候玩过的 Q 宠，再接入 AI Agent，让它可以和我们聊天。公开版的企鹅叫 **小Q**。

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

## 技术

- Android：Kotlin、Jetpack Compose、Room。
- 后端：TypeScript、腾讯 CloudBase。
- AI：上下文、图片理解、按需搜索和记忆。

[架构](docs/ARCHITECTURE.md) · [数据与安全](docs/SECURITY.md) · [第三方说明](THIRD_PARTY_NOTICES.md)

## 许可

[MIT](LICENSE) · 维护者 [xili-ytl](https://github.com/xili-ytl)
