package com.privatechat.couplechat.feature.settings

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.BuildConfig
import com.privatechat.couplechat.R
import com.privatechat.couplechat.ui.WechatTopBar

/**
 * 「关于之间」：只有一个身份区块、一句数据说明和一行低调署名的静态页。
 * 视觉上刻意做减法——不放置可点击的列表行、分隔线或卡片容器，靠对齐与间距体现层次。
 */
@Composable
fun AboutScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = { WechatTopBar("关于之间", onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        // 取可视高度算一个最小内容高度：内容不足时把署名压到底部，字号放大时仍可滚动。
        // 注意 minHeight 必须作用在"滚动内容"上而不是滚动容器上，
        // 否则 verticalScroll 的内容约束仍是无限高，weight(1f) 会算成 0、署名贴不到底。
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .navigationBarsPadding(),
        ) {
            val minimumContentHeight = maxHeight
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = minimumContentHeight)
                    .padding(horizontal = 32.dp)
                    .testTag("about-content"),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(44.dp))
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(colorResource(R.color.launcher_background)),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painter = painterResource(R.drawable.ic_launcher_foreground),
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "之间",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "版本 ${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "世界之外，你我之间",
                    modifier = Modifier.widthIn(max = 280.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
                Text(
                    text = "数据由云端永久保存",
                    modifier = Modifier
                        .widthIn(max = 260.dp)
                        .testTag("about-data-note"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.weight(1f))
                Spacer(Modifier.height(40.dp))
                Text(
                    text = "由示例甲开发",
                    modifier = Modifier.testTag("about-signature"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
            }
        }
    }
}
