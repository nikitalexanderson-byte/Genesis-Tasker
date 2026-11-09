package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SolarLocation
import java.time.LocalDate

/** A shared sunrise/sunset group in each Today calendar mode, with no clock or date navigation. */
@Composable
internal fun TodaySolarTimes(date: LocalDate, location: SolarLocation, calendar: GenesisCalendar) {
    val ink = if (LocalEveningTheme.current) Color(0xfffff8e9) else MaterialTheme.colorScheme.onSurface
    Surface(Modifier.fillMaxWidth().testTag("today-solar-times"), shape = AffairsLayout.shape,
        color = todayHeroBlockBackground(.26f), contentColor = ink,
        border = BorderStroke(1.dp, Color(0x66dfc17e))) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Сегодня", style = MaterialTheme.typography.labelLarge)
            SunriseSunsetLine(date, location, calendar, accent = ink,
                textColor = ink, modifier = Modifier.fillMaxWidth())
        }
    }
}
