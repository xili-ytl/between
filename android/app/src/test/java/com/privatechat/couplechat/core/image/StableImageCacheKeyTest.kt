package com.privatechat.couplechat.core.image

import org.junit.Assert.assertEquals
import org.junit.Test

class StableImageCacheKeyTest {
    @Test
    fun signedUrlMapsToStablePath() {
        assertEquals(
            "https://host.example/images/abc.jpg",
            stableImageCacheKey("https://host.example/images/abc.jpg?sign=e19bb95d&t=1786297365"),
        )
    }

    @Test
    fun urlWithoutQueryIsUnchanged() {
        assertEquals(
            "https://host.example/images/abc.jpg",
            stableImageCacheKey("https://host.example/images/abc.jpg"),
        )
    }

    @Test
    fun urlWithMultipleParamsMapsToStablePath() {
        assertEquals(
            "https://host.example/images/abc.jpg",
            stableImageCacheKey("https://host.example/images/abc.jpg?sign=a&t=1&x=2"),
        )
    }
}
