package com.privatechat.couplechat.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatechat.couplechat.R

private const val ChineseSlogan = "世界之外，\n你我之间。"
private const val EnglishSlogan = "Beyond the World, Between You and Me."

/** Shared brand lockup for the real entry screens; the icon remains the app's existing asset. */
@Composable
fun BetweenBrand(
    modifier: Modifier = Modifier,
    iconSize: Dp = 80.dp,
    iconToChinese: Dp = 28.dp,
    testTag: String = "brand-identity",
) {
    Column(
        modifier = modifier.testTag(testTag),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(iconSize)
                .clip(RoundedCornerShape(percent = 22))
                .background(colorResource(R.color.launcher_background))
                .semantics { contentDescription = "之间" }
                .testTag("$testTag-icon"),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(R.drawable.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Spacer(Modifier.height(iconToChinese))
        Text(
            text = ChineseSlogan,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("$testTag-chinese"),
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 20.sp,
            lineHeight = 30.sp,
            fontWeight = FontWeight.Normal,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = EnglishSlogan,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("$testTag-english"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            lineHeight = 18.sp,
            fontStyle = FontStyle.Italic,
            textAlign = TextAlign.Center,
        )
    }
}

/** Startup brand state. The failure controls are rendered only after real session restore fails. */
@Composable
fun BetweenEntryScreen(
    restoreFailed: Boolean,
    onRetry: () -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .testTag("entering-between"),
    ) {
        val scrollState = rememberScrollState()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 28.dp)
                .offset(y = -(maxHeight * 0.06f)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BetweenBrand(
                modifier = Modifier.fillMaxWidth(),
                iconSize = 80.dp,
                iconToChinese = 28.dp,
                testTag = "entry-brand",
            )
            if (restoreFailed) {
                Spacer(Modifier.height(24.dp))
                Text(
                    text = "暂时无法完成加载",
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("entry-error"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                    lineHeight = 22.sp,
                    textAlign = TextAlign.Center,
                )
                TextButton(
                    onClick = onRetry,
                    modifier = Modifier.testTag("entry-retry"),
                    colors = betweenTextButtonColors(),
                ) {
                    Text("重试", fontSize = 14.sp)
                }
            }
        }
    }
}
