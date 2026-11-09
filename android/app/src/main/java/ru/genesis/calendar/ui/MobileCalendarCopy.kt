package ru.genesis.calendar.ui

import ru.genesis.calendar.domain.CalendarMode

/** Short, reviewed native labels that must fit narrow phone headings. */
internal data class MobileCalendarCopy(
    val switchHint: String,
    val gregorian: String,
    val sacred: String,
    val lunar: String,
    val projects: String,
    val activeTasks: String,
)

internal fun mobileCalendarCopy(language: String): MobileCalendarCopy = when (language) {
    "en" -> MobileCalendarCopy("Tap the card to change calendars", "Gregorian calendar", "Sacred calendar", "Lunar calendar", "Projects", "Active tasks")
    "el" -> MobileCalendarCopy("Πατήστε την κάρτα για αλλαγή ημερολογίου", "Γρηγοριανό ημερολόγιο", "Ιερό ημερολόγιο", "Σεληνιακό ημερολόγιο", "Έργα", "Ενεργές εργασίες")
    "de" -> MobileCalendarCopy("Karte antippen, um den Kalender zu wechseln", "Gregorianischer Kalender", "Sakraler Kalender", "Mondkalender", "Projekte", "Aktive Aufgaben")
    "fr" -> MobileCalendarCopy("Touchez la carte pour changer de calendrier", "Calendrier grégorien", "Calendrier sacré", "Calendrier lunaire", "Projets", "Tâches actives")
    "es" -> MobileCalendarCopy("Toca la tarjeta para cambiar de calendario", "Calendario gregoriano", "Calendario sagrado", "Calendario lunar", "Proyectos", "Tareas activas")
    "it" -> MobileCalendarCopy("Tocca la scheda per cambiare calendario", "Calendario gregoriano", "Calendario sacro", "Calendario lunare", "Progetti", "Attività attive")
    "pt" -> MobileCalendarCopy("Toque no cartão para mudar o calendário", "Calendário gregoriano", "Calendário sagrado", "Calendário lunar", "Projetos", "Tarefas ativas")
    "pl" -> MobileCalendarCopy("Dotknij karty, aby zmienić kalendarz", "Kalendarz gregoriański", "Kalendarz sakralny", "Kalendarz księżycowy", "Projekty", "Aktywne zadania")
    "sr" -> MobileCalendarCopy("Dodirnite karticu da promenite kalendar", "Gregorijanski kalendar", "Sakralni kalendar", "Lunarni kalendar", "Projekti", "Aktivni zadaci")
    "uk" -> MobileCalendarCopy("Натисніть на блок, щоб змінити календар", "Григоріанський календар", "Сакральний календар", "Місячний календар", "Проєкти", "Активні завдання")
    "zh" -> MobileCalendarCopy("点击卡片切换日历", "公历", "神圣历", "阴历", "项目", "进行中的任务")
    "tr" -> MobileCalendarCopy("Takvimi değiştirmek için karta dokunun", "Gregoryen takvim", "Kutsal takvim", "Ay takvimi", "Projeler", "Etkin görevler")
    "ja" -> MobileCalendarCopy("カードをタップして暦を切り替え", "グレゴリオ暦", "神聖暦", "太陰暦", "プロジェクト", "進行中のタスク")
    else -> MobileCalendarCopy("Нажмите на плашку, чтобы сменить календарь", "Григорианский календарь", "Сакральный календарь", "Лунный календарь", "Проекты", "Активные задачи")
}

internal fun MobileCalendarCopy.calendarName(mode: CalendarMode): String = when (mode) {
    CalendarMode.PROFANE -> gregorian
    CalendarMode.SACRED -> sacred
    CalendarMode.LUNAR -> lunar
}

internal fun MobileCalendarCopy.projectSummary(projectCount: Int, activeCount: Int): String =
    "$projects: $projectCount · $activeTasks: $activeCount"

internal data class SpringYearCopy(val title: String, val body: String, val action: String, val dismiss: String)

internal fun springYearCopy(language: String): SpringYearCopy = when (language) {
    "en" -> SpringYearCopy("Begin the year in spring", "Nature awakens in March. You can start the displayed Gregorian year then.", "Start in March", "Dismiss suggestion")
    "el" -> SpringYearCopy("Ξεκινήστε το έτος την άνοιξη", "Η φύση ξυπνά τον Μάρτιο. Μπορείτε να αρχίσετε τότε το προβαλλόμενο Γρηγοριανό έτος.", "Αρχή τον Μάρτιο", "Κλείσιμο πρότασης")
    "de" -> SpringYearCopy("Das Jahr im Frühling beginnen", "Im März erwacht die Natur. Das angezeigte gregorianische Jahr kann dann beginnen.", "Ab März beginnen", "Hinweis schließen")
    "fr" -> SpringYearCopy("Commencer l’année au printemps", "La nature s’éveille en mars. Vous pouvez y faire commencer l’année grégorienne affichée.", "Commencer en mars", "Fermer la suggestion")
    "es" -> SpringYearCopy("Empezar el año en primavera", "La naturaleza despierta en marzo. Puedes iniciar entonces el año gregoriano mostrado.", "Empezar en marzo", "Cerrar sugerencia")
    "it" -> SpringYearCopy("Inizia l’anno in primavera", "La natura si risveglia a marzo. Puoi iniziare da lì l’anno gregoriano visualizzato.", "Inizia a marzo", "Chiudi suggerimento")
    "pt" -> SpringYearCopy("Comece o ano na primavera", "A natureza desperta em março. Pode iniciar aí o ano gregoriano apresentado.", "Começar em março", "Fechar sugestão")
    "pl" -> SpringYearCopy("Zacznij rok wiosną", "Przyroda budzi się w marcu. Wyświetlany rok gregoriański może zaczynać się wtedy.", "Zacznij w marcu", "Zamknij sugestię")
    "sr" -> SpringYearCopy("Počnite godinu u proleće", "Priroda se budi u martu. Prikazanu gregorijansku godinu možete započeti tada.", "Počni u martu", "Zatvori predlog")
    "uk" -> SpringYearCopy("Почніть рік навесні", "Природа пробуджується в березні. Можна починати відображуваний григоріанський рік тоді.", "Почати з березня", "Закрити пораду")
    "zh" -> SpringYearCopy("从春天开始新的一年", "大自然在三月苏醒。您可以让显示的公历年从三月开始。", "从三月开始", "关闭建议")
    "tr" -> SpringYearCopy("Yıla ilkbaharda başlayın", "Doğa martta uyanır. Görüntülenen Gregoryen yılı martta başlatabilirsiniz.", "Martta başlat", "Öneriyi kapat")
    "ja" -> SpringYearCopy("春から一年を始める", "自然が目覚める3月から、表示上のグレゴリオ暦の年を始められます。", "3月から始める", "提案を閉じる")
    else -> SpringYearCopy("Начните год весной", "Природа пробуждается в марте. Можно начинать отображаемый григорианский год с этого месяца.", "Начинать с марта", "Закрыть предложение")
}
