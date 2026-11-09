package ru.genesis.calendar.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.DailyAdvice
import ru.genesis.calendar.auth.DailyAdviceSource

class AdviceShareTest {
    private fun advice(body: String = "Полный текст совета.", collection: String = "aurora") = DailyAdvice(
        "advice-" + "a".repeat(24), "2026-11-06", "Смысл дня", body, "ru", listOf("aretology"),
        null, false, listOf(DailyAdviceSource("quote", "Автор", "Название труда", "Глава 2")), collection = collection)

    @Test fun alphabeticWordsStayWholeAndTheirFullTextIsRetained() {
        for ((language, text) in listOf(
            "ru" to "НепрерывноеСлово".repeat(12),
            "de" to "Donaudampfschifffahrtsgesellschaftskapitän".repeat(5),
            "el" to "ΑδιαίρετηΛέξη".repeat(12),
            "uk" to "ДовгеНеподільнеСлово".repeat(12),
        )) {
            val fullText = "Начало\n$text\nПоследняя строка сохранена."
            val layout = adviceShareTextLayout(fullText, 36f, language = language)
            assertEquals(fullText, layout.text.toString())
            assertTrue("An oversized word must fit the image", layout.paint.textSize < 36f)
            for (line in 0 until layout.lineCount) {
                assertFalse("A word was split in $language", isInsideWord(fullText, layout.getLineEnd(line)))
                assertTrue(layout.getLineWidth(line) <= layout.width + 1f)
            }
            assertEquals(fullText.length, layout.getLineEnd(layout.lineCount - 1))
        }
    }

    @Test fun normalChineseAndJapaneseLineBreaksKeepTheReadableFontSize() {
        for ((language, text) in listOf("zh" to "保持完整的句子与来源。", "ja" to "言葉と出典を省略せずに伝える。")) {
            val fullText = text.repeat(20)
            val layout = adviceShareTextLayout(fullText, 36f, language = language)
            assertEquals(fullText, layout.text.toString())
            assertEquals(36f, layout.paint.textSize, .01f)
            assertTrue(layout.lineCount > 1)
            assertEquals(fullText.length, layout.getLineEnd(layout.lineCount - 1))
        }
    }

    @Test fun artworkContinuesBehindTheEntireImageForBothCollections() {
        val red = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        val blue = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
        try {
            for (collection in listOf("aurora", "philosophers")) {
                val first = adviceShareBitmap(advice(collection = collection), red)
                val second = adviceShareBitmap(advice(collection = collection), blue)
                try {
                    assertEquals(1080, first.width)
                    for (y in listOf(24, first.height / 2, first.height - 24)) {
                        // Outside the text column: the original art must still be present at every height.
                        assertTrue(Color.red(first.getPixel(4, y)) > Color.red(second.getPixel(4, y)))
                        assertTrue(Color.blue(second.getPixel(4, y)) > Color.blue(first.getPixel(4, y)))
                    }
                } finally { first.recycle(); second.recycle() }
            }
        } finally { red.recycle(); blue.recycle() }
    }

    @Test fun longerAdviceGrowsInsteadOfTruncatingOrOverlappingTheSiteSignature() {
        val short = adviceShareBitmap(advice(), null)
        val long = adviceShareBitmap(advice("Полный текст с сохранённым последним предложением. ".repeat(100)), null)
        try {
            assertTrue(long.height > short.height)
            assertTrue(long.height <= 20_000)
            val body = adviceShareTextLayout("Полный текст с сохранённым последним предложением. ".repeat(100), 36f)
            assertTrue(long.height >= body.height + 64 + 160)
        } finally { short.recycle(); long.recycle() }
    }

    @Test fun shareSendsOneImageAndOnlyTheShortSiteCaption() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val card = advice()
        val intent = adviceShareIntent(context, card, null)
        assertEquals(Intent.ACTION_SEND, intent.action)
        assertEquals("image/png", intent.type)
        assertEquals("GENESIS\nhttps://genesiscalendar.com", intent.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals(card.title, intent.getStringExtra(Intent.EXTRA_SUBJECT))
        assertEquals(1, intent.clipData?.itemCount)
        assertTrue(intent.hasExtra(Intent.EXTRA_STREAM))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    }
}
