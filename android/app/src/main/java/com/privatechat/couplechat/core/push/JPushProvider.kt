package com.privatechat.couplechat.core.push

import android.content.Context
import cn.jpush.android.api.JPushInterface
import com.privatechat.couplechat.BuildConfig

class JPushProvider(context: Context) : PushProvider {
    private val context = context.applicationContext

    override fun initialize() {
        if (BuildConfig.JPUSH_APP_KEY.isBlank()) return
        JPushInterface.setDebugMode(BuildConfig.DEBUG)
        JPushInterface.init(context)
    }

    override fun currentRegistrationId(): String? =
        JPushInterface.getRegistrationID(context)?.trim()?.takeIf(String::isNotEmpty)

    override fun setAlias(accountId: String, sequence: Int) {
        JPushInterface.setAlias(context, sequence, accountId)
    }

    override fun deleteAlias(accountId: String, sequence: Int) {
        // JPush 6.2.0 的 deleteAlias(Context, sequence) 删除设备当前绑定的 alias；
        // 单设备登录下一台设备只对应一个账号，accountId 用于协调器记账，不参与 SDK 调用。
        JPushInterface.deleteAlias(context, sequence)
    }

    override fun resumePush() {
        JPushInterface.resumePush(context)
    }

    override fun stopPush() {
        JPushInterface.stopPush(context)
    }
}
