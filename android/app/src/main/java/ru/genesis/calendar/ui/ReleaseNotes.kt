package ru.genesis.calendar.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import ru.genesis.calendar.ui.AlertDialog
import androidx.compose.material3.MaterialTheme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.ui.Text

internal data class Notes(val title: String, val close: String, val changes: List<String>)

internal val notes = mapOf(
    "ru" to Notes("Что нового", "Понятно", listOf(
        "Моделирование по шагам: пояснения и примеры у каждого вопроса, уточнения по ответам и безопасные варианты действий.",
        "Более разнообразные священные слова с новыми правилами ритма и пропорций.",
        "Исправлены окна, размеры кнопок и выбор ветки в майндмэпах.",
        "Обновлены светлые палитры, блоки календаря и погоды.",
        "Новые детальные панорамы природы для смартфона и большого экрана.")),
    "en" to Notes("What’s new", "Got it", listOf(
        "Step-by-step modelling: explanations and examples for every question, adaptive follow-ups and safe action options.",
        "More varied sacred words with new rhythm and proportion rules.",
        "Refined dialogs, button sizes and named branch selection in mind maps.",
        "Updated light palettes, calendar and weather panels.",
        "New detailed nature panoramas for phones and large screens.")),
    "el" to Notes("Τι νέο υπάρχει", "Κατάλαβα", listOf(
        "Μοντελοποίηση βήμα προς βήμα: εξηγήσεις και παραδείγματα σε κάθε ερώτηση, προσαρμοστικές διευκρινίσεις και ασφαλείς επιλογές δράσης.",
        "Πιο ποικίλες ιερές λέξεις με νέους κανόνες ρυθμού και αναλογιών.",
        "Βελτιωμένα παράθυρα, κουμπιά και επιλογή κλάδου με όνομα στους χάρτες σκέψης.",
        "Ανανεωμένες φωτεινές παλέτες, ημερολόγιο και καιρός.",
        "Νέα λεπτομερή πανοράματα φύσης για κινητά και μεγάλες οθόνες.")),
    "de" to Notes("Was ist neu", "Verstanden", listOf(
        "Schrittweise Modellierung: Erklärungen und Beispiele zu jeder Frage, passende Rückfragen und sichere Handlungsoptionen.",
        "Vielfältigere heilige Wörter mit neuen Rhythmus- und Proportionsregeln.",
        "Überarbeitete Dialoge, Schaltflächen und benannte Zweigauswahl in Mindmaps.",
        "Aktualisierte helle Paletten, Kalender- und Wetterfelder.",
        "Neue detaillierte Naturpanoramen für Smartphones und große Bildschirme.")),
    "fr" to Notes("Nouveautés", "Compris", listOf(
        "Modélisation pas à pas : explications et exemples à chaque question, précisions adaptées et actions sûres.",
        "Mots sacrés plus variés avec de nouvelles règles de rythme et de proportions.",
        "Fenêtres, dimensions des boutons et sélection des branches par leur nom améliorées.",
        "Palettes claires, calendrier et météo retravaillés.",
        "Nouveaux panoramas naturels détaillés pour mobiles et grands écrans.")),
    "es" to Notes("Novedades", "Entendido", listOf(
        "Modelado paso a paso: explicaciones y ejemplos en cada pregunta, aclaraciones adaptadas y acciones seguras.",
        "Palabras sagradas más variadas con nuevas reglas de ritmo y proporción.",
        "Mejoras en ventanas, tamaño de botones y selección de ramas por nombre.",
        "Paletas claras y paneles de calendario y tiempo renovados.",
        "Nuevas panorámicas naturales detalladas para móviles y pantallas grandes.")),
    "it" to Notes("Novità", "Ho capito", listOf(
        "Modellazione guidata: spiegazioni ed esempi per ogni domanda, approfondimenti adattivi e azioni sicure.",
        "Parole sacre più varie con nuove regole di ritmo e proporzioni.",
        "Finestre, dimensioni dei pulsanti e scelta dei rami per nome migliorate.",
        "Palette chiare e pannelli di calendario e meteo aggiornati.",
        "Nuovi panorami naturali dettagliati per telefoni e grandi schermi.")),
    "pt" to Notes("Novidades", "Entendi", listOf(
        "Modelação por etapas: explicações e exemplos em cada pergunta, esclarecimentos adaptados e ações seguras.",
        "Palavras sagradas mais variadas com novas regras de ritmo e proporção.",
        "Melhorias nas janelas, dimensões dos botões e seleção de ramos pelo nome.",
        "Paletas claras e painéis de calendário e meteorologia renovados.",
        "Novos panoramas naturais detalhados para telemóveis e ecrãs grandes.")),
    "pl" to Notes("Co nowego", "Rozumiem", listOf(
        "Modelowanie krok po kroku: objaśnienia i przykłady przy każdym pytaniu, dopasowane pytania uzupełniające i bezpieczne działania.",
        "Bardziej zróżnicowane święte słowa z nowymi zasadami rytmu i proporcji.",
        "Poprawione okna, rozmiary przycisków i wybór gałęzi według nazwy.",
        "Odświeżone jasne palety oraz panele kalendarza i pogody.",
        "Nowe szczegółowe panoramy przyrody na telefony i duże ekrany.")),
    "sr" to Notes("Шта је ново", "Разумем", listOf(
        "Моделовање корак по корак: објашњења и примери уз свако питање, прилагођена потпитања и безбедни поступци.",
        "Разноврсније свете речи са новим правилима ритма и пропорција.",
        "Исправљени прозори, величине дугмади и избор гране по називу.",
        "Дорађене светле палете, календар и временски подаци.",
        "Нове детаљне панораме природе за телефоне и велике екране.")),
    "uk" to Notes("Що нового", "Зрозуміло", listOf(
        "Моделювання крок за кроком: пояснення й приклади до кожного запитання, адаптивні уточнення та безпечні варіанти дій.",
        "Різноманітніші священні слова з новими правилами ритму й пропорцій.",
        "Виправлено вікна, розміри кнопок і вибір гілки за назвою в мапах думок.",
        "Оновлено світлі палітри, блоки календаря й погоди.",
        "Нові детальні панорами природи для смартфонів і великих екранів.")),
    "zh" to Notes("本次更新", "知道了", listOf(
        "逐步建模：每个问题都有说明和示例，并根据回答提出后续问题及安全行动选项。",
        "神圣词语的声音更加多样，采用新的节奏与比例规则。",
        "改进弹窗、按钮尺寸和思维导图中的分支名称选择。",
        "更新浅色配色、日历和天气面板。",
        "为手机和大屏幕重新制作了细节丰富的自然全景图。")),
    "tr" to Notes("Yenilikler", "Anladım", listOf(
        "Adım adım modelleme: her soru için açıklama ve örnekler, yanıtlara uygun ek sorular ve güvenli eylem seçenekleri.",
        "Yeni ritim ve oran kurallarıyla daha çeşitli kutsal sözcükler.",
        "Pencereler, düğme boyutları ve zihin haritalarında adla dal seçimi iyileştirildi.",
        "Açık paletler, takvim ve hava durumu panelleri yenilendi.",
        "Telefonlar ve büyük ekranlar için yeni, ayrıntılı doğa panoramaları.")),
    "ja" to Notes("今回の更新", "了解", listOf(
        "段階的なモデリング：すべての質問に説明と例を追加し、回答に応じた追加質問と安全な行動案を提示。",
        "リズムと比率の新しい規則により、聖なる言葉の響きを多様化。",
        "ダイアログ、ボタンの寸法、マインドマップの名前による枝の選択を改善。",
        "ライト配色、カレンダーと天気のパネルを更新。",
        "スマートフォンと大画面向けに、精細な自然のパノラマを新しく制作。"))
)

@Composable
internal fun releaseNotesTitle(): String = notes[LocalGenesisLanguage.current]?.title ?: notes.getValue("ru").title

@Composable
internal fun ReleaseNotesDialog(onDismiss: () -> Unit) {
    val copy = notes[LocalGenesisLanguage.current] ?: notes.getValue("ru")
    AlertDialog(onDismissRequest = onDismiss,
        modifier = Modifier.testTag("release-notes-dialog"),
        title = { Text("${copy.title} · ${BuildConfig.VERSION_NAME}") },
        text = { Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            copy.changes.forEach {
                Text("• $it", style = MaterialTheme.typography.bodyMedium)
            }
        } },
        confirmButton = { TextButton(onClick = onDismiss) { Text(copy.close) } })
}

@Composable
internal fun ReleaseNotesAutoDialog(enabled: Boolean) {
    val context = LocalContext.current
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(context, enabled) {
        if (!enabled) return@LaunchedEffect
        val prefs = context.getSharedPreferences("genesis.release-notes", Context.MODE_PRIVATE)
        val seen = prefs.getInt("seenVersionCode", 0)
        if (seen >= BuildConfig.VERSION_CODE) return@LaunchedEffect
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val updated = packageInfo.lastUpdateTime > packageInfo.firstInstallTime
        prefs.edit().putInt("seenVersionCode", BuildConfig.VERSION_CODE).apply()
        show = updated
    }
    if (show) ReleaseNotesDialog { show = false }
}
