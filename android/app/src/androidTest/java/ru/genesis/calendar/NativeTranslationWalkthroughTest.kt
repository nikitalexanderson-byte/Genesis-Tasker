package ru.genesis.calendar

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.SacredCatalog
import ru.genesis.calendar.ui.*

/** Actual mobile routes in the isolated QA package; no account data or remote writes. */
class NativeTranslationWalkthroughTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    // CJK copy can directly adjoin a literal Cyrillic user field without a word separator.
    private fun userFieldPattern(value: String) =
        Regex("(?<![\\u0400-\\u052F\\u2DE0-\\u2DFF\\uA640-\\uA69F\\p{N}])${Regex.escape(value)}(?![\\u0400-\\u052F\\u2DE0-\\u2DFF\\uA640-\\uA69F\\p{N}])")

    @Test fun weekdayPatronDetailsUseCompleteLocalizedParagraphs() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val calendar = ru.genesis.calendar.domain.GenesisCalendar()
        for (language in listOf("en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            for (weekday in 0..6) {
                val copy = todayHeroCopy(LocalDate.of(2026, 10, 25).plusDays(weekday.toLong()),
                    ru.genesis.calendar.domain.CalendarMode.PROFANE, calendar)
                val source = copy.details.last()
                val body = source.removePrefix("Части тела: ")
                val translatedBody = translateGenesisText(app, body, language)
                assertTrue("$language/$weekday must have the complete paragraph", translatedBody != body)
                assertEquals("$language/$weekday must compose the translated label and paragraph",
                    "${translateGenesisText(app, "Части тела:", language)} $translatedBody",
                    translateGenesisText(app, source, language))
            }
        }
    }

    @Test fun dynamicCopyKeepsUserTitlesAndLocaleDatesLiteral() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val userField = "Задача между проектами"
        val userPattern = userFieldPattern(userField)
        assertEquals("Chinese hint excludes only the literal user field", "长按任务 并将其拖入项目",
            "长按任务${userField}并将其拖入项目".replace(userPattern, " "))
        assertFalse("An extra Cyrillic prefix must remain audited",
            userPattern.containsMatchIn("长按任务Лишнее${userField}并将其拖入项目"))
        assertFalse("An extra Cyrillic suffix must remain audited",
            userPattern.containsMatchIn("长按任务${userField}Лишнее并将其拖入项目"))
        assertEquals("Surrounding Russian UI must remain audited", "Нажмите   для переноса",
            "Нажмите $userField для переноса".replace(userPattern, " "))
        val catalog = JSONObject(app.assets.open("originals/i18n/native-mobile-design-translations.json")
            .bufferedReader().use { it.readText() })
        val refinements = JSONObject(app.assets.open("originals/i18n/ui-refinement-copy.json")
            .bufferedReader().use { it.readText() })
        val dayIndex = 210
        val day = SacredCatalog.months.flatMap { it.days }[dayIndex]
        val userTitle = "Задача {title} и проект\nМосква"
        val habitTitle = "Привычка {title} $1 \\ [Москва].*\nМосква"
        val date = LocalDate.of(2026, 10, 16)
        for (language in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            val copy = catalog.getJSONObject(language)
            fun expected(key: String, vararg values: Pair<String, String>): String =
                values.fold(copy.getString(key)) { result, (name, value) -> result.replace("{$name}", value) }
            fun assertTranslation(source: String, translated: String) =
                assertEquals("$language: $source", translated, translateGenesisText(app, source, language))
            for (prefix in listOf("", "☾ Длительность · ", "Длительность: ")) {
                val template = refinements.getJSONObject(language).getString("${prefix}{hours} ч {minutes} мин")
                for ((hours, minutes) in listOf(8 to 0, 0 to 45, 12 to 30)) {
                    assertTranslation("$prefix$hours ч $minutes мин",
                        template.replace("{hours}", hours.toString()).replace("{minutes}", minutes.toString()))
                }
            }
            assertTranslation("Новая привычка", copy.getString("Новая привычка"))
            assertTranslation("Разделы и действия привычек", copy.getString("Разделы и действия привычек"))
            for (completed in listOf(false, true)) {
                val key = if (completed) "{title}: снять отметку" else "{title}: отметить выполнение"
                assertEquals("$language: habit completion=$completed preserves the literal title",
                    expected(key, "title" to habitTitle), habitCompletionDescription(app, language, habitTitle, completed))
            }
            assertEquals("$language: habit timer preserves the literal title",
                expected("Таймер привычки {title}", "title" to habitTitle), habitTimerDescription(app, language, habitTitle))
            for (phase in listOf("Новолуние", "Молодой серп", "Первая четверть", "Растущая луна",
                "Полнолуние", "Убывающая луна", "Последняя четверть", "Старый серп"))
                assertTranslation(phase, copy.getString(phase))
            assertTranslation("Удерживайте задачу $userTitle и перетащите в проект",
                expected("Удерживайте задачу {title} и перетащите в проект", "title" to userTitle))
            assertTranslation("Удерживайте «$userTitle» и перетащите в проект",
                expected("Удерживайте «{title}» и перетащите в проект", "title" to userTitle))
            for (status in listOf("достигнута", "впереди")) assertTranslation("Дневная цель: 2 · $status",
                expected("Дневная цель: {count} · {status}", "count" to "2", "status" to copy.getString(status)))
            for (scheme in listOf("Светлая", "Тёмная")) assertTranslation("$scheme схема с 07:00",
                expected("$scheme схема с {time}", "time" to "07:00"))
            val cardName = when (language) { "ru", "sr" -> "Алфа"; "uk" -> "Альфа"; else -> "Alpha" }
            assertTranslation("Живописная основа карты $cardName",
                expected("Живописная основа карты {name}", "name" to cardName))
            val locale = Locale.forLanguageTag(language)
            val civilDate = date.format(DateTimeFormatter.ofPattern("d MMM uuuu", locale))
            assertTranslation("7 задач на $civilDate. Открыть список.",
                expected("{count} задач на {date}. Открыть список.", "count" to "7", "date" to civilDate))
            val localizedName = if (language == "ru") day.name else JSONArray(app.assets
                .open("originals/i18n/calendar-days.$language.json").bufferedReader().use { it.readText() })
                .getJSONObject(dayIndex).getString("name")
            val moonDay = expected("{day} лунный день", "day" to "7")
            val count = expected("{count} задач", "count" to "7")
            val phase = copy.getString("Первая четверть")
            assertTranslation("1 · ${day.name} · $civilDate · 7 лунный день · Первая четверть, 32% · 7 задач",
                "1 · $localizedName · $civilDate · $moonDay · $phase, 32% · $count")
            assertTranslation("16 · 2026-10-16 · $civilDate · 7 лунный день · Первая четверть, 32% · 7 задач",
                "16 · 2026-10-16 · $civilDate · $moonDay · $phase, 32% · $count")
            val weekday = date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale).removeSuffix(".")
            assertTranslation("7 лунный день · Первая четверть · $civilDate · $weekday",
                "$moonDay · $phase · $civilDate · $weekday")
        }
    }

    @Test fun visitMainScreensInEverySupportedLanguage() {
        val activity = compose.activity
        val app = activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { prefs.values.first() }
        val languages = listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        val nativeNames = setOf("Русский", "Српски", "Українська")
        val cyrillic = Regex("[А-Яа-яЁё]")
        val findings = linkedSetOf<String>()
        val wordFindings = linkedSetOf<String>()
        val layouts = ConcurrentHashMap<String, Boolean>()
        val states = JSONArray()
        val completedLanguages = mutableListOf<String>()
        var checkpoint = "setup"
        var failure: Throwable? = null
        val ignoredUserCopy = linkedSetOf<String>()
        // Exact catalog-reviewed phrases contain shared Cyrillic words or a proper name also found in Russian.
        val reviewedLocalizedCopy = mapOf(
            "sr" to setOf("Запад · Воде Психе, Посејдон и Амфитрита", "Посејдон и Амфитрита"),
            "uk" to setOf("Перенести на сьогодні", "IP-адреса", "Завершено сьогодні"))
        val acceptedLocalizedCopy = linkedSetOf<String>()
        // Only values read from user-authored fields are exempt. Surrounding UI labels remain audited.
        val userCopy = runBlocking {
            buildSet {
                app.repository.tasks.first().forEach { add(it.title); add(it.description); add(it.project) }
                WorkspaceStructureRepository(app).workspace.first().let { structure ->
                    structure.projects.forEach { add(it.title); add(it.description); addAll(it.tags) }
                    structure.categories.forEach { add(it.name) }
                    structure.taskLists.forEach { add(it.title) }
                }
                HabitsRepository(app).workspace.first().habits.forEach { add(it.title); add(it.description); add(it.ritualName) }
                TrackersRepository(app).workspace.first().let { trackers ->
                    trackers.sleepPlans.forEach { add(it.title) }
                    trackers.addictionTrackers.forEach { add(it.trackedBehavior); add(it.description) }
                }
                add(original.ipRegionLabel)
            }.filter { it.length >= 3 && cyrillic.containsMatchIn(it) }.sortedByDescending { it.length }
        }
        val userPatterns = userCopy.map { value -> value to userFieldPattern(value) }
        val russianSources = buildSet {
            for (file in listOf("translations.en.json", "ui-translations/en.json", "shared-work-translations/en.json",
                "curated-translations.en.json", "year-translations/en.json")) {
                JSONObject(app.assets.open("originals/i18n/$file").bufferedReader().use { it.readText() })
                    .keys().forEach { if (it.length >= 8 && cyrillic.containsMatchIn(it)) add(it) }
            }
        }.sortedByDescending { it.length }
        fun withoutUserCopy(value: String): String {
            var remaining = value
            userPatterns.forEach { (userText, pattern) ->
                if (pattern.containsMatchIn(remaining)) {
                    ignoredUserCopy += userText
                    remaining = remaining.replace(pattern, " ")
                }
            }
            return remaining.trim()
        }
        fun descendants(node: SemanticsNode): List<SemanticsNode> = listOf(node) + node.children.flatMap(::descendants)
        fun activeNodes(): List<SemanticsNode> {
            val root = compose.onAllNodes(isRoot(), useUnmergedTree = true).onLast().fetchSemanticsNode()
            val viewport = root.boundsInRoot
            return descendants(root).filter { it.boundsInRoot.width > 0 && it.boundsInRoot.height > 0 &&
                it.boundsInRoot.overlaps(viewport) }
        }
        fun scan(language: String, state: String) {
            checkpoint = "$language/$state"
            compose.waitForIdle()
            val text = activeNodes().flatMap { node ->
                node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } +
                    node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
                    listOfNotNull(node.config.getOrNull(SemanticsProperties.EditableText)?.text,
                        node.config.getOrNull(SemanticsProperties.StateDescription),
                        node.config.getOrNull(SemanticsProperties.PaneTitle))
            }.filter(String::isNotBlank).distinct()
            if (language != "ru") text.forEach { value ->
                if (value.trim() in nativeNames) return@forEach
                val remaining = withoutUserCopy(value)
                if (remaining in reviewedLocalizedCopy[language].orEmpty()) {
                    acceptedLocalizedCopy += "$language: $remaining"
                    return@forEach
                }
                if (!cyrillic.containsMatchIn(remaining)) return@forEach
                val russian = when (language) {
                    "sr" -> Regex("[ЁёЙйЩщЪъЫыЬьЭэЮюЯя]").containsMatchIn(remaining)
                    "uk" -> Regex("[ЁёЪъЫыЭэ]").containsMatchIn(remaining)
                    else -> true
                } || russianSources.any { source -> remaining.contains(source) &&
                    translateGenesisText(app, source, language) != source }
                if (russian) findings += "$language/$state: $remaining"
            }
            layouts.filterValues { it }.keys.forEach { wordFindings += "$language/$state: $it" }
            states.put(JSONObject().put("language", language).put("state", state).put("visibleStrings", text.size))
        }
        fun scanPage(language: String, state: String) {
            compose.waitForIdle()
            val viewport = activeNodes().filter { node ->
                node.config.getOrNull(SemanticsProperties.VerticalScrollAxisRange) != null &&
                    node.config.contains(SemanticsActions.ScrollBy)
            }.maxByOrNull { it.boundsInRoot.height }
            if (viewport == null) { scan(language, state); return }
            val scroll = compose.onNode(SemanticsMatcher("current vertical viewport ${viewport.id}") { it.id == viewport.id },
                useUnmergedTree = true)
            scroll.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, -1_000_000f) }
            for (page in 0 until 30) {
                scan(language, "$state/$page")
                val before = scroll.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
                scroll.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, viewport.boundsInRoot.height * .8f) }
                compose.waitForIdle()
                val after = scroll.fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
                if (after == before) {
                    scroll.performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, -1_000_000f) }
                    compose.waitForIdle()
                    return
                }
            }
            findings += "$language/$state: vertical traversal did not reach the end in 30 viewports"
        }
        try {
            compose.runOnUiThread {
                activity.textLayoutObserver = { text, layout -> layouts[text] = layout.splitsWord() }
            }
            runBlocking { prefs.set("display", "sacred"); prefs.set("stoicheionDivinationDisabled", "false") }
            for (language in languages) {
                checkpoint = "$language/drawer-entry"
                layouts.clear()
                runBlocking { prefs.set("language", language) }
                compose.waitForIdle()
                // Confirm that the shell has consumed the locale before scanning its routes.
                compose.onNodeWithTag("workspace-menu").performClick()
                compose.onNodeWithTag("drawer-Сегодня-root").performScrollTo()
                val expectedToday = translateGenesisText(app, "Сегодня", language)
                compose.waitUntil(5_000) {
                    compose.onNodeWithTag("drawer-Сегодня-root").fetchSemanticsNode().config
                        .getOrNull(SemanticsProperties.ContentDescription).orEmpty().contains(expectedToday)
                }
                scan(language, "drawer")
                fun visit(page: String, section: String? = null, state: String = page) {
                    checkpoint = "$language/$state/entry"
                    layouts.clear()
                    compose.openWorkspacePage(page, section)
                    scanPage(language, state)
                }
                visit("Сегодня")
                visit("Проекты", state = "affairs/personal")
                visit("Календарь", "month", "calendar/month")
                visit("Календарь", "year", "calendar/year")
                visit("Привычки", "Привычки", "habits")
                visit("Привычки", "Сон и настроение", "trackers")
                visit("Сакральное", "stoicheion", "oracle/stoicheion")
                visit("Сакральное", "theokyklos", "oracle/theokyklos")
                for (section in listOf("appearance", "habits", "reminders", "shared", "region", "account", "links"))
                    visit("Настройки", section, "settings/$section")
                visit("Настройки", "appearance", "settings/appearance/reference-entry")
                checkpoint = "$language/calendar/reference-sacred/entry"
                compose.onNodeWithTag("calendar-reference-sacred").performScrollTo().performClick()
                layouts.clear()
                scanPage(language, "calendar/reference-sacred")
                checkpoint = "$language/calendar/reference-sacred/close"
                compose.onNodeWithTag("calendar-reference-close").performClick()
                completedLanguages += language
                println("GENESIS_NATIVE_LOCALE_CHECKED=$language")
            }
            assertEquals("Every supported language completed", languages, completedLanguages)
            assertTrue("Russian interface remnants:\n${findings.joinToString("\n")}", findings.isEmpty())
            assertTrue("Words split across lines:\n${wordFindings.joinToString("\n")}", wordFindings.isEmpty())
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            compose.runOnUiThread { activity.textLayoutObserver = null }
            runBlocking {
                prefs.set("language", original.language)
                prefs.set("display", original.display.wireValue)
                prefs.set("stoicheionDivinationDisabled", original.divinationDisabled.toString())
            }
            File(app.getExternalFilesDir(null), "translation-walkthrough-313.json").writeText(JSONObject()
                .put("states", states).put("russianFindings", JSONArray(findings.toList()))
                .put("completedLanguages", JSONArray(completedLanguages))
                .put("traversalComplete", completedLanguages == languages)
                .put("lastCheckpoint", checkpoint)
                .put("failure", failure?.let { JSONObject().put("type", it.javaClass.name)
                    .put("message", it.message).put("stackTrace", it.stackTraceToString()) } ?: JSONObject.NULL)
                .put("wordSplitFindings", JSONArray(wordFindings.toList()))
                .put("excludedSyntheticUserStrings", JSONArray(ignoredUserCopy.toList()))
                .put("reviewedLocalizedCyrillicStrings", JSONArray(acceptedLocalizedCopy.toList()))
                .put("cyrillicLocaleAudit", "Russian-only letters and known Russian source phrases; shared Cyrillic words are not language proof.")
                .toString(2))
        }
    }
}
