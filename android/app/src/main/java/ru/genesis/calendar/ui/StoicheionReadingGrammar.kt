package ru.genesis.calendar.ui

/** Authored Russian/English matching tokens, separate from the translated UI headings. */
internal object StoicheionReadingGrammar {
    val headings = Regex("^(Космогонический профиль|Космологический профиль|Магическая настройка[^\\n]*|Числовая суть|Парадное положение|Перев[её]рнутое положение|Практика[^\\n]*|Cosmogonic profile|Cosmological profile|Magical (?:tuning|attunement)[^\\n]*|Numerical (?:essence|profile)|Upright position|Reversed position|Practice[^\\n]*|Body Practice[^\\n]*)(?=\\s|:|$)", RegexOption.IGNORE_CASE)
    val root = Regex("Корень|Root", RegexOption.IGNORE_CASE)
    val paragraphBreaks = Regex("\\s+(?=В процессе развертывания|В прямом положении|Перевернутая (?:буква|[А-Я])|Числовое значение|In the process|In the upright position|The reversed|The numerical value)")
    val listLine = Regex("^\\s*-\\s|^(Корень|Заклинание|Ассоциативный цвет|Цветовая гамма|Божество|Центр в теле|Медитация|Магическая поза|Работа с телом|Root|Incantation|Color|Deity|Body center|Meditation|Magical pose|Body work):")
    fun cosmogonic(value: String) = value.startsWith("Космо", true) || value.startsWith("Cosmo", true)
    fun magical(value: String) = value.startsWith("Магическая", true) || value.startsWith("Magical", true)
    fun practice(value: String) = value.startsWith("Практика", true) || value.startsWith("Practice", true) || value.startsWith("Body Practice", true)
    fun reversed(value: String) = value.startsWith("Перев", true)
}
