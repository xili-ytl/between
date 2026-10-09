package com.privatechat.couplechat.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class PhosphorIconsContractTest {
    @Test
    fun appIconMappingUsesOnlyRecordedPhosphorRegularAssets() {
        val mapping = source("ui/AppIcons.kt")
        val expected = mapOf(
            "CHAT" to "phosphor_ic_chats_circle",
            "CONTACTS" to "phosphor_ic_users",
            "DISCOVER" to "phosphor_ic_compass",
            "ME" to "phosphor_ic_user",
            "MANAGE_ACCOUNT" to "phosphor_ic_user_gear",
            "SETTINGS" to "phosphor_ic_gear_six",
        )

        expected.forEach { (symbol, resource) ->
            assertTrue("Missing $symbol mapping", mapping.contains("AppIconSymbol.$symbol -> R.drawable.$resource"))
            assertTrue("Missing $resource", resource("drawable/$resource.xml").contains("android:viewportWidth=\"256\""))
        }
    }

    @Test
    fun everyDerivedAssetHasItsOfficialSourceAndAttribution() {
        val assets = listOf("chats-circle", "users", "compass", "user", "user-gear", "gear-six")
        val notice = notice()

        assets.forEach { name ->
            assertTrue("Missing source SVG for $name", thirdParty("$name.svg").isNotBlank())
            assertTrue("Missing source record for $name", notice.contains("assets/regular/$name.svg"))
        }
        assertTrue(notice.contains("@phosphor-icons/core"))
        assertTrue(notice.contains("2.1.1"))
        assertTrue(notice.contains("MIT"))
    }

    private fun source(relative: String): String =
        File("src/main/java/com/privatechat/couplechat/$relative").also {
            assertTrue("Missing source file: ${it.absolutePath}", it.isFile)
        }.readText()

    private fun resource(relative: String): String =
        File("src/main/res/$relative").also {
            assertTrue("Missing resource file: ${it.absolutePath}", it.isFile)
        }.readText()

    private fun thirdParty(name: String): String =
        File("../../third_party/phosphor-icons/$name").also {
            assertTrue("Missing source asset: ${it.absolutePath}", it.isFile)
        }.readText()

    private fun notice(): String =
        File("../../THIRD_PARTY_NOTICES.md").also {
            assertTrue("Missing notice file: ${it.absolutePath}", it.isFile)
        }.readText()
}
