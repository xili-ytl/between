package com.privatechat.couplechat.core.push

interface PushProvider {
    fun initialize()
    fun currentRegistrationId(): String?
    fun setAlias(accountId: String, sequence: Int)
    fun deleteAlias(accountId: String, sequence: Int)
    fun resumePush()
    fun stopPush()
}
