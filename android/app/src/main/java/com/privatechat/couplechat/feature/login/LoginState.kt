package com.privatechat.couplechat.feature.login

data class LoginState(
    val accountId: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
    val completed: Boolean = false,
)
