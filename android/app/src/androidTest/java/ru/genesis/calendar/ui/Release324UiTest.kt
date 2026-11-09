package ru.genesis.calendar.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.DailyAdvice
import ru.genesis.calendar.auth.DailyAdviceSource
import ru.genesis.calendar.auth.DiaryGateway
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import ru.genesis.calendar.security.WorkspaceCipher
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Base64

/** Synthetic encrypted transport only; no production account, preference store or network. */
private class Release324DiaryGateway : DiaryGateway {
    private val key = ByteArray(32) { (it + 61).toByte() }
    val rows = mutableMapOf<String, JSONObject>()
    var conflictOnce: String? = null
    override fun check() = Unit
    override suspend fun workspace() = JSONObject().put("workspace", JSONObject().put("keyMode", "account")
        .put("key", Base64.getEncoder().encodeToString(key)))
    override suspend fun request(path: String, body: JSONObject?): JSONObject {
        if (body == null) return JSONObject().put("notes", JSONArray(rows.values.toList()))
        val id = path.substringAfterLast('/')
        if (id == conflictOnce) { conflictOnce = null; throw DiaryConflict() }
        check((rows[id]?.optLong("revision") ?: 0L) == body.getLong("expectedRevision"))
        val revision = body.getLong("expectedRevision") + 1
        val now = Instant.now().toString()
        rows[id] = JSONObject(body.toString()).put("id", id).put("revision", revision).put("updatedAt", now)
        return JSONObject().put("revision", revision).put("updatedAt", now)
    }
}
private class Release324DiaryStore : DiaryStore {
    var raw: String? = null
    override suspend fun read() = raw
    override suspend fun write(ciphertext: String) { raw = ciphertext }
}
private class Release324DiaryCipher : DiaryCacheCipher {
    private val key = ByteArray(32) { (it + 91).toByte() }
    private val aad = "release324-synthetic-cache".toByteArray()
    override fun encrypt(plaintext: String) = WorkspaceCipher.encrypt(plaintext.toByteArray(), key, aad).let {
        JSONObject().put("iv", it.iv).put("ciphertext", it.ciphertext).toString()
    }
    override fun decrypt(ciphertext: String) = JSONObject(ciphertext).let {
        WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(it.getString("ciphertext"), it.getString("iv")), key, aad).toString(Charsets.UTF_8)
    }
}

/** Actual production composables on the physical device, in an explicitly separate debug package. */
class Release324UiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val args get() = InstrumentationRegistry.getArguments()

    @Before fun requireTheApprovedIsolatedPackage() {
        check(BuildConfig.DEBUG && context.packageName.endsWith(".qa324.debug"))
    }
    @Composable private fun Frame(palette: String = "green", language: String = "ru", content: @Composable () -> Unit) {
        val density = LocalDensity.current
        val font = args.getString("genesisFontScale")?.toFloatOrNull()?.coerceIn(1f, 1.5f) ?: density.fontScale
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides (palette != "light"),
            LocalDarkPalette provides palette, LocalSacredFeaturesEnabled provides true,
            LocalDensity provides Density(density.density, font)) {
            MaterialTheme(colorScheme = if (palette == "light") standart else eveningPalette(palette),
                typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Box(Modifier.safeDrawingPadding()) { content() }
                }
            }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val scale = args.getString("genesisFontScale", "system")
        captureNativeWindow(File(context.getExternalFilesDir(null), "release324-$name-$scale.png"))
    }
    private fun savedAdvice(id: String, title: String, collection: String = "aurora") = DiaryNote.reaction(
        JSONObject().put("id", "source-$id").put("title", title).put("body", "QA saved thought $id")
            .put("language", "en").put("collection", collection).put("categories", JSONArray())
            .put("sources", JSONArray().put(JSONObject().put("kind", "quote").put("work", "Synthetic book"))), id, "favorite")

    @Test fun diarySeparatesPersonalSavedDreamsAndDraftsAndCreatesVisiblePersonalNotes() {
        val gateway = Release324DiaryGateway(); val store = Release324DiaryStore()
        val repository = DiaryRepository("qa324-diary", gateway, store, Release324DiaryCipher())
        val personal = DiaryNote.create("QA own text", "QA personal")
        val saved = savedAdvice("qa324-aurora", "QA Aurora")
        val philosopher = savedAdvice("qa324-philosopher", "QA philosopher", "philosophers")
        val dream = DiaryNote.create("QA dream text", "QA dream").changed {
            put("dream", JSONObject().put("day", LocalDate.now().toString()).put("timeZone", "UTC"))
        }
        runBlocking {
            for (note in listOf(personal, saved, philosopher, dream)) repository.save(note)
            repository.keepDraft(saved.changed { put("title", "QA saved draft") }, 1)
        }
        compose.setContent { Frame { DiaryScreen(repository) {} } }
        compose.onNodeWithTag("diary-category-personal").assertIsSelected()
        compose.onNodeWithTag("diary-note-${personal.id}").assertExists()
        compose.onAllNodesWithTag("diary-note-${saved.id}").assertCountEquals(0)
        compose.onAllNodesWithText("QA dream").assertCountEquals(0)
        capture("diary-personal")
        compose.onNodeWithTag("diary-category-saved").performClick()
        compose.onNodeWithTag("diary-note-${saved.id}").assertExists()
        compose.onNodeWithTag("diary-note-${philosopher.id}").assertExists()
        compose.onAllNodesWithTag("diary-note-${personal.id}").assertCountEquals(0)
        compose.onNodeWithTag("diary-pin-${saved.id}").performScrollTo().performClick()
        compose.waitUntil(10_000) { repository.state.value.records.any { !it.draft && it.note.id == saved.id && it.note.pinned } }
        compose.onNodeWithTag("diary-pin-${saved.id}").assertIsOn()
        capture("diary-saved")
        compose.onNodeWithTag("diary-search-open").performClick()
        compose.onNodeWithTag("diary-search").performTextInput("philosopher")
        compose.onAllNodesWithTag("diary-note-${saved.id}").assertCountEquals(0)
        compose.onNodeWithTag("diary-create").performClick()
        compose.onNodeWithTag("diary-title").performTextReplacement("QA newly authored")
        compose.onNodeWithTag("diary-body").performTextReplacement(saved.body)
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(10_000) { repository.state.value.records.any { !it.draft && it.note.title == "QA newly authored" } }
        val created = repository.state.value.records.first { !it.draft && it.note.title == "QA newly authored" }.note
        assertNull(created.adviceId)
        compose.onNodeWithTag("diary-category-personal").assertIsSelected()
        assertEquals("", compose.onNodeWithTag("diary-search").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        compose.onNodeWithTag("diary-note-${created.id}").assertExists()
        assertFalse(store.raw.orEmpty().contains("QA newly authored"))
        assertTrue(gateway.rows.values.all { !it.has("body") && it.has("ciphertext") })
        capture("diary-new-visible")
    }

    @Test fun savedDiaryConflictCopyOpensPersonalAndPreservesOriginal() {
        val gateway = Release324DiaryGateway()
        val repository = DiaryRepository("qa324-copy", gateway, Release324DiaryStore(), Release324DiaryCipher())
        val original = savedAdvice("qa324-conflict", "QA conflict original", "philosophers")
        runBlocking { repository.save(original) }
        compose.setContent { Frame("violet", "en") { DiaryScreen(repository) {} } }
        compose.onNodeWithTag("diary-category-saved").performClick()
        compose.onNodeWithTag("diary-search-open").performClick()
        compose.onNodeWithTag("diary-search").performTextInput("original")
        compose.onNodeWithTag("diary-open-${original.id}").performClick()
        compose.onNodeWithTag("diary-title").performTextReplacement("QA conflict copy")
        compose.onNodeWithTag("diary-body").performTextReplacement("QA edited thought")
        gateway.conflictOnce = original.id
        compose.onNodeWithTag("diary-save").performClick()
        compose.onNodeWithTag("diary-editor-error").assertExists()
        capture("diary-conflict")
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(10_000) { repository.state.value.records.any { !it.draft && it.note.title == "QA conflict copy" } }
        val records = repository.state.value.records
        val copy = records.first { !it.draft && it.note.title == "QA conflict copy" }.note
        assertEquals("personal", copy.category); assertNull(copy.adviceId); assertNull(copy.reaction)
        assertEquals("saved", records.first { !it.draft && it.note.id == original.id }.note.category)
        compose.onNodeWithTag("diary-category-personal").assertIsSelected()
        compose.onNodeWithTag("diary-note-${copy.id}").assertExists()
        assertFalse(records.any { it.draft && it.note.id == original.id })
        capture("diary-conflict-personal")
    }

    @Test fun commonSelectionIsVisibleAndInteractiveInEveryPalette() {
        var palette by mutableStateOf("light"); var selected by mutableStateOf(true)
        compose.setContent { Frame(palette) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            FilterChip(selected, { selected = !selected }, { Text("QA option") }, Modifier.testTag("qa324-filter"))
            InputChip(selected, { selected = !selected }, { Text("QA filter") }, Modifier.testTag("qa324-input"))
            IconToggleButton(selected, { selected = it }, Modifier.testTag("qa324-toggle")) { GenesisLucideIcon("pin") }
            FilterChip(true, {}, { Text("QA unavailable") }, Modifier.testTag("qa324-disabled"), enabled = false)
        } } }
        for (next in listOf("light", "green", "burgundy", "blue", "violet")) {
            compose.runOnIdle { palette = next; selected = true }
            compose.onNodeWithTag("qa324-filter").assertIsSelected()
            compose.onNodeWithTag("qa324-input").assertIsSelected()
            compose.onNodeWithTag("qa324-toggle").assertIsOn()
            compose.onNodeWithTag("qa324-disabled").assertIsNotEnabled()
            for (tag in listOf("qa324-filter", "qa324-input", "qa324-toggle")) {
                val bounds = compose.onNodeWithTag(tag).getUnclippedBoundsInRoot()
                val height = (bounds.bottom - bounds.top).value
                assertTrue("$tag has a 48dp target (measured $height)", height + .01f >= 48f)
            }
            val bitmap = compose.onNodeWithTag("qa324-filter").captureToImage().asAndroidBitmap()
            val border = Color(bitmap.getPixel(bitmap.width / 2, 2))
            val fill = Color(bitmap.getPixel(bitmap.width / 2, bitmap.height * 4 / 5))
            val contrast = (maxOf(border.luminance(), fill.luminance()) + .05f) / (minOf(border.luminance(), fill.luminance()) + .05f)
            assertTrue("Actual selected border/fill is distinguishable in $next ($contrast)", contrast >= 3f)
            compose.onNodeWithTag("qa324-filter").performClick().assertIsNotSelected()
            compose.onNodeWithTag("qa324-toggle").assertIsOff().performClick().assertIsOn()
            capture("selection-$next")
        }
    }

    @Test fun realMoodEditorShowsColoredFacesAndSavesSelectedNumericValue() {
        var palette by mutableStateOf("light"); var language by mutableStateOf("ru")
        var selected: Int? = null
        compose.setContent { Frame(palette, language) { key(language) {
            MoodObservationEditor(emptyList(), LocalDate.now(), CalendarMode.PROFANE, language, emptyList(), false, null,
                onDismiss = {}, fixedDate = true, onSave = { _, value, _, _, _ -> selected = value })
        } } }
        for ((next, lang) in listOf("light" to "ru", "green" to "en", "burgundy" to "ru", "blue" to "en", "violet" to "ru")) {
            compose.runOnIdle { palette = next; language = lang }
            for (value in -5..6) {
                val option = compose.onNodeWithTag("mood-value-$value")
                option.performScrollTo().assertIsDisplayed()
                val bounds = option.getUnclippedBoundsInRoot()
                assertTrue(bounds.bottom - bounds.top >= 48.dp)
            }
            compose.onNodeWithTag("mood-value-6").performScrollTo().performClick().assertIsSelected()
            capture("mood-$next-bottom")
            compose.onNodeWithTag("mood-entry-save").performScrollTo().performClick()
            compose.runOnIdle { assertEquals(6, selected) }
            compose.onNodeWithTag("mood-value--5").performScrollTo()
            capture("mood-$next-top")
        }
    }

    @Test fun lunarHeroKeepsThreeOrderedGroupsAndTheMoonAtTheTopRight() {
        var palette by mutableStateOf("light"); var language by mutableStateOf("ru")
        compose.setContent { Frame(palette, language) { Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
            DayHeader(LocalDate.of(2026, 11, 6), CalendarMode.LUNAR)
        } } }
        for ((next, lang) in listOf("light" to "ru", "green" to "en", "burgundy" to "ru", "blue" to "en", "violet" to "ru")) {
            compose.runOnIdle { palette = next; language = lang }
            val tags = listOf("today-civil-date", "today-calendar-name", "today-hero-month", "today-lunar-progress", "today-lunar-epithet", "today-lunar-description")
            val tops = tags.map { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot.top }
            assertEquals(tops.sorted(), tops)
            val moon = compose.onNodeWithTag("today-lunar-phase").fetchSemanticsNode().boundsInRoot
            val month = compose.onNodeWithTag("today-hero-month").fetchSemanticsNode().boundsInRoot
            assertTrue(moon.top < month.top)
            assertTrue(moon.center.x > month.center.x)
            compose.onNodeWithTag("today-hero-context").assertExists()
            compose.onNodeWithTag("today-hero-meaning").assertExists()
            compose.onAllNodesWithTag("today-hero-details").assertCountEquals(0)
            compose.onNodeWithTag("today-solar-times").assertExists()
            capture("lunar-$next-$lang")
        }
    }

    @Test fun taskDateAndTimeStayBeforeDetailsAndNewTaskDefaultsToChaos() {
        var saved: LocalTask? = null
        var checkpoint = "open"
        fun diagnostics(failure: Throwable) {
            val scale = args.getString("genesisFontScale", "system")
            val stem = "release324-task-editor-failure-$scale-$checkpoint"
            val semantics = runCatching {
                compose.onAllNodes(isRoot(), useUnmergedTree = true).printToString(maxDepth = 24)
            }.getOrElse { "Semantics unavailable: ${it.stackTraceToString()}" }
            File(context.getExternalFilesDir(null), "$stem.semantics.txt").writeText(semantics)
            val screenshot = runCatching {
                captureNativeWindow(File(context.getExternalFilesDir(null), "$stem.png"))
            }.exceptionOrNull()?.stackTraceToString() ?: "captured"
            File(context.getExternalFilesDir(null), "$stem.json").writeText(JSONObject()
                .put("checkpoint", checkpoint).put("fontScale", scale).put("screenshot", screenshot)
                .put("failure", failure.stackTraceToString()).toString(2))
        }
        try {
        compose.setContent { Frame("blue") {
            TaskEditor(null, LocalDate.now().toString(), UiPreferences(input = CalendarMode.PROFANE), WorkspaceStructure(), null,
                null, emptyList(), null, onDismiss = {}, onSave = { saved = it }, onTransfer = null,
                onDelete = null, onDeleteOccurrence = null, showSelectedOccurrence = false)
        } }
        checkpoint = "title-entry"
        compose.onNodeWithTag("task-title").performScrollTo().performClick().performTextReplacement("QA date and time")
        capture("task-title-before-ime-dismiss")
        checkpoint = "dismiss-ime"
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.waitForIdle()
        capture("task-title-after-ime-dismiss")
        checkpoint = "reveal-date"
        compose.onNodeWithTag("task-date-picker").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("task-time-picker").assertIsDisplayed()
        val date = compose.onNodeWithTag("task-date-picker").fetchSemanticsNode().boundsInRoot
        val time = compose.onNodeWithTag("task-time-picker").fetchSemanticsNode().boundsInRoot
        checkpoint = "same-row"
        val verticalOverlap = minOf(date.bottom, time.bottom) - maxOf(date.top, time.top)
        assertTrue("Date and time overlap vertically in the same row: date=$date time=$time",
            verticalOverlap >= .8f * minOf(date.height, time.height))
        assertTrue("Date and time occupy distinct horizontal positions: date=$date time=$time", date.right <= time.left)
        compose.onAllNodesWithTag("project-picker-section").assertCountEquals(0)
        capture("task-date-before-details")
        checkpoint = "details"
        compose.onNodeWithTag("task-options-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("project-picker-section").assertExists()
        compose.onNodeWithTag("task-options-toggle").performClick()
        checkpoint = "save-chaos"
        compose.onNodeWithTag("save-task").performClick()
        compose.runOnIdle { assertNotNull(saved); assertNull(saved!!.projectId) }
        } catch (failure: Throwable) { diagnostics(failure); throw failure }
    }

    @Test fun civilHeroRendersTheCurrentLandscapeAndClockWithoutAServerOrAccount() {
        // A continuously interpolated sun must not advance the test clock forever while awaiting idle.
        compose.mainClock.autoAdvance = false
        val location = SolarLocation(55.75, 37.61, "Europe/Moscow", "QA approximate Moscow")
        val calendar = GenesisCalendar()
        compose.setContent { Frame("green", "en") {
            CivilTodayHero(location, calendar, ZoneId.of("Europe/Moscow"))
        } }
        compose.waitUntil(15_000) {
            compose.mainClock.advanceTimeByFrame()
            compose.onAllNodesWithTag("civil-today-terrain").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("civil-today-hero").assertIsDisplayed()
        compose.onNodeWithTag("civil-today-sky").assertExists()
        compose.onNodeWithTag("civil-today-terrain").assertExists()
        compose.onNodeWithTag("today-civil-date").assertExists()
        compose.onNodeWithTag("today-civil-clock").assertExists()
        capture("civil-landscape")
    }

    @Test fun sharingProducesOneCompletePngWithOnlyTheWebsiteInItsCaption() {
        val advice = DailyAdvice("qa324-share", LocalDate.now().toString(), "QA · Совет Авроры",
            "Сохраняйте внимание к выбранному делу.\n\n".repeat(24), "ru", emptyList(), null, false,
            listOf(DailyAdviceSource("inspired", "QA author", "Synthetic source", "")))
        val artwork = context.assets.open("originals/lunar-month-art-v1/month-09.webp").use(BitmapFactory::decodeStream)
        val bitmap = adviceShareBitmap(advice, artwork)
        assertEquals(1080, bitmap.width); assertTrue(bitmap.height > 1080)
        val file = File(context.getExternalFilesDir(null), "release324-shared-advice.png")
        file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        val intent = adviceShareIntent(context, advice, artwork)
        assertEquals(Intent.ACTION_SEND, intent.action); assertEquals("image/png", intent.type)
        val caption = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        val website = Uri.parse(caption.substringAfter('\n'))
        assertEquals("https", website.scheme); assertEquals("genesiscalendar.com", website.host)
        assertFalse(intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty().contains(advice.body))
        val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        assertNotNull(uri)
        val decoded = context.contentResolver.openInputStream(uri!!).use(BitmapFactory::decodeStream)
        assertEquals(bitmap.width, decoded.width); assertEquals(bitmap.height, decoded.height)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        bitmap.recycle(); decoded.recycle(); artwork.recycle()
    }

    @Test fun encyclopediaStartsCollapsedPreservesEveryCardAndAllowsDirectLinks() {
        val app = context.applicationContext as ru.genesis.calendar.GenesisApplication
        check(!app.workspaceScope.startsWith("account-"))
        val rawLetters = JSONArray(context.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val letterIds = (0 until rawLetters.length()).map { rawLetters.getJSONObject(it).getString("id") }
        assertEquals("The bundled encyclopedia has all 24 distinct letters", 24, letterIds.distinct().size)
        val beta = (0 until rawLetters.length()).map(rawLetters::getJSONObject).first { it.getString("id") == "beta" }
        var palette by mutableStateOf("light")
        var initialCard by mutableStateOf<String?>(null)
        var checkpoint = "setup"
        compose.setContent { Frame(palette) { key(palette) {
            StoicheionScreen(app, divinationDisabled = true, initialCardId = initialCard,
                onInitialCardOpened = { initialCard = null })
        } } }
        fun diagnostics(failure: Throwable) {
            val stem = "release324-alphabet-failure-$palette-$checkpoint"
            val semantics = runCatching {
                compose.onAllNodes(isRoot(), useUnmergedTree = true).printToString(maxDepth = 24)
            }.getOrElse { "Semantics unavailable: ${it.stackTraceToString()}" }
            File(context.getExternalFilesDir(null), "$stem.semantics.txt").writeText(semantics)
            val screenshot = runCatching {
                captureNativeWindow(File(context.getExternalFilesDir(null), "$stem.png"))
            }.exceptionOrNull()?.stackTraceToString() ?: "captured"
            File(context.getExternalFilesDir(null), "$stem.json").writeText(JSONObject()
                .put("palette", palette).put("checkpoint", checkpoint)
                .put("fontScale", args.getString("genesisFontScale", "system"))
                .put("expectedLetters", JSONArray(letterIds)).put("screenshot", screenshot)
                .put("failure", failure.stackTraceToString()).toString(2))
        }
        try { for (next in listOf("light", "blue")) {
            compose.runOnIdle { palette = next }
            checkpoint = "load"
            val loadFailure = "Не удалось открыть авторские карты. Данные не заменены."
            compose.waitUntil(30_000) {
                compose.onAllNodesWithText("Гадания по картам выключены", useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText(loadFailure, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onAllNodesWithText(loadFailure, useUnmergedTree = true).assertCountEquals(0)
            val grid = compose.onNodeWithTag("stoicheion-grid")
            checkpoint = "collapsed"
            // Data may be loaded while a lazy item's controls are still below the viewport.
            grid.performScrollToNode(hasTestTag("stoicheion-alphabet-toggle"))
            compose.onAllNodesWithTag("stoicheion-letter-alpha").assertCountEquals(0)
            compose.onAllNodesWithTag("stoicheion-catalog-block").assertCountEquals(0)
            compose.onNodeWithTag("stoicheion-alphabet-toggle").assertIsDisplayed().assertIsNotSelected()
            capture("alphabet-collapsed-$next")
            compose.onNodeWithTag("stoicheion-alphabet-toggle").performClick().assertIsSelected()
            checkpoint = "alpha-dialog"
            grid.performScrollToNode(hasTestTag("stoicheion-letter-alpha"))
            compose.onNodeWithTag("stoicheion-letter-alpha").performClick()
            compose.onNodeWithTag("stoicheion-reading-dialog").assertIsDisplayed()
            capture("alphabet-reading-$next")
            compose.onNodeWithTag("stoicheion-reading-close").performClick()
            checkpoint = "all24-letters"
            for (id in letterIds) {
                grid.performScrollToNode(hasTestTag("stoicheion-letter-$id"))
                compose.onNodeWithTag("stoicheion-letter-$id").assertIsDisplayed()
            }
            compose.onNodeWithTag("stoicheion-letter-omega").assertIsDisplayed()
            checkpoint = "collapse"
            grid.performScrollToNode(hasTestTag("stoicheion-alphabet-toggle"))
            compose.onNodeWithTag("stoicheion-alphabet-toggle").performClick().assertIsNotSelected()
            compose.onAllNodesWithTag("stoicheion-letter-alpha").assertCountEquals(0)
            compose.onAllNodesWithTag("stoicheion-catalog-block").assertCountEquals(0)
            checkpoint = "beta-direct-link"
            compose.runOnIdle { initialCard = "beta" }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("stoicheion-reading-dialog").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("stoicheion-reading-dialog").assertIsDisplayed()
                .assert(hasAnyDescendant(hasText("${beta.getString("symbol")} · ${beta.getString("name")}")))
            compose.runOnIdle { assertNull(initialCard) }
            compose.onNodeWithTag("stoicheion-reading-close").performClick()
            grid.performScrollToNode(hasTestTag("stoicheion-alphabet-toggle"))
            compose.onNodeWithTag("stoicheion-alphabet-toggle").assertIsNotSelected()
        } } catch (failure: Throwable) { diagnostics(failure); throw failure }
    }
}
