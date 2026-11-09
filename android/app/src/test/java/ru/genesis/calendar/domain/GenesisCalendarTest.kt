package ru.genesis.calendar.domain

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

class GenesisCalendarTest {
    @Test fun yearNavigationAndSavedRecurrencesKeepTheirOwnAstronomicalContext() {
        val ny = GenesisCalendar(ZoneId.of("America/New_York"))
        val start = LocalDate.of(2024,3,19)
        assertEquals(start, ny.sacredYearStart(2024))
        assertEquals(LocalDate.of(2025,3,20), ny.shiftYear(start, CalendarMode.SACRED, 1))
        assertEquals(start, ny.shiftYear(ny.shiftYear(start, CalendarMode.SACRED, 1), CalendarMode.SACRED, -1))
        val legacy = RecurrenceConfig(true,"genesis","month-days",listOf(1),rangeEnd="2024-03-21",months=listOf(1))
        val modern = legacy.copy(calendarContext=CalendarContext(timeZone="America/New_York"))
        val engine = RecurrenceEngine(GenesisCalendar(ZoneId.of("Pacific/Auckland")))
        assertEquals(listOf("2024-03-20"), engine.buildDates("2024-03-18",legacy))
        assertEquals(listOf("2024-03-19"), engine.buildDates("2024-03-18",modern))
        val march = GenesisCalendar(ZoneId.of("UTC"),gregorianYearStart="march")
        assertEquals(CalendarRange(LocalDate.of(2023,3,1),LocalDate.of(2024,2,29)), march.yearRange(LocalDate.of(2024,2,29),CalendarMode.PROFANE))
        val lunar = march.lunarYear(2025)
        assertEquals(13,lunar.monthCount)
        assertTrue(java.time.temporal.ChronoUnit.DAYS.between(lunar.startDate,lunar.endDate) > 370)
        assertEquals(lunar.startDate, march.yearRange(lunar.endDate.minusDays(1),CalendarMode.LUNAR).start)
    }
    @Test fun matchesActualWebCalendarVectorsAcrossFourZones() {
        webCalendarVectors.forEach { line ->
            val v = line.split('|')
            val calendar = GenesisCalendar(ZoneId.of(v[0]))
            val date = LocalDate.parse(v[1])
            val sacred = calendar.sacredDate(date)
            val lunar = calendar.lunarDate(date)
            val actual = listOf(v[0],v[1],sacred.sacredYear,sacred.monthIndex,sacred.day,sacred.apeironDays,
                lunar.year.sacredYear,lunar.monthIndex,lunar.monthOrdinal,lunar.day,lunar.monthLength,lunar.isThreshold).joinToString("|")
            assertEquals(line, line, actual)
            assertEquals(date, calendar.gregorianDate(sacred.sacredYear,sacred.monthIndex,sacred.day))
        }
    }

    @Test fun allOriginalMonthAndDayDefinitionsArePresent() {
        assertEquals(13, SacredCatalog.months.size)
        assertEquals(366, SacredCatalog.months.sumOf { it.days.size })
        assertTrue(SacredCatalog.months.take(12).all { it.days.size == 30 })
        assertEquals(6,SacredCatalog.months.last().days.size)
        assertTrue(SacredCatalog.months.flatMap { it.days }.all { it.name.isNotBlank() && it.description.isNotBlank() })
    }

    @Test fun recurrenceMatchesActualWebVectors() {
        val engine = RecurrenceEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))
        webRecurrenceVectors.forEach { v ->
            assertEquals("${v.start}: ${v.config}",v.expected,engine.buildDates(v.start,v.config))
        }
    }

    @Test fun lunarHabitCadencesFollowActualLunarMonthsAndThirteenthMonth() {
        val calendar = GenesisCalendar(ZoneId.of("Europe/Moscow"))
        val engine = RecurrenceEngine(calendar)
        val start = "2026-04-01"
        val end = "2026-08-01"
        fun config(pattern: String, days: List<Int>, months: List<Int> = emptyList(), pyatas: List<Int> = emptyList()) =
            RecurrenceConfig(true,"lunar",pattern,days,rangeEnd=end,months=months,pyatas=pyatas)
        val decades = engine.buildDates(start, config("lunar-decades", listOf(2)))
        assertTrue(decades.isNotEmpty())
        assertTrue(decades.all { calendar.lunarDate(LocalDate.parse(it)).day in 11..20 })
        val decadeDays = engine.buildDates(start, config("lunar-decade-days", listOf(3),pyatas=listOf(2)))
        assertTrue(decadeDays.isNotEmpty())
        assertTrue(decadeDays.all { calendar.lunarDate(LocalDate.parse(it)).day == 13 })
        val phases = engine.buildDates(start, config("lunar-phases", listOf(1,2)))
        assertTrue(phases.any { calendar.lunarDate(LocalDate.parse(it)).day == 1 })
        assertTrue(phases.any { calendar.isLunarFullMoon(LocalDate.parse(it)) })
        assertTrue(phases.all { calendar.lunarDate(LocalDate.parse(it)).day == 1 || calendar.isLunarFullMoon(LocalDate.parse(it)) })
        val intercalaryYear = (2020..2035).first { calendar.lunarYear(it).monthCount == 13 }
        val lunarYear = calendar.lunarYear(intercalaryYear)
        val thirteenth = engine.buildDates(lunarYear.startDate.toString(),
            config("lunar-yearly",listOf(1),months=listOf(13)).copy(rangeEnd=lunarYear.endDate.minusDays(1).toString()))
        assertEquals(1, thirteenth.size)
        assertEquals(13, calendar.lunarDate(LocalDate.parse(thirteenth.single())).monthOrdinal)
    }

    @Test fun monthlyDoesNotInventFebruary31AndYearlyPreservesLeapDay() {
        val engine = RecurrenceEngine(GenesisCalendar())
        assertFalse(engine.matches("2024-01-31", RecurrenceConfig(true,"classic","monthly"),"2024-02-29"))
        assertTrue(engine.matches("2024-02-29", RecurrenceConfig(true,"classic","yearly"),"2028-02-29"))
        assertFalse(engine.matches("2024-02-29", RecurrenceConfig(true,"classic","yearly"),"2025-03-01"))
    }

    @Test fun sacredRecurrenceExcludesApeironAndRangeStartAnchorsIntervals() {
        val engine = RecurrenceEngine(GenesisCalendar())
        assertFalse(engine.matches("2026-03-01",RecurrenceConfig(true,days=listOf(1,2,3,4,5)),"2026-03-19"))
        val config = RecurrenceConfig(true,"classic","daily",interval=2,rangeStart="2026-09-25")
        assertFalse(engine.matches("2026-09-23",config,"2026-09-23"))
        assertTrue(engine.matches("2026-09-23",config,"2026-09-27"))
    }

    @Test fun displaySelectionDoesNotChangeTaskCalendar() {
        for (display in CalendarMode.entries) for (task in CalendarMode.entries) for (format in listOf(true,false)) {
            val original = CalendarPreferences(display,task,format)
            assertEquals(task,original.copy(displayCalendar=CalendarMode.LUNAR).taskCalendar)
            assertEquals(format,original.copy(displayCalendar=CalendarMode.LUNAR).use24HourTime)
        }
    }

    @Test fun excludedOccurrencesAndMaterializedSeriesFollowWebRules() {
        val engine = RecurrenceEngine(GenesisCalendar())
        val config = RecurrenceConfig(true,"classic","daily",rangeEnd="2026-09-25")
        assertEquals(listOf("2026-09-23","2026-09-25"),engine.datesForTask("2026-09-23",config,excludedDates=setOf("2026-09-24")))
        assertEquals(emptyList<String>(),engine.datesForTask("2026-09-23",config,excludedDates=setOf("2026-09-23","2026-09-24","2026-09-25")))
        assertEquals(listOf("2026-09-23"),engine.datesForTask("2026-09-23",config,recurrenceSeriesId="test-series"))
        assertEquals(listOf("2026-09-23"),engine.datesForTask("2026-09-23",config,googleTaskListId="test-list"))
    }

    @Test fun dateOnlyRemainsCivilAndDstPoliciesAreExplicit() {
        val zone = ZoneId.of("America/New_York")
        val day = LocalDate.of(2026,3,8)
        assertEquals("2026-03-09", day.plusDays(1).toString())
        assertThrows(IllegalArgumentException::class.java) { resolveReminderTime(LocalDateTime.of(2026,3,8,2,30),zone,DstOverlapPolicy.EARLIER_OFFSET) }
        val overlap = LocalDateTime.of(2026,11,1,1,30)
        val first = resolveReminderTime(overlap,zone,DstOverlapPolicy.EARLIER_OFFSET)
        val second = resolveReminderTime(overlap,zone,DstOverlapPolicy.LATER_OFFSET)
        assertEquals(3600,second.toEpochSecond()-first.toEpochSecond())
    }

    @Test fun exhaustedEphemerisIsExplicit() {
        assertThrows(IllegalArgumentException::class.java) { GenesisCalendar().lunarDate(LocalDate.of(2103,1,1)) }
    }

    @Test fun moonPhaseDisplayUsesAllThirtyStepsAndMeaningfulBounds() {
        val calendar = GenesisCalendar(ZoneId.of("Europe/Moscow"))
        val range = calendar.monthRange(LocalDate.of(2026,9,24), CalendarMode.LUNAR)
        val phases = range.dates().map(calendar::moonInfo)
        assertTrue(phases.all { it.phaseStep in 0..29 && it.illumination in 0..100 })
        assertEquals(1, phases.first().day)
        assertTrue(phases.any { it.phase == "Полнолуние" })
        assertTrue(phases.any { it.event.contains("новолуние", ignoreCase = true) })
    }

    @Test fun solarTurnPointsMatchWebCalendarInDeviceZone() {
        val calendar = GenesisCalendar(ZoneId.of("Europe/Moscow"))
        val autumn = calendar.solarEvent(LocalDate.of(2026, 9, 23))
        assertEquals("Осеннее равноденствие", autumn?.name)
        assertEquals("03:05", autumn?.instant?.atZone(calendar.zoneId)?.toLocalTime()
            ?.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")))
        assertEquals(4, calendar.solarEvents(2026).size)
    }
}
