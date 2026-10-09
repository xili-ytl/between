package com.privatechat.couplechat.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.ui.WechatStatusBarSpacer
import com.privatechat.couplechat.ui.WechatUiMetrics

@Composable
internal fun PageTitle(title: String) {
    Column {
        WechatStatusBarSpacer()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.TopBarHeight)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge)
        }
    }
}
