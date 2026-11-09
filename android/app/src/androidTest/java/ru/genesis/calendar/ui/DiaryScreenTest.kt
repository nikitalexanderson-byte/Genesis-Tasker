package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.DiaryGateway
import ru.genesis.calendar.auth.DiaryProtocol
import ru.genesis.calendar.data.*
import java.io.File
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

private class DiaryUiStore : DiaryStore {
    var ciphertext: String? = null
    var failWrites = false
    override suspend fun read() = ciphertext
    override suspend fun write(ciphertext: String) { check(!failWrites) { "Synthetic storage failure" }; this.ciphertext = ciphertext }
}
private class DiaryUiGateway : DiaryGateway {
    val key = ByteArray(32) { it.toByte() }
    val rows = mutableMapOf<String, JSONObject>()
    var offline = false
    var invalidResponse = false
    var readGate: CompletableDeferred<Unit>? = null
    private var syncEnabled = true
    private var settingsRevision = 0L
    private val snapshot = "0".repeat(64)
    private fun metadata() = JSONObject().put("settings", JSONObject().put("syncEnabled", syncEnabled).put("revision", settingsRevision))
        .put("snapshot", snapshot).put("deleted", JSONArray())
    override fun check() = Unit
    override suspend fun workspace() = JSONObject().put("workspace", JSONObject().put("keyMode", "account").put("key", Base64.getEncoder().encodeToString(key)))
    override suspend fun request(path: String, body: JSONObject?): JSONObject {
        if (body == null) {
            readGate?.await()
            if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK)
            if (path == "/diary/settings") return metadata()
            if (invalidResponse) return JSONObject().put("notes", JSONArray().put(JSONObject().put("version", 99)))
            return metadata().put("notes", JSONArray(rows.values.toList()))
        }
        if (path == "/diary/settings") {
            check(body.getLong("expectedRevision") == settingsRevision && body.getString("expectedSnapshot") == snapshot)
            syncEnabled = body.getBoolean("syncEnabled"); settingsRevision++
            return metadata()
        }
        val id = path.substringAfterLast('/'); val previous = rows[id]
        val same = previous != null && previous.getString("ciphertext") == body.getString("ciphertext") && previous.getString("iv") == body.getString("iv")
        if (!same) {
            if ((previous?.getLong("revision") ?: 0) != body.getLong("expectedRevision")) throw AuthFailure(AuthFailure.Kind.CONFLICT, 409)
            rows[id] = JSONObject(body.toString()).put("id", id).put("revision", body.getLong("expectedRevision") + 1).put("updatedAt", "2026-10-26T12:00:00Z")
        }
        return JSONObject().put("revision", rows.getValue(id).getLong("revision")).put("updatedAt", "2026-10-26T12:00:00Z")
    }
}

/** Standalone synthetic account: no user session, app workspace, device data or production API. */
class DiaryScreenTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val store = DiaryUiStore()
    private val gateway = DiaryUiGateway()
    private val repository = DiaryRepository("diary-ui-fixture", gateway, store, DiaryKeystoreCipher("diary-ui-fixture", "diary-ui-fixture"))
    @Test fun savedOriginalAdviceUsesCompactQuoteAndKeepsUserEditsVerbatim() {
        val body = "(О дружбе) Дружба — благо.\n\n\nВторая строка.\nЭпикур"
        val advice = JSONObject().put("id", "advice-" + "c".repeat(24)).put("collection", "philosophers")
            .put("body", body).put("language", "ru").put("categories", JSONArray())
            .put("sources", JSONArray().put(JSONObject().put("kind", "quote").put("author", "Эпикур").put("work", "Античный источник")))
        val note = DiaryNote.create(body, "Афоризмы философов").changed { put("advice", advice) }
        val record = runBlocking { repository.refresh(); repository.save(note) }
        compose.setContent { Content() }
        await("diary-note-${note.id}")
        compose.onNodeWithText("О дружбе", useUnmergedTree = true).assertIsDisplayed()
        val quote = compose.onNodeWithText("Дружба — благо.\nВторая строка.", useUnmergedTree = true)
        val author = compose.onNodeWithText("(Эпикур)", useUnmergedTree = true)
        quote.assertIsDisplayed(); author.assertIsDisplayed()
        assertTrue(author.fetchSemanticsNode().boundsInRoot.top > quote.fetchSemanticsNode().boundsInRoot.bottom)
        capture("original-advice-compact")
        val editedBody = "Моя заметка.\n\nЯ сохраняю этот отступ."
        runBlocking { repository.save(note.changed { put("body", editedBody) }, record.revision) }
        compose.waitUntil(10000) { compose.onAllNodesWithText(editedBody, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(editedBody, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("О дружбе", useUnmergedTree = true).assertDoesNotExist()
        capture("edited-advice-note")
    }
    private val width get() = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
    @Composable private fun Content(language: String = "ru", logicalWidth: Int = width, fontScaleOverride: Float? = null,
        night: Boolean = dark, textLayoutAudit: ((String, TextLayoutResult) -> Unit)? = null) {
        val scale = fontScaleOverride ?: InstrumentationRegistry.getArguments().getString("genesisFontScale")?.toFloatOrNull() ?: LocalDensity.current.fontScale
        val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / logicalWidth, scale)
        val configuration = android.content.res.Configuration(LocalConfiguration.current).apply {
            screenWidthDp = logicalWidth
            screenHeightDp = (compose.activity.resources.displayMetrics.heightPixels / density.density).toInt()
            fontScale = scale
        }
        CompositionLocalProvider(LocalDensity provides density, LocalConfiguration provides configuration,
            LocalGenesisLanguage provides language, LocalEveningTheme provides night, LocalGenesisTextLayoutAudit provides textLayoutAudit) {
            MaterialTheme(colorScheme = if (night) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                Surface(Modifier.fillMaxSize()) {
                    MobileWorkspaceShell("Дневник", null, emptyList(), "Synthetic fixture", true,
                        onNavigate = {}, actions = {
                            CalendarModeSwitcher(ru.genesis.calendar.domain.CalendarMode.PROFANE, {}, size = 48.dp)
                        }, footerActions = {
                            WorkspaceAccountRefreshButton("Обновить аккаунт", onClick = {})
                        }) { DiaryScreen(repository, {}) }
                }
            }
        }
    }
    private fun await(tag: String) { compose.waitUntil(20_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }; compose.waitForIdle() }
    private fun capture(name: String, tag: String = "diary-screen") {
        compose.waitForIdle()
        compose.onNodeWithTag(tag).assertExists()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "diary-${width}-${if (dark) "dark" else "light"}-$name.png"))
    }

    @Test fun cachedOfflineDiaryShowsItsNoticeOnlyInTheDrawerWithoutAProgressSpinner() {
        val note = DiaryNote.create("Сохранённая запись доступна без сети", "Офлайн-проверка")
        runBlocking { repository.refresh(); repository.save(note) }
        gateway.offline = true
        compose.setContent { Content() }; await("diary-create")
        compose.waitUntil(20_000) { repository.state.value.offline }
        val message = "Нет сети. Доступна защищённая локальная копия дневника."
        compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag("diary-screen")), useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("diary-offline").assertDoesNotExist()
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-diary-offline").performScrollTo().assertIsDisplayed()
        compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag("drawer-diary-offline")), useUnmergedTree = true).assertExists()
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo) and
            hasAnyAncestor(hasTestTag("drawer-diary-offline")), useUnmergedTree = true).assertCountEquals(0)
        assertTrue(repository.state.value.records.single().note.sameContent(note))
    }

    @Test fun protectedDiaryFormatErrorStaysInTheDrawerAndRetryPreservesTheCachedRecord() {
        val note = DiaryNote.create("Защищённая запись должна сохраниться", "Проверка восстановления")
        runBlocking { repository.refresh(); repository.save(note) }
        gateway.invalidResponse = true
        compose.setContent { Content() }; await("diary-create")
        compose.waitUntil(20_000) { repository.state.value.protected }
        val message = "Формат дневника изменился. Обновите приложение; записи сохранены."
        compose.onNodeWithTag("diary-create").assertIsNotEnabled()
        compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag("diary-screen")), useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("workspace-menu").performClick()
        compose.onNodeWithTag("drawer-diary-error").performScrollTo().assertIsDisplayed()
        compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag("drawer-diary-error")), useUnmergedTree = true).assertExists()
        compose.runOnIdle { gateway.invalidResponse = false }
        compose.onNodeWithTag("drawer-diary-error-retry").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(20_000) { !repository.state.value.protected &&
            compose.onAllNodesWithTag("drawer-diary-error").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("drawer-close").performScrollTo().performClick()
        compose.onNodeWithTag("diary-create").assertIsEnabled()
        assertTrue(repository.state.value.records.single().note.sameContent(note))
    }

    @Test fun everyDiaryLocaleKeepsNotesAndDrawerStatusesReadableAt360AndLargeFontInBothThemes() {
        val supported = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        val requestedLanguage = InstrumentationRegistry.getArguments().getString("genesisDiaryLanguage")
        require(requestedLanguage == null || requestedLanguage in supported)
        val languages = if (requestedLanguage == null) supported else listOf(requestedLanguage)
        val context = compose.activity
        val nativeCopy = JSONObject(context.assets.open("native-3-translations.json").bufferedReader().use { it.readText() })
        val diaryCopy = JSONObject(context.assets.open("originals/i18n/diary-copy.json").bufferedReader().use { it.readText() })
        val note = DiaryNote.create("Авторский текст {body}: Москва и Αθήνα.", "Новая запись · {title} · Tokyo")
        runBlocking { repository.refresh(); repository.save(note) }
        var language by mutableStateOf("ru")
        var night by mutableStateOf(false)
        var epoch by mutableIntStateOf(0)
        val layouts = ConcurrentHashMap<String, TextLayoutResult>()
        val states = JSONArray()
        val completed = mutableListOf<String>()
        var checkpoint = "setup"
        var failure: Throwable? = null
        compose.setContent { key(epoch) { Content(language, 360, 1.3f, night) { text, layout -> layouts[text] = layout } } }
        try {
            for (scheme in listOf(false, true)) for (choice in languages) {
                val prefix = "${if (scheme) "dark" else "light"}/$choice"
                checkpoint = "$prefix/entry"
                compose.runOnIdle { language = choice; night = scheme; epoch++; layouts.clear() }
                // Diary expectations require this locale's exact dictionary objects and keys.
                val native = nativeCopy.getJSONObject(choice)
                val copy = diaryCopy.getJSONObject(choice)
                // Common editor buttons use the app's reviewed regional wording, independently of privacy copy.
                val saveLabel = if (choice == "pt") "Guardar" else copy.getString("save")
                val cancelLabel = if (choice == "sr") "Одустани" else copy.getString("cancel")
                fun t(source: String) = translateGenesisText(context, source, choice)
                fun state(name: String, vararg required: String) {
                    checkpoint = "$prefix/$name"
                    compose.waitForIdle()
                    val split = layouts.filterValues { it.splitsWord() }.keys
                    assertTrue("$checkpoint: words split across lines: $split", split.isEmpty())
                    required.forEach { text ->
                        val layout = requireNotNull(layouts[text]) { "$checkpoint: no rendered layout for $text" }
                        val clipped = layout.didOverflowWidth || layout.didOverflowHeight ||
                            layout.multiParagraph.didExceedMaxLines || (0 until layout.lineCount).any { layout.isLineEllipsized(it) }
                        if (clipped) {
                            val diagnosticName = "diary-locale-360-font1.3-${checkpoint.replace('/', '-')}-clipped-label"
                            runCatching {
                                val input = layout.layoutInput
                                val lines = JSONArray()
                                for (line in 0 until layout.lineCount) lines.put(JSONObject()
                                    .put("index", line).put("start", layout.getLineStart(line))
                                    .put("end", layout.getLineEnd(line)).put("visibleEnd", layout.getLineEnd(line, visibleEnd = true))
                                    .put("topPx", layout.getLineTop(line)).put("bottomPx", layout.getLineBottom(line))
                                    .put("baselinePx", layout.getLineBaseline(line)).put("leftPx", layout.getLineLeft(line))
                                    .put("rightPx", layout.getLineRight(line)).put("ellipsized", layout.isLineEllipsized(line)))
                                val nodes = JSONArray()
                                compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().forEach { node ->
                                    val bounds = node.boundsInRoot
                                    nodes.put(JSONObject().put("leftPx", bounds.left).put("topPx", bounds.top)
                                        .put("rightPx", bounds.right).put("bottomPx", bounds.bottom)
                                        .put("widthPx", bounds.width).put("heightPx", bounds.height)
                                        .put("measuredWidthPx", node.size.width).put("measuredHeightPx", node.size.height))
                                }
                                File(context.getExternalFilesDir(null), "$diagnosticName.json").writeText(JSONObject()
                                    .put("checkpoint", checkpoint).put("label", text).put("layoutText", input.text.text)
                                    .put("fontSize", input.style.fontSize.toString()).put("lineHeight", input.style.lineHeight.toString())
                                    .put("fontFamily", input.style.fontFamily.toString()).put("fontWeight", input.style.fontWeight.toString())
                                    .put("letterSpacing", input.style.letterSpacing.toString()).put("style", input.style.toString())
                                    .put("density", input.density.density).put("fontScale", input.density.fontScale)
                                    .put("constraintsPx", JSONObject().put("minWidth", input.constraints.minWidth)
                                        .put("maxWidth", input.constraints.maxWidth).put("minHeight", input.constraints.minHeight)
                                        .put("maxHeight", input.constraints.maxHeight))
                                    .put("sizePx", JSONObject().put("width", layout.size.width).put("height", layout.size.height))
                                    .put("paragraphWidthPx", layout.multiParagraph.width).put("paragraphHeightPx", layout.multiParagraph.height)
                                    .put("maxLines", input.maxLines).put("softWrap", input.softWrap).put("overflow", input.overflow.toString())
                                    .put("lineCount", layout.lineCount).put("didOverflowWidth", layout.didOverflowWidth)
                                    .put("didOverflowHeight", layout.didOverflowHeight).put("hasVisualOverflow", layout.hasVisualOverflow)
                                    .put("didExceedMaxLines", layout.multiParagraph.didExceedMaxLines)
                                    .put("lines", lines).put("semanticsNodes", nodes).toString(2))
                            }.onFailure { android.util.Log.e("GENESIS_LAYOUT_DIAGNOSTIC", "Diary layout capture failed: $checkpoint", it) }
                            runCatching { captureNativeWindow(File(context.getExternalFilesDir(null), "$diagnosticName.png")) }
                                .onFailure { android.util.Log.e("GENESIS_LAYOUT_DIAGNOSTIC", "Diary window capture failed: $checkpoint", it) }
                        }
                        assertFalse("$checkpoint: clipped/ellipsized label: $text", clipped)
                    }
                    states.put(JSONObject().put("checkpoint", checkpoint).put("renderedStrings", layouts.size)
                        .put("checkedLabels", JSONArray(required.toList())))
                }
                fun shot(name: String) {
                    captureNativeWindow(File(context.getExternalFilesDir(null), "diary-locale-360-font1.3-${prefix.replace('/', '-')}-$name.png"))
                }
                fun closeDialog(tag: String) {
                    compose.onNode(hasContentDescription(t("Закрыть")) and hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).performClick()
                    compose.waitUntil(10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty() }
                }
                fun closeDrawer() { compose.onNodeWithTag("drawer-close").performScrollTo().performClick(); compose.waitForIdle() }
                fun refresh() {
                    compose.onNodeWithTag("diary-actions").performClick()
                    compose.onNodeWithText(t("Обновить")).performClick()
                }
                fun notice(tag: String, message: String) {
                    compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag("diary-screen")), useUnmergedTree = true).assertDoesNotExist()
                    compose.onNodeWithTag("diary-${tag.removePrefix("drawer-diary-")}").assertDoesNotExist()
                    compose.onNodeWithTag("workspace-menu").performClick()
                    compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
                    compose.onNode(hasText(message) and hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).assertExists()
                    compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo) and
                        hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).assertCountEquals(0)
                    compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange) and
                        hasAnyAncestor(hasTestTag(tag)), useUnmergedTree = true).assertCountEquals(0)
                    state(tag, message)
                }
                await("diary-open-${note.id}")
                compose.onNodeWithTag("workspace-title").assertTextEquals(native.getString("Дневник"))
                compose.onNodeWithTag("diary-create").assertContentDescriptionEquals(native.getString("Новая запись"))
                compose.onNodeWithTag("diary-actions").assertContentDescriptionEquals(native.getString("Действия дневника"))
                compose.onNode(hasText(note.title) and hasAnyAncestor(hasTestTag("diary-note-${note.id}")), useUnmergedTree = true).assertExists()
                compose.onNode(hasText(note.body) and hasAnyAncestor(hasTestTag("diary-note-${note.id}")), useUnmergedTree = true).assertExists()
                state("board", native.getString("Дневник")); shot("board")
                compose.onNodeWithTag("diary-open-${note.id}").performClick(); await("diary-editor")
                assertEquals(note.title, compose.onNodeWithTag("diary-title").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
                assertEquals(note.body, compose.onNodeWithTag("diary-body").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
                compose.onNodeWithText(native.getString("Редактирование записи"), useUnmergedTree = true).assertExists()
                compose.onNodeWithText(native.getString("Текст записи"), useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("diary-save").assertIsDisplayed().assertIsEnabled().assertHeightIsAtLeast(48.dp)
                compose.onNodeWithText(saveLabel, useUnmergedTree = true).assertExists()
                compose.onNodeWithText(cancelLabel, useUnmergedTree = true).assertExists()
                for ((index, color) in DiaryNote.colors.withIndex()) {
                    val label = native.getString(listOf("Шалфей", "Песок", "Роза", "Небо")[index])
                    compose.onNodeWithTag("diary-color-$color").performScrollTo().assertHeightIsAtLeast(48.dp).assertContentDescriptionEquals(label)
                    state("preset-$color", label)
                }
                compose.onNodeWithTag("diary-color-custom").performScrollTo().assertHeightIsAtLeast(48.dp).performClick(); await("diary-color-picker")
                compose.onNodeWithText(t("Цвет записи"), useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("diary-color-apply").assertIsDisplayed().assertIsEnabled()
                state("custom-color", t("Цвет записи"), t("Применить"), cancelLabel); shot("palette")
                closeDialog("diary-color-picker")
                state("editor", saveLabel, cancelLabel); shot("editor")
                closeDialog("diary-editor")
                compose.onNodeWithTag("diary-actions").performClick(); compose.onNodeWithTag("diary-favorites-open").performClick()
                compose.onNodeWithTag("diary-notes").performScrollToNode(hasText(native.getString("Избранных советов пока нет.")))
                compose.onNodeWithText(native.getString("Избранных советов пока нет.")).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("diary-back-to-board").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                compose.onNodeWithTag("diary-back-to-board").assertContentDescriptionEquals(t("Назад в дневник"))
                state("favorites", native.getString("Избранных советов пока нет."))
                compose.onNodeWithTag("diary-back-to-board").performClick()
                compose.onNodeWithTag("diary-actions").performClick(); compose.onNodeWithText(t("Архив")).performClick()
                compose.onNodeWithTag("diary-notes").performScrollToNode(hasText(native.getString("В архиве пока нет записей.")))
                compose.onNodeWithText(native.getString("В архиве пока нет записей.")).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("diary-back-to-board").assertContentDescriptionEquals(t("Назад в дневник"))
                state("archive", native.getString("В архиве пока нет записей."))
                compose.onNodeWithTag("diary-back-to-board").performClick()
                compose.onNodeWithTag("diary-search-open").assertContentDescriptionEquals(t("Поиск записей")).performClick(); await("diary-search")
                compose.onNodeWithText(t("Поиск записей"), useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("diary-search-close").assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
                state("search", t("Поиск записей"))
                compose.onNodeWithTag("diary-search").performTextReplacement("missing-synthetic-note")
                compose.dismissValidationKeyboard()
                compose.onNodeWithTag("diary-notes").performScrollToNode(hasText(native.getString("Записи не найдены. Измените запрос.")))
                compose.onNodeWithText(native.getString("Записи не найдены. Измените запрос.")).assertIsDisplayed()
                state("empty-search", native.getString("Записи не найдены. Измените запрос."))
                compose.onNodeWithTag("diary-search").performTextClearance()
                compose.onNodeWithTag("diary-search-close").performClick(); await("diary-open-${note.id}")
                val gate = CompletableDeferred<Unit>()
                compose.runOnIdle { gateway.readGate = gate }
                refresh(); compose.onNodeWithTag("workspace-menu").performClick(); await("drawer-background-status")
                compose.onNodeWithTag("drawer-background-status").performScrollTo().assertIsDisplayed()
                compose.onNode(hasText(t("Загрузка…")) and hasAnyAncestor(hasTestTag("drawer-background-status")), useUnmergedTree = true).assertExists()
                compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo) and
                    hasAnyAncestor(hasTestTag("diary-screen")), useUnmergedTree = true).assertCountEquals(0)
                state("loading-in-drawer", t("Загрузка…"))
                compose.runOnIdle { gateway.readGate = null; gate.complete(Unit) }
                compose.waitUntil(20_000) { compose.onAllNodesWithTag("drawer-background-status").fetchSemanticsNodes().isEmpty() }
                closeDrawer()
                compose.runOnIdle { gateway.offline = true }; refresh()
                compose.waitUntil(20_000) { repository.state.value.offline }
                notice("drawer-diary-offline", native.getString("Нет сети. Доступна защищённая локальная копия дневника.")); shot("offline")
                closeDrawer()
                compose.runOnIdle { gateway.offline = false; gateway.invalidResponse = true }; refresh()
                compose.waitUntil(20_000) { repository.state.value.protected }
                compose.onNodeWithTag("diary-create").assertIsNotEnabled()
                notice("drawer-diary-error", native.getString("Формат дневника изменился. Обновите приложение; записи сохранены."))
                compose.onNodeWithTag("drawer-diary-error-retry").performScrollTo().assertIsEnabled().assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
                state("protected-retry", t("Повторить")); shot("protected")
                compose.runOnIdle { gateway.invalidResponse = false }
                compose.onNodeWithTag("drawer-diary-error-retry").performClick()
                compose.waitUntil(20_000) { !repository.state.value.protected && !repository.state.value.offline &&
                    compose.onAllNodesWithTag("drawer-diary-error").fetchSemanticsNodes().isEmpty() }
                closeDrawer()
                compose.onNodeWithTag("diary-create").assertIsEnabled()
                compose.onNodeWithTag("diary-actions").performClick(); compose.onNodeWithTag("diary-settings-open").performClick(); await("diary-settings-dialog")
                compose.onNode(hasText(copy.getString("settings")) and hasAnyAncestor(hasTestTag("diary-settings-dialog")), useUnmergedTree = true).assertExists()
                compose.onNodeWithTag("diary-sync-status").assertTextEquals(copy.getString("syncOn"))
                state("settings", copy.getString("settings"), copy.getString("syncLabel"), copy.getString("syncOn"))
                for (key in listOf("syncHint", "localWarning", "backupRetention")) {
                    compose.onNode(hasText(copy.getString(key)) and hasAnyAncestor(hasTestTag("diary-settings-dialog")), useUnmergedTree = true).performScrollTo().assertIsDisplayed()
                    state("settings-$key", copy.getString(key))
                }
                compose.onNodeWithTag("diary-purge-server").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
                state("settings-server-action", copy.getString("purgeServer"))
                compose.onNodeWithTag("diary-sync-toggle").performScrollTo().performClick(); await("diary-sync-confirmation")
                compose.onNodeWithText(copy.getString("disableTitle"), useUnmergedTree = true).assertExists()
                compose.onNodeWithText(copy.getString("disableBody"), useUnmergedTree = true).performScrollTo().assertIsDisplayed()
                state("disable-confirmation", copy.getString("disableTitle"), copy.getString("disableBody"), copy.getString("apply"))
                compose.onNodeWithTag("diary-sync-confirm").performClick()
                compose.waitUntil(20_000) { !repository.state.value.syncEnabled && compose.onAllNodesWithTag("diary-sync-confirmation").fetchSemanticsNodes().isEmpty() }
                compose.onNodeWithTag("diary-sync-status").assertTextEquals(copy.getString("localOnly"))
                closeDialog("diary-settings-dialog")
                notice("drawer-diary-local-only", copy.getString("localOnly")); closeDrawer()
                runBlocking { repository.setSyncEnabled(true) }
                compose.waitUntil(20_000) { repository.state.value.syncEnabled }
                assertTrue("$prefix: authored note survives every locale/status", repository.state.value.records.single().note.sameContent(note))
                assertFalse(store.ciphertext!!.contains(note.title)); assertFalse(store.ciphertext!!.contains(note.body))
                state("recovered-board")
                completed += prefix
                println("GENESIS_DIARY_LOCALE_CHECKED=$prefix")
            }
            assertEquals(languages.size * 2, completed.size)
        } catch (cause: Throwable) { failure = cause; throw cause }
        finally {
            gateway.readGate?.complete(Unit); gateway.readGate = null
            File(context.getExternalFilesDir(null), "diary-locales-360-font1.3-proof.json").writeText(JSONObject()
                .put("widthDp", 360).put("fontScale", 1.3).put("completed", JSONArray(completed)).put("states", states)
                .put("requestedLanguage", requestedLanguage ?: JSONObject.NULL).put("allLocalesRequested", requestedLanguage == null)
                .put("lastCheckpoint", checkpoint).put("failure", failure?.stackTraceToString() ?: JSONObject.NULL).toString(2))
        }
    }

    @Test fun palettePresetsAreEqualAndCustomColorAppliesOnlyOnConfirmation() {
        compose.setContent { Content() }; await("diary-create")
        compose.onNodeWithTag("diary-create").performClick(); await("diary-editor")
        compose.onNodeWithTag("diary-body").performTextReplacement("Проверка собственной палитры")
        capture("preset-options", "diary-editor")
        val swatches = DiaryNote.colors.map { color -> compose.onNodeWithTag("diary-color-$color").performScrollTo()
            .assertHeightIsAtLeast(48.dp).fetchSemanticsNode().size }
        assertTrue("Preset layout sizes must match, independently of scroll clipping: $swatches",
            swatches.all { kotlin.math.abs(it.width - swatches.first().width) <= 1 && it.height == swatches.first().height })
        compose.onNodeWithTag("diary-color-custom").performScrollTo().performClick(); await("diary-color-picker")
        compose.onNodeWithTag("diary-swatch-#bb704b").performScrollTo().performClick()
        compose.onNode(hasText("Отмена") and hasAnyAncestor(hasTestTag("diary-color-picker")),
            useUnmergedTree = true).performClick()
        compose.onNodeWithTag("diary-color-sage").assertIsSelected()
        compose.onNodeWithTag("diary-color-custom").performScrollTo().performClick(); await("diary-color-picker")
        compose.onNodeWithTag("diary-swatch-#bb704b").performScrollTo().performClick()
        capture("custom-palette", "diary-color-picker")
        compose.onNodeWithTag("diary-color-apply").performClick()
        compose.onNodeWithTag("diary-color-custom").assertIsSelected()
        capture("custom-color-editor", "diary-editor")
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft && it.note.customColor == "#bb704b" } }
        val record = repository.state.value.records.single { !it.draft }
        compose.onNodeWithTag("diary-open-${record.note.id}").performScrollTo().performClick(); await("diary-editor")
        compose.onNodeWithTag("diary-color-custom").performScrollTo().assertIsSelected()
    }

    @Test fun failedLocalDraftDoesNotPromiseDurabilityAndCanBeRetried() {
        compose.setContent { Content() }; await("diary-create")
        val title = compose.onNodeWithTag("workspace-title").fetchSemanticsNode().boundsInRoot
        val create = compose.onNodeWithTag("diary-create").fetchSemanticsNode().boundsInRoot
        val actions = compose.onNodeWithTag("diary-actions").fetchSemanticsNode().boundsInRoot
        val calendar = compose.onNodeWithTag("calendar-mode-icon-profane").fetchSemanticsNode().boundsInRoot
        assertTrue(title.right <= create.left && create.right <= actions.left && actions.right <= calendar.left)
        compose.onNodeWithTag("diary-create").performClick(); await("diary-editor")
        store.failWrites = true
        compose.onNodeWithTag("diary-body").performTextReplacement("Текст должен остаться в форме при ошибке устройства")
        await("diary-editor-error")
        compose.onNodeWithTag("diary-editor-error").performScrollTo()
            .assertTextContains("Введённые данные остаются в форме.", substring = true)
        compose.onNodeWithContentDescription("Закрыть").performClick()
        compose.onNodeWithContentDescription("Сохранить черновик").performClick()
        compose.onNodeWithTag("diary-close-error").assertIsDisplayed()
        capture("local-storage-error", "diary-close-error")
        store.failWrites = false
        compose.onNodeWithContentDescription("Сохранить черновик").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { it.draft } }
        compose.onNodeWithTag("diary-editor").assertDoesNotExist()
    }

    @Test fun noteSaveRemainsVisibleWithKeyboardAndLongText() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = androidx.test.uiautomator.UiDevice.getInstance(instrumentation)
        val proof = File(compose.activity.getExternalFilesDir(null), "diary-long-note-ime-proof.json")
        val stages = JSONArray()
        var failure: Throwable? = null
        fun stage(name: String, cause: Throwable? = null) {
            stages.put(JSONObject().put("stage", name).put("uptimeMs", android.os.SystemClock.uptimeMillis())
                .put("savedNotes", repository.state.value.records.count { !it.draft })
                .put("failure", cause?.stackTraceToString() ?: JSONObject.NULL))
            proof.writeText(JSONObject().put("widthDp", width).put("dark", dark).put("stages", stages).toString(2))
            println("GENESIS_DIARY_IME_PHASE=$name")
        }
        try {
            stage("open")
            compose.setContent { Content() }; await("diary-create")
            compose.onNodeWithTag("diary-create").performClick(); await("diary-editor")
            stage("show-system-ime")
            compose.onNodeWithTag("diary-body").performClick().assertIsFocused()
            compose.waitUntil(10_000) { device.executeShellCommand("dumpsys input_method").contains("mInputShown=true") }
            stage("long-note")
            compose.onNodeWithTag("diary-body").performTextReplacement("Длинный текст записи. ".repeat(100))
            compose.onNodeWithTag("diary-body").assertTextContains("Длинный текст записи.", substring = true)
            compose.onNodeWithTag("diary-save").assertIsDisplayed().assertIsEnabled()
            capture("keyboard", "diary-editor")
            val close = requireNotNull(device.findObject(androidx.test.uiautomator.By.desc("Закрыть").pkg(compose.activity.packageName))) {
                "Close remains accessible with a long note and IME"
            }
            val statusBarHeight = compose.runOnIdle {
                requireNotNull(androidx.core.view.ViewCompat.getRootWindowInsets(compose.activity.window.decorView))
                    .getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top
            }
            val closeBounds = close.visibleBounds
            assertTrue("Close bounds=$closeBounds must stay below status bar=$statusBarHeight", closeBounds.top >= statusBarHeight)
            stage("save-with-ime")
            compose.onNodeWithTag("diary-save").performClick()
            compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft } }
            assertTrue(repository.state.value.records.single { !it.draft }.note.body.length > 1000)
            stage("wait-editor-disposal")
            compose.waitUntil(20_000) { compose.onAllNodesWithTag("diary-editor").fetchSemanticsNodes().isEmpty() }
            val saved = repository.state.value.records.single { !it.draft }
            await("diary-note-${saved.note.id}")
            compose.onNodeWithTag("diary-note-${saved.note.id}").assertIsDisplayed()
            compose.onNodeWithTag("diary-editor").assertDoesNotExist()
            stage("body-assertions-passed")
        } catch (cause: Throwable) {
            failure = cause
            // Preserve the body failure even if ActivityScenario.after later reports a lifecycle timeout.
            try { stage("body-failure", cause) } catch (capture: Throwable) { cause.addSuppressed(capture) }
            throw cause
        } finally {
            try {
                stage("ime-cleanup-started")
                if (device.executeShellCommand("dumpsys input_method").contains("mInputShown=true")) device.pressBack()
                // Do not re-enter Compose after a failed body. Its first error and phase stay available above.
                if (failure == null) compose.waitUntil(10_000) {
                    !device.executeShellCommand("dumpsys input_method").contains("mInputShown=true")
                }
                stage("ime-cleanup-finished")
            } catch (cleanup: Throwable) {
                if (failure != null) failure.addSuppressed(cleanup) else throw cleanup
            }
        }
    }
    @Test fun createEditSearchPinArchiveAndRestorePersistEncryptedNotes() {
        compose.setContent { Content() }; await("diary-create")
        compose.onNodeWithTag("diary-create").performClick(); await("diary-editor")
        compose.onNodeWithTag("diary-title").performTextReplacement("Личная мысль — день 1")
        compose.onNodeWithTag("diary-body").performTextReplacement("Исходная личная заметка. Не переводить этот текст.")
        compose.onNodeWithTag("diary-body").assertTextContains("Исходная личная заметка.", substring = true)
        capture("editor", "diary-editor")
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft } }
        val id = repository.state.value.records.first { !it.draft }.note.id
        await("diary-note-$id"); capture("board")
        compose.onNodeWithTag("diary-tab-board").assertDoesNotExist()
        compose.onNodeWithTag("diary-tab-favorites").assertDoesNotExist()
        compose.onNodeWithTag("diary-actions").performClick()
        compose.onNodeWithTag("diary-favorites-open").performClick()
        compose.onNodeWithTag("diary-note-$id").assertDoesNotExist()
        compose.onNodeWithText("Избранных советов пока нет.").assertExists()
        val back = compose.onNodeWithTag("diary-back-to-board").assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp)
            .fetchSemanticsNode().boundsInRoot
        val title = compose.onNodeWithTag("workspace-title").fetchSemanticsNode().boundsInRoot
        assertTrue("Back is before the page title", back.right <= title.left)
        capture("favorites")
        compose.onNodeWithTag("diary-back-to-board").performClick()
        compose.onNodeWithTag("diary-back-to-board").assertDoesNotExist()
        await("diary-note-$id")
        assertFalse(store.ciphertext!!.contains("Личная мысль"))
        compose.onNodeWithTag("diary-notes").performScrollToNode(hasTestTag("diary-pin-$id"))
        compose.onNodeWithTag("diary-pin-$id").performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft && it.note.pinned } }
        compose.onNodeWithTag("diary-notes").performScrollToNode(hasTestTag("diary-open-$id"))
        compose.onNodeWithTag("diary-open-$id").performScrollTo().assertIsDisplayed().performClick(); await("diary-body")
        compose.onNodeWithTag("diary-body").performTextReplacement("Отредактированный текст сохранён")
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft && it.note.body == "Отредактированный текст сохранён" } }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("diary-editor").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("diary-search-open").performClick(); await("diary-search")
        val search = compose.onNodeWithTag("diary-search").fetchSemanticsNode().boundsInRoot
        val closeSearch = compose.onNodeWithTag("diary-search-close").fetchSemanticsNode().boundsInRoot
        org.junit.Assert.assertEquals("Diary search controls share a vertical center", search.center.y, closeSearch.center.y, 1f)
        assertTrue(search.right <= closeSearch.left)
        compose.onNodeWithTag("diary-search-close").assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
        capture("search")
        compose.onNodeWithTag("diary-search").performTextReplacement("нет такой записи")
        compose.onNodeWithTag("diary-note-$id").assertDoesNotExist()
        compose.onNodeWithTag("diary-search").performTextClearance()
        compose.dismissValidationKeyboard()
        compose.onNodeWithTag("diary-search-close").assertIsDisplayed().performClick()
        compose.onNodeWithTag("diary-notes").performScrollToNode(hasTestTag("diary-archive-$id"))
        compose.onNodeWithTag("diary-archive-$id").performScrollTo().assertIsDisplayed()
        capture("before-archive")
        compose.onNodeWithTag("diary-archive-$id").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft && it.note.archived } }
        compose.onNodeWithContentDescription("Действия дневника").performClick(); compose.onNodeWithText("Архив").performClick()
        compose.onNodeWithTag("diary-notes").performScrollToNode(hasTestTag("diary-archive-$id")); capture("archive")
        compose.onNodeWithTag("diary-archive-$id").performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { !it.draft && !it.note.archived } }
        compose.onNodeWithTag("diary-back-to-board").performClick(); await("diary-note-$id")
        val reopened = DiaryRepository("diary-ui-fixture", gateway, store, DiaryKeystoreCipher("diary-ui-fixture", "diary-ui-fixture"))
        runBlocking { reopened.loadCached() }
        assertEquals("Отредактированный текст сохранён", reopened.state.value.records.single { !it.draft }.note.body)
    }
    @Test fun encryptedEditorRestoresAndDirtyExitKeepsRecoverableDraft() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Content() }; await("diary-create")
        compose.onNodeWithTag("diary-create").performClick(); await("diary-editor")
        compose.onNodeWithTag("diary-title").performTextReplacement("Незаконченная мысль")
        compose.onNodeWithTag("diary-body").performTextReplacement("Текст до поворота экрана")
        restoration.emulateSavedInstanceStateRestore(); await("diary-body")
        compose.onNodeWithTag("diary-body").assertTextContains("Текст до поворота экрана")
        compose.onNodeWithContentDescription("Закрыть").performClick(); compose.onNodeWithContentDescription("Сохранить черновик").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.any { it.draft } }
        val row = repository.state.value.records.single { it.draft }
        assertEquals("Текст до поворота экрана", row.note.body)
        assertTrue(gateway.rows.isEmpty()); assertFalse(store.ciphertext!!.contains("Текст до поворота"))
    }
    @Test fun staleEditOffersCopyAndPreservesOtherDeviceVersion() {
        val note = DiaryNote.create("Первоначальный текст", "Общая заметка")
        runBlocking { repository.save(note) }
        compose.setContent { Content() }; await("diary-open-${note.id}")
        compose.onNodeWithTag("diary-open-${note.id}").performClick(); await("diary-body")
        compose.onNodeWithTag("diary-body").performTextReplacement("Моя несохранённая версия")
        runBlocking { gateway.request("/diary/${note.id}", DiaryProtocol.seal("diary-ui-fixture", note.changed { put("body", "Текст другого устройства") }, 1, gateway.key)) }
        compose.onNodeWithTag("diary-save").performClick(); await("diary-editor-error")
        compose.onNodeWithText("Сохранить копию").assertExists(); capture("conflict", "diary-editor")
        compose.onNodeWithTag("diary-save").performClick()
        compose.waitUntil(20_000) { repository.state.value.records.count { !it.draft } == 2 }
        runBlocking { repository.refresh() }
        assertEquals(setOf("Моя несохранённая версия", "Текст другого устройства"), repository.state.value.records.filterNot { it.draft }.map { it.note.body }.toSet())
    }
    @Test fun roomEntryPointsShareOneJournalAndPersistOnlyCiphertext() {
        val database = androidx.room.Room.inMemoryDatabaseBuilder(compose.activity, GenesisDatabase::class.java).build()
        try {
            val one = DiaryRepository.room(database, "diary-room-fixture", "diary-ui-fixture", gateway)
            val two = DiaryRepository.room(database, "diary-room-fixture", "diary-ui-fixture", gateway)
            assertSame(one, two)
            runBlocking {
                one.keepDraft(DiaryNote.create("Never plaintext in Room or WAL", "Private Room fixture"))
                val row = database.dao().document("diary-room-fixture", "diary-v1")
                assertNotNull(row); assertFalse(row!!.encrypted.contains("Never plaintext"))
                assertTrue(two.state.value.records.single().draft)
            }
        } finally { database.close() }
    }

}
