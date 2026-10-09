package com.privatechat.couplechat.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.R

@Composable
fun WeUiBackIcon(contentDescription: String, modifier: Modifier = Modifier) {
    Icon(
        painter = painterResource(R.drawable.weui_ic_back_arrow),
        contentDescription = contentDescription,
        modifier = modifier.width(12.dp).height(24.dp),
    )
}

@Composable
fun WeUiDisclosureIcon(modifier: Modifier = Modifier, contentDescription: String? = null) {
    Icon(
        painter = painterResource(R.drawable.weui_ic_disclosure_arrow),
        contentDescription = contentDescription,
        modifier = modifier.width(12.dp).height(24.dp),
    )
}
