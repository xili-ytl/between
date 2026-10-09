package com.privatechat.couplechat.core.image

import coil3.Uri
import coil3.key.Keyer

/**
 * 图片缓存稳定键。
 *
 * 云端通过 CloudBase `temporaryUrl` 下发带签名/时间戳的 URL，每次调用都不同。Coil 默认把
 * String URL 映射成 [Uri] 后按完整 URL 做缓存键，导致每次查看同一张图片都重新下载并新增
 * 一份缓存（重复缓存膨胀）。这里把缓存键收敛为“去掉 query 后的稳定路径”。
 */
fun stableImageCacheKey(url: String): String = url.substringBefore('?')

/**
 * Coil 缓存键器：作用于映射后的 [Uri]（String 模型经 StringMapper 得到）。
 * 用户组件排在默认组件之前，因此覆盖 Coil 默认的 UriKeyer。
 */
val uriImageKeyer: Keyer<Uri> = Keyer { data, _ -> stableImageCacheKey(data.toString()) }
