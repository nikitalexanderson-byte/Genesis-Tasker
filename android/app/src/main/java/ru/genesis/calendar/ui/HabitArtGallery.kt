package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.habits.StreakRewards
import ru.genesis.calendar.domain.habits.StreakProtection
import ru.genesis.calendar.domain.habits.HabitQuest
import ru.genesis.calendar.domain.habits.HabitQuests
import kotlin.math.cos
import kotlin.math.sin
import java.time.LocalDate

private data class AchievementArt(val id: String, val title: String, val rule: String, val hidden: Boolean = false)
private val achievements = listOf(
    AchievementArt("first-step", "Первый шаг", "Выполнить первую привычку"),
    AchievementArt("three-day-rhythm", "Нить ритма", "Серия три дня"),
    AchievementArt("seven-sunrises", "Семь восходов", "Серия семь дней"),
    AchievementArt("fortnight-rhythm", "Укреплённый ритм", "Серия 14 дней"),
    AchievementArt("perfect-day", "Завершённый круг", "Первый идеальный день"),
    AchievementArt("habit-thirty", "Укоренение", "Одна привычка 30 раз"),
    AchievementArt("century", "Сотня", "Одна привычка 100 раз"),
    AchievementArt("iron-rhythm", "Железный ритм", "Серия 30 дней"),
    AchievementArt("fifty-sunrises", "Пятьдесят восходов", "Серия 50 дней"),
    AchievementArt("hundred-day-path", "Стодневный путь", "Серия 100 дней"),
    AchievementArt("perfect-week", "Идеальная неделя", "Семь идеальных дней подряд", true),
    AchievementArt("perfect-month", "Золотая череда", "30 идеальных дней подряд", true),
    AchievementArt("half-year-circle", "Полугодовой круг", "Серия 180 дней", true),
    AchievementArt("full-revolution", "Полный оборот", "Серия 365 дней", true),
    AchievementArt("five-hundred-sunrises", "Пятьсот восходов", "Серия 500 дней", true),
    AchievementArt("thousand-day-path", "Тысяча дней пути", "Серия 1000 дней", true),
    AchievementArt("comeback", "Возвращение", "Завершить путь возвращения", true),
    AchievementArt("consistency", "Созвездие постоянства", "1000 выполнений всего", true)
)

private fun achievementIsQualified(id: String, workspace: LocalHabitWorkspace): Boolean {
    return workspace.achievementUnlocks.any { it.achievementId == id }
}

/** Original web images stay visible in their semantic rank, achievement and reward sections. */
@Composable
fun HabitArtGallery(workspace: LocalHabitWorkspace, today: LocalDate, busy: Boolean,
    onClaimAmphora: (String) -> Unit, onRevealHiddenPath: () -> Unit,
    onBuySpark: () -> Unit, showQuests: Boolean = true) {
    var galleryOpen by remember { mutableStateOf(false) }
    var rankOpen by remember { mutableStateOf(false) }
    var streakOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(Modifier.fillMaxWidth().testTag("hero-rank-path"),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xff082e2f)),
            border = BorderStroke(1.dp, Color(0x66dfc17e))) {
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(Modifier.size(40.dp), shape = RoundedCornerShape(12.dp), color = Color(0xff143b39),
                        border = BorderStroke(1.dp, Color(0x55dfc17e))) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("♜", color = Color(0xffdfc17e), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    Text("Путь героических рангов", Modifier.weight(1f).padding(start = 10.dp),
                        style = MaterialTheme.typography.titleMedium, color = Color(0xfffff5df))
                }
                HabitsFeatureActionButton(if (rankOpen) "Свернуть ранги" else "Все ранги",
                    onClick = { rankOpen = !rankOpen }, containerColor = Color(0xffdfc17e),
                    contentColor = Color(0xff0b2b2d), borderColor = Color(0xffffe4a6),
                    modifier = Modifier.testTag("all-hero-ranks"))
                if (rankOpen) HeroRankTree(workspace, busy, onClaimAmphora, onRevealHiddenPath)
            }
        }
        Card(Modifier.fillMaxWidth().testTag("streak-reward-ladder"),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xfffff1cf)),
            border = BorderStroke(1.dp, Color(0x88b18b48))) {
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(Modifier.size(40.dp), shape = RoundedCornerShape(12.dp), color = Color(0xffb18b48)) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("♛", color = Color(0xff132426), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    Text("Награды за серию", Modifier.weight(1f).padding(start = 10.dp),
                        style = MaterialTheme.typography.titleMedium, color = Color(0xff4d3a18))
                }
                HabitsFeatureActionButton(if (streakOpen) "Свернуть рубежи" else "Все рубежи",
                    onClick = { streakOpen = !streakOpen }, containerColor = Color(0xffe7ca8d),
                    contentColor = Color(0xff4d3a18), borderColor = Color(0xffad8445),
                    modifier = Modifier.testTag("all-streak-milestones"))
                val claimed = workspace.rewards.filter { it.reason == "streak-milestone" }
                    .mapNotNull { it.sourceId.toIntOrNull() }.toSet()
                val next = StreakRewards.milestones.firstOrNull { it.days !in claimed }
                Text("Рекорд: ${workspace.progress.longestStreak} дней · получено ${claimed.size}/${StreakRewards.milestones.size}",
                    style = MaterialTheme.typography.bodySmall)
                Text(if (next == null) "Все рубежи достигнуты" else
                    "Следующий рубеж: ${next.title} · ${next.days} ${if (next.days == 3) "дня" else "дней"} · +${next.laurels} Лавров",
                    style = MaterialTheme.typography.bodySmall)
                Text("Каждая награда начисляется один раз. Разрыв серии её не отнимает.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (streakOpen) StreakRewards.milestones.forEach { milestone ->
                    val earned = milestone.days in claimed
                    val art = when (milestone.days) {
                        3 -> "three-day-rhythm"
                        7 -> "seven-sunrises"
                        14 -> "fortnight-rhythm"
                        30 -> "iron-rhythm"
                        50 -> "fifty-sunrises"
                        100 -> "hundred-day-path"
                        180 -> "half-year-circle"
                        365 -> "full-revolution"
                        500 -> "five-hundred-sunrises"
                        else -> "thousand-day-path"
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        OriginalImage("achievement-art/$art.webp", null,
                            Modifier.size(32.dp).testTag("streak-milestone-art-${milestone.days}"))
                        Text("${milestone.days} ${if (milestone.days == 3) "дня" else "дней"} · ${milestone.title}", Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium)
                        Text(if (earned) "Получено" else "+${milestone.laurels} Лавров",
                            style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
        if (showQuests) HabitQuestPanel(workspace, today)
        Card(Modifier.fillMaxWidth().testTag("achievement-gallery"),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xfff4e8df)),
            border = BorderStroke(1.dp, Color(0x778e5b48))) {
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(Modifier.size(40.dp), shape = RoundedCornerShape(12.dp), color = Color(0xff8e5b48)) {
                        Box(contentAlignment = Alignment.Center) {
                            Text("✺", color = Color(0xfffff4df), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    Text("Достижения", Modifier.weight(1f).padding(start = 10.dp),
                        style = MaterialTheme.typography.titleMedium, color = Color(0xff553226))
                    Text("${achievements.count { achievementIsQualified(it.id, workspace) }} / ${achievements.size}",
                        style = MaterialTheme.typography.labelLarge)
                }
                Text("Достигнутые рубежи сохраняются. Достижения не изменяют опыт ранга.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                HabitsFeatureActionButton(if (galleryOpen) "Свернуть достижения" else "Все достижения",
                    onClick = { galleryOpen = !galleryOpen }, containerColor = Color(0xff8e5b48),
                    contentColor = Color.White, borderColor = Color(0xffb98771),
                    modifier = Modifier.testTag("all-achievements"))
                if (galleryOpen) achievements.chunked(2).forEach { pair ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { achievement ->
                            val qualified = achievementIsQualified(achievement.id, workspace)
                            Card(Modifier.weight(1f).testTag("achievement-${achievement.id}")) {
                                Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Box(Modifier.fillMaxWidth().height(84.dp), contentAlignment = Alignment.Center) {
                                        OriginalImage("achievement-art/${achievement.id}.webp", achievement.title,
                                            Modifier.size(76.dp).graphicsLayer {
                                                alpha = if (achievement.hidden && !qualified) .45f else 1f
                                            })
                                    }
                                    Text(if (achievement.hidden && !qualified) "Тайное достижение" else achievement.title,
                                        style = MaterialTheme.typography.titleSmall)
                                    Text(if (achievement.hidden && !qualified) "Откроется по мере продвижения"
                                        else achievement.rule, style = MaterialTheme.typography.bodySmall)
                                    if (qualified) Text("Условие выполнено", color = MaterialTheme.colorScheme.primary,
                                        style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        Card(Modifier.fillMaxWidth().testTag("hestia-spark-card"), shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xfffff8e8)),
            border = BorderStroke(1.dp, Color(0x99c68d37))) {
            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                OriginalImage("habit-reward-art/hestia-spark.png", "Искра Гестии", Modifier.size(72.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Искра Гестии", style = MaterialTheme.typography.titleMedium)
                    Text("Автоматически защитит один пропущенный день без XP и ложного выполнения.",
                        style = MaterialTheme.typography.bodySmall)
                    Text("Запас: ${workspace.progress.streakFreezeCount}/${StreakProtection.sparkMax} · ${StreakProtection.sparkCost} Лавров",
                        style = MaterialTheme.typography.labelMedium)
                    workspace.streakFreezeTransactions.lastOrNull { it.reason == "automatic-use" }?.let {
                        Text("Последняя защита: ${it.sourceId}", style = MaterialTheme.typography.bodySmall)
                    }
                    Button(onClick = onBuySpark, enabled = !busy &&
                        workspace.progress.streakFreezeCount < StreakProtection.sparkMax &&
                        workspace.progress.laurelsBalance >= StreakProtection.sparkCost,
                        modifier = Modifier.testTag("buy-hestia-spark")) { Text("Купить Искру") }
                }
            }
        }
        val comeback = StreakProtection.comebackSummary(workspace.goals, today)
        Card(Modifier.fillMaxWidth().testTag("comeback-card"), shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xffe7f0e7)),
            border = BorderStroke(1.dp, Color(0x772f6a55))) {
            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                OriginalImage("habit-reward-art/comeback.png", "Возвращение", Modifier.size(72.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Возвращение", style = MaterialTheme.typography.titleMedium)
                    Text(if (comeback.active) "Выполните дневную цель три раза подряд. Прежняя серия не восстанавливается."
                        else "После разрыва серии здесь появится трёхдневный путь возвращения.",
                        style = MaterialTheme.typography.bodySmall)
                    Text(if (comeback.active) "${comeback.progress}/${StreakProtection.comebackTarget} дня"
                        else "Готово", style = MaterialTheme.typography.labelMedium)
                    comeback.lastCompletedDate?.let { date ->
                        Text("Последнее возвращение: $date · +${StreakProtection.comebackReward} Лавров",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

private fun questTitle(quest: HabitQuest, workspace: LocalHabitWorkspace): String = when (quest.kind) {
    "daily-goal" -> "Завершить дневную цель"
    "daily-goals" -> "Выполнить дневную цель ${quest.target} раз"
    "perfect-days" -> "Создать идеальных дней: ${quest.target}"
    "habit-completions" -> "Выполнить «${workspace.habits.firstOrNull { it.id == quest.habitId }?.title ?: "привычку"}» ${quest.target} раз"
    "epic-completions" -> "Выполнить ${quest.target} привычек за месяц"
    else -> "Выполнить ${quest.target} запланированных привычек"
}

@Composable
internal fun HabitQuestPanel(workspace: LocalHabitWorkspace, today: LocalDate) {
    val quests = HabitQuests.current(workspace.quests, today)
    Card(Modifier.fillMaxWidth().testTag("habit-quest-panel"), shape = AffairsLayout.shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer)) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(Modifier.size(40.dp), shape = RoundedCornerShape(12.dp), color = Color(0xff665c88)) {
                    Box(contentAlignment = Alignment.Center) {
                        Text("⚔", color = Color.White, style = MaterialTheme.typography.titleMedium)
                    }
                }
                Text("Испытания", style = MaterialTheme.typography.titleMedium)
            }
            Text("Составлены из вашего активного ритма · награда — Лавры, не XP ранга",
                style = MaterialTheme.typography.bodySmall)
            if (quests.isEmpty()) Text("Выполнимое испытание появится, когда будет запланирована активная привычка.",
                style = MaterialTheme.typography.bodySmall)
            quests.forEach { quest ->
                Card(Modifier.fillMaxWidth().testTag("quest-${quest.cadence}"),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        QuestSigil(quest.cadence)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(when (quest.cadence) { "daily" -> "Испытание дня";
                                "weekly" -> "Испытание недели"; else -> "Эпическое испытание" },
                                style = MaterialTheme.typography.labelMedium)
                            Text(questTitle(quest, workspace), style = MaterialTheme.typography.titleSmall)
                            LinearProgressIndicator(progress = { quest.progress.toFloat() / quest.target },
                                modifier = Modifier.fillMaxWidth())
                            Text("${quest.progress}/${quest.target} · ${if (quest.completedAt != null) "Завершено" else "+${quest.rewardLaurels} Лавров"}",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestSigil(cadence: String) {
    val gold = Color(0xffb18b48)
    Canvas(Modifier.size(42.dp)) {
        val center = Offset(size.width / 2, size.height / 2)
        val stroke = 1.5.dp.toPx()
        when (cadence) {
            "daily" -> {
                drawCircle(gold, radius = size.minDimension * .28f, center = center, style = Stroke(stroke))
                drawCircle(gold, radius = size.minDimension * .08f, center = center)
                (0 until 8).forEach { index ->
                    val angle = index * Math.PI / 4
                    val dx = cos(angle).toFloat(); val dy = sin(angle).toFloat()
                    drawLine(gold, center + Offset(dx * size.minDimension * .36f, dy * size.minDimension * .36f),
                        center + Offset(dx * size.minDimension * .47f, dy * size.minDimension * .47f), stroke)
                }
            }
            "weekly" -> {
                drawRect(gold, topLeft = Offset(size.width * .16f, size.height * .22f),
                    size = androidx.compose.ui.geometry.Size(size.width * .68f, size.height * .62f),
                    style = Stroke(stroke))
                drawLine(gold, Offset(size.width * .16f, size.height * .38f),
                    Offset(size.width * .84f, size.height * .38f), stroke)
                drawLine(gold, Offset(size.width * .34f, size.height * .12f),
                    Offset(size.width * .34f, size.height * .31f), stroke)
                drawLine(gold, Offset(size.width * .66f, size.height * .12f),
                    Offset(size.width * .66f, size.height * .31f), stroke)
                drawCircle(gold, radius = size.minDimension * .07f, center = center)
            }
            else -> {
                val star = Path()
                (0 until 10).forEach { index ->
                    val radius = if (index % 2 == 0) .44f else .21f
                    val angle = -Math.PI / 2 + index * Math.PI / 5
                    val x = center.x + cos(angle).toFloat() * size.minDimension * radius
                    val y = center.y + sin(angle).toFloat() * size.minDimension * radius
                    if (index == 0) star.moveTo(x, y) else star.lineTo(x, y)
                }
                star.close()
                drawPath(star, gold, style = Stroke(stroke))
                drawCircle(gold, radius = size.minDimension * .055f, center = center)
            }
        }
    }
}
