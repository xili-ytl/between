package com.privatechat.couplechat.feature.settings

import com.privatechat.couplechat.core.model.Profile

data class SettingsState(
    val profile: Profile? = null,
    val displayName: String = "",
    val displayNameDirty: Boolean = false,
    val currentPassword: String = "",
    val newPassword: String = "",
    val busy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)
