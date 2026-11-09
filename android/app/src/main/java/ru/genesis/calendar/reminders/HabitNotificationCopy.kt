package ru.genesis.calendar.reminders

internal fun notificationCopyIndex(seed: String, length: Int): Int {
    var hash = 2166136261u
    seed.forEach { hash = (hash xor it.code.toUInt()) * 16777619u }
    return (hash % length.toUInt()).toInt()
}

internal fun habitNotificationBody(tone: String, kind: String, count: Int, language: String,
    seed: String = "preview", subject: String? = null): String {
    val pool = habitNotificationMessages["$tone/${if (kind == "goal") "goal" else "habit"}"]
        ?: habitNotificationMessages.getValue("calm/habit")
    val pair = pool[notificationCopyIndex(seed, pool.size)]
    val names = mapOf("ru" to "«Практика дня»", "en" to "your daily practice",
        "el" to "«Η πρακτική της ημέρας»", "de" to "deine tägliche Übung",
        "fr" to "votre pratique du jour", "es" to "tu práctica diaria",
        "it" to "la tua pratica quotidiana", "pt" to "a sua prática diária",
        "pl" to "codzienną praktykę", "sr" to "дневну праксу",
        "uk" to "щоденної практики", "zh" to "每日练习",
        "tr" to "günlük pratiğiniz", "ja" to "今日の習慣")
    val name = subject ?: names[language] ?: names.getValue("en")
    val template = when (language) {
        "ru" -> pair.first
        "en" -> pair.second
        else -> habitNotificationLocalized["$tone/${if (kind == "goal") "goal" else "habit"}"]?.get(language)
            ?: pair.second
    }
    return template.replace("{subject}", name).replace("{count}", count.toString())
}

internal fun habitNotificationBody(tone: String, kind: String, count: Int, english: Boolean,
    seed: String = "preview", subject: String? = null): String =
    habitNotificationBody(tone, kind, count, if (english) "en" else "ru", seed, subject)
