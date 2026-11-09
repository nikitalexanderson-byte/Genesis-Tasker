package ru.genesis.calendar.domain

/** GENESIS convention based on ancient imagery, not a universal Greek cult-calendar rule. */
enum class LunarPatron(val id: String, val nameRu: String) {
    ARTEMIS("artemis", "Артемида"), SELENE("selene", "Селена"), HECATE("hecate", "Геката");
    val artPath: String get() = "weekday-art/lunar-$id-v326.webp"
}

fun lunarPatronForDay(day: Int): LunarPatron {
    require(day in 1..30) { "Invalid lunar day" }
    return when { day <= 10 -> LunarPatron.ARTEMIS; day <= 20 -> LunarPatron.SELENE; else -> LunarPatron.HECATE }
}
