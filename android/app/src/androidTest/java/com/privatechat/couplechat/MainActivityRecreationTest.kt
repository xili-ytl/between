package com.privatechat.couplechat

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityRecreationTest {
    @Test
    fun activityRecreationKeepsTheApplicationScopedContainer() {
        var firstApplication: CoupleChatApplication? = null
        var firstContainer: AppContainer? = null

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                firstApplication = activity.application as CoupleChatApplication
                firstContainer = requireNotNull(firstApplication).container
            }
            scenario.recreate()
            scenario.onActivity { activity ->
                val recreatedApplication = activity.application as CoupleChatApplication
                assertSame(firstApplication, recreatedApplication)
                assertSame(firstContainer, recreatedApplication.container)
            }
        }
    }
}
