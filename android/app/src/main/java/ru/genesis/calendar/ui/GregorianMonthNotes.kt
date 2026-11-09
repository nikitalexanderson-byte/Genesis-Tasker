package ru.genesis.calendar.ui

import java.time.ZoneId

/** Short historical notes distinguish disputed etymologies from established dedications. */
internal fun gregorianMonthOrigin(month: Int): String = listOf(
    "Назван в честь бога Януса", "Название связывают с этрусским богом Фебруусом",
    "Назван в честь бога Марса", "От латинского — aperire — открывать, раскрывать",
    "Назван в честь богини Майи", "Назван в честь богини Юноны",
    "Назван в честь Юлия Цезаря", "Назван в честь императора Августа",
    "От латинского septem — семь", "От латинского octo — восемь",
    "От латинского novem — девять", "От латинского decem — десять",
)[month - 1]

/** Display order changes with the year setting; civil dates keep their real month. */
internal fun gregorianMonthOrdinal(month: Int, startsInMarch: Boolean): Int {
    require(month in 1..12)
    return if (startsInMarch) (month + 9) % 12 + 1 else month
}

/** The selected region supplies a seasonal description, never a weather forecast. */
internal fun gregorianMonthNature(month: Int, zone: ZoneId): String {
    val region = seasonArtRegion(zone)
    val shifted = if (isSouthernSeasonRegion(zone)) (month + 5) % 12 + 1 else month
    val season = when (shifted) { 12, 1, 2 -> 0; 3, 4, 5 -> 1; 6, 7, 8 -> 2; else -> 3 }
    return when (region) {
        SeasonArtRegion.TROPICAL -> "Период пышной тропической зелени"
        SeasonArtRegion.ARID -> listOf("Период прохладных ночей", "Период весеннего цветения", "Период сухой жары", "Период спада летней жары")[season]
        SeasonArtRegion.MEDITERRANEAN -> listOf("Период мягкой дождливой зимы", "Период весеннего цветения", "Период сухого тёплого лета", "Период осенних дождей")[season]
        SeasonArtRegion.BOREAL -> listOf("Период снега и долгих ночей", "Период пробуждения северной природы", "Период долгих светлых дней", "Период золотой хвои и листвы")[season]
        else -> listOf("Период зимнего покоя природы", "Период первых проталин", "Период пробуждения природы", "Период молодой зелени и первых цветов",
            "Период цветения садов", "Период долгих светлых дней", "Период летнего разнотравья", "Период созревания плодов",
            "Период первых красок осени", "Период золотой листвы", "Период подготовки природы к зиме", "Период коротких зимних дней")[shifted - 1]
    }
}
