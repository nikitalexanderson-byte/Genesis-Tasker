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
    val index = notificationCopyIndex(seed, pool.size)
    val pair = pool[index]
    val names = mapOf("ru" to "«Практика дня»", "en" to "your daily practice",
        "he" to "התרגול היומי שלך", "ar" to "ممارستك اليومية",
        "ko" to "오늘의 연습", "nl" to "je dagelijkse oefening",
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
            ?.let { variants -> variants[index % variants.size] } ?: pair.second
    }
    return if (kind == "goal") template.replace("{count}", count.toString())
        else template.replace("{subject}", name)
}

internal fun habitNotificationBody(tone: String, kind: String, count: Int, english: Boolean,
    seed: String = "preview", subject: String? = null): String =
    habitNotificationBody(tone, kind, count, if (english) "en" else "ru", seed, subject)
