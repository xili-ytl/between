package com.privatechat.couplechat

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.privatechat.couplechat.ui.BetweenTheme

class MainActivity : ComponentActivity() {
    private var openChatRequested by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openChatRequested = intent?.getBooleanExtra(EXTRA_OPEN_CHAT, false) == true
        val container = (application as CoupleChatApplication).container
        setContent {
            BetweenTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavHost(
                        container = container,
                        openChatRequested = openChatRequested,
                        onOpenChatRequestConsumed = { openChatRequested = false },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_OPEN_CHAT, false)) openChatRequested = true
    }

    companion object {
        const val EXTRA_OPEN_CHAT = "com.privatechat.couplechat.extra.OPEN_CHAT"
    }
}
