package ru.genesis.calendar.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class OriginalImageLoaderTest {
    @Test fun decodeRetainsEnoughPixelsForBothDimensions() {
        assertEquals(1, imageSampleSize(1672, 941, 900, 500))
        assertEquals(2, imageSampleSize(1672, 941, 400, 400))
        assertEquals(16, imageSampleSize(1600, 2400, 96, 128))
        assertEquals(1, imageSampleSize(1600, 2400, 0, 0))
    }
}
