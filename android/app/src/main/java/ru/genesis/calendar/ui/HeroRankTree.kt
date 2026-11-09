package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.habits.HeroPathCheckpoint
import ru.genesis.calendar.domain.habits.HeroProgress
import ru.genesis.calendar.domain.habits.HeroRankCatalog
import ru.genesis.calendar.domain.habits.HeroicRank

private val heroNight = Color(0xff082e2f)
private val heroPanel = Color(0xff102f2b)
private val heroPanelReached = Color(0xff183a32)
private val heroGold = Color(0xffdfc17e)
private val heroIvory = Color(0xfffff5df)
private val heroMuted = Color(0xffa9bdb5)

/** Original rank and reward art stays attached to the same semantic milestones as on the web. */
private val rankPaintings = listOf(
    "01_tantal.webp", "02_sisyphus.webp", "03_cyclops.webp", "04_icarus.webp",
    "05_lionheart.webp", "06_poison_conqueror.webp", "07_golden_horn_pathfinder.webp",
    "08_mountain_tamer.webp", "09_lord_of_the_flow.webp", "10_bronze_wing.webp",
    "11_tamer_of_might.webp", "12_iron_charioteer.webp", "13_bearer_of_royal_honor.webp",
    "14_guardian_of_the_western_border.webp", "15_keeper_of_the_golden_garden.webp",
    "16_risen_from_the_abyss.webp",
)

internal fun heroRankThumbnailPath(rank: HeroicRank): String? =
    rankPaintings.getOrNull(HeroRankCatalog.ranks.indexOf(rank))?.let { "hero-path/256/$it" }

private val amphoraPaintings = listOf(
    "17_amphora_of_aspiration.webp", "18_amphora_of_endurance.webp",
    "19_amphora_of_mastery.webp", "20_amphora_of_abyss.webp",
)

@Composable
internal fun HeroRankTree(workspace: LocalHabitWorkspace, busy: Boolean,
    onClaimAmphora: (String) -> Unit, onRevealHiddenPath: () -> Unit) {
    val progress = workspace.progress
    val current = HeroProgress.rankForProgress(progress)
    val next = HeroProgress.nextRankForProgress(progress)
    var selected by remember { mutableStateOf<HeroicRank?>(null) }
    Column(Modifier.fillMaxWidth().background(eveningSurface(heroNight)).testTag("hero-rank-tree"),
        verticalArrangement = Arrangement.spacedBy(0.dp)) {
        Text("ПОЖИЗНЕННЫЙ ПРОГРЕСС", style = MaterialTheme.typography.labelMedium,
            color = heroMuted, fontWeight = FontWeight.Bold)
        Text("Путь Героя", style = MaterialTheme.typography.headlineLarge,
            color = heroIvory, fontFamily = GenesisHeadingFont)
        Text("Каждый балл сохраняет реальное выполнение. XP не тратится, а достигнутые ранги не теряются.",
            style = MaterialTheme.typography.bodySmall, color = heroMuted)
        Spacer(Modifier.height(16.dp))
        CurrentRankPanel(current, next, progress.lifetimeXp)
        Spacer(Modifier.height(18.dp))

        val visible = HeroRankCatalog.ranks.filter { it.path != "hidden" }
        visible.forEachIndexed { index, rank ->
            RankTreeRow(rank, index, rankPaintings.getOrNull(index), workspace, busy,
                onSelect = { selected = rank }, onClaimAmphora = onClaimAmphora)
        }
        if (!HeroProgress.hiddenUnlocked(progress.lifetimeXp)) {
            Surface(Modifier.fillMaxWidth().padding(start = 24.dp, top = 8.dp, bottom = 8.dp),
                color = Color(0xff0b2827), shape = RoundedCornerShape(18.dp),
                border = BorderStroke(1.dp, heroGold.copy(alpha = .35f))) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("Путь продолжается…", style = MaterialTheme.typography.titleMedium,
                        color = heroGold, fontFamily = GenesisHeadingFont)
                    Text("За видимыми вратами скрывается продолжение.",
                        style = MaterialTheme.typography.bodySmall, color = heroMuted)
                }
            }
        } else if (!HeroProgress.hiddenRevealed(progress)) {
            Button(onClick = onRevealHiddenPath, enabled = !busy,
                modifier = Modifier.fillMaxWidth().padding(start = 24.dp).heightIn(min = 48.dp)
                    .testTag("reveal-hidden-hero-path"),
                colors = ButtonDefaults.buttonColors(containerColor = eveningSurface(heroGold), contentColor = eveningInk(heroNight))) {
                Text("Открыть продолжение пути")
            }
        } else {
            Text("Второй путь · за вратами", Modifier.padding(start = 24.dp, top = 18.dp, bottom = 8.dp),
                style = MaterialTheme.typography.titleLarge, color = heroIvory)
            HeroRankCatalog.ranks.filter { it.path == "hidden" }.forEachIndexed { index, rank ->
                RankTreeRow(rank, visible.size + index, null, workspace, busy,
                    onSelect = { selected = rank }, onClaimAmphora = onClaimAmphora)
            }
        }
    }
    selected?.let { rank -> RankDialog(rank, progress.lifetimeXp) { selected = null } }
}

@Composable
private fun CurrentRankPanel(current: HeroicRank, next: HeroicRank?, xp: Int) {
    val image = heroRankThumbnailPath(current)
    val lower = current.threshold
    val upper = next?.threshold ?: maxOf(lower + 1, xp)
    val progress = if (next == null) 1f else ((xp - lower).toFloat() / (upper - lower).coerceAtLeast(1)).coerceIn(0f, 1f)
    Surface(Modifier.fillMaxWidth().testTag("hero-current-rank"), color = Color(0xff112a27),
        shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, heroGold.copy(alpha = .38f))) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (image != null) OriginalImage(image, current.title, Modifier.size(92.dp))
            else Surface(Modifier.size(76.dp), shape = CircleShape, color = heroGold.copy(alpha = .12f),
                border = BorderStroke(1.dp, heroGold.copy(alpha = .35f))) {
                Box(contentAlignment = Alignment.Center) { Text("✦", color = heroGold,
                    style = MaterialTheme.typography.headlineMedium) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("ТЕКУЩИЙ РАНГ", style = MaterialTheme.typography.labelSmall, color = heroMuted)
                Text(current.title, style = MaterialTheme.typography.headlineSmall,
                    color = heroIvory, fontFamily = GenesisHeadingFont)
                Text("$xp XP", style = MaterialTheme.typography.titleSmall, color = Color(0xffba7b5b))
                LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth(),
                    color = heroGold, trackColor = eveningSurface(Color(0xff3c4d47)))
                Text(if (next == null) "Видимый путь пройден" else
                    "${(next.threshold - xp).coerceAtLeast(0)} XP до «${next.title}»",
                    style = MaterialTheme.typography.labelSmall, color = heroMuted)
            }
        }
    }
}

@Composable
private fun RankTreeRow(rank: HeroicRank, index: Int, painting: String?,
    workspace: LocalHabitWorkspace, busy: Boolean, onSelect: () -> Unit,
    onClaimAmphora: (String) -> Unit) {
    val checkpoint = HeroProgress.checkpoints.firstOrNull { it.rankId == rank.id }
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Canvas(Modifier.width(24.dp).fillMaxHeight()) {
            val x = size.width / 2f
            val y = 72.dp.toPx().coerceAtMost(size.height / 2f)
            drawLine(heroGold.copy(alpha = .42f), Offset(x, 0f), Offset(x, size.height),
                strokeWidth = 1.dp.toPx(), cap = StrokeCap.Round)
            drawLine(heroGold.copy(alpha = .65f), Offset(x, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
            drawCircle(heroGold, radius = 4.dp.toPx(), center = Offset(x, y))
        }
        Column(Modifier.weight(1f).padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RankTreeNode(rank, index, painting, workspace, onSelect)
            checkpoint?.let { CheckpointNode(it, workspace, busy, onClaimAmphora) }
        }
    }
}

@Composable
private fun RankTreeNode(rank: HeroicRank, index: Int, painting: String?,
    workspace: LocalHabitWorkspace, onSelect: () -> Unit) {
    val reached = workspace.progress.lifetimeXp >= rank.threshold
    val current = HeroProgress.rankForProgress(workspace.progress).id == rank.id
    Surface(onClick = onSelect, modifier = Modifier.fillMaxWidth().heightIn(min = 136.dp)
        .graphicsLayer { alpha = if (reached || current) 1f else .48f }
        .testTag("hero-tree-rank-${rank.id}"),
        shape = RoundedCornerShape(18.dp), color = if (reached) heroPanelReached else heroPanel,
        border = BorderStroke(if (current) 2.dp else 1.dp,
            if (current) heroGold else heroGold.copy(alpha = if (reached) .30f else .14f))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("СТУПЕНЬ ${index + 1}", color = heroMuted, style = MaterialTheme.typography.labelSmall)
                Text(rank.title, style = MaterialTheme.typography.titleLarge, color = heroIvory,
                    fontFamily = GenesisHeadingFont, maxLines = 2)
                Text("${rank.threshold} XP", style = MaterialTheme.typography.labelMedium,
                    color = Color(0xffa9774e))
                Text(if (current) "ВЫ ЗДЕСЬ" else if (reached) "ДОСТИГНУТ" else "ВПЕРЕДИ",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (current) heroGold else heroMuted, fontWeight = FontWeight.Bold)
            }
            if (painting != null) OriginalImage("hero-path/256/$painting", rank.title, Modifier.size(106.dp))
        }
    }
}

@Composable
private fun CheckpointNode(checkpoint: HeroPathCheckpoint, workspace: LocalHabitWorkspace, busy: Boolean,
    onClaimAmphora: (String) -> Unit) {
    val rank = HeroRankCatalog.ranks.first { it.id == checkpoint.rankId }
    val reached = workspace.progress.lifetimeXp >= rank.threshold
    val claimed = workspace.rewards.any { it.idempotencyKey == "hero-path-amphora:self:${checkpoint.rankId}" }
    val art = amphoraPaintings.getOrNull(HeroProgress.checkpoints.indexOf(checkpoint))
    Surface(Modifier.fillMaxWidth().testTag("hero-checkpoint-${checkpoint.rankId}"),
        shape = RoundedCornerShape(18.dp), color = Color(0xff0a2928),
        border = BorderStroke(1.dp, heroGold.copy(alpha = .30f))) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (art != null) OriginalImage("hero-path/256/$art", checkpoint.title, Modifier.size(66.dp))
            else Text("♛", style = MaterialTheme.typography.headlineMedium, color = heroGold)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("ГАРАНТИРОВАННАЯ НАГРАДА", style = MaterialTheme.typography.labelSmall, color = heroMuted)
                Text(checkpoint.title, style = MaterialTheme.typography.titleMedium,
                    color = heroIvory, fontFamily = GenesisHeadingFont)
                Text("♛ +${checkpoint.rewardLaurels} Лавров", style = MaterialTheme.typography.labelMedium,
                    color = heroGold)
            }
            TextButton(onClick = { onClaimAmphora(checkpoint.rankId) }, enabled = reached && !claimed && !busy,
                modifier = Modifier.testTag("amphora-${checkpoint.rankId}"),
                colors = ButtonDefaults.textButtonColors(contentColor = heroGold,
                    disabledContentColor = heroMuted.copy(alpha = .55f))) {
                Text(if (claimed) "Получено" else if (reached) "Открыть" else "Закрыто")
            }
        }
    }
}

@Composable
private fun RankDialog(rank: HeroicRank, xp: Int, onDismiss: () -> Unit) {
    val index = HeroRankCatalog.ranks.indexOf(rank)
    val painting = rankPaintings.getOrNull(index)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(24.dp),
            color = heroNight, border = BorderStroke(1.dp, heroGold.copy(alpha = .45f))) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                GenesisDialogHeader("rank-close", onDismiss) {
                    Text("Ступень ${index + 1} · ${rank.title}", style = MaterialTheme.typography.titleLarge,
                        color = heroIvory, fontFamily = GenesisHeadingFont)
                }
                if (painting != null) OriginalImage("hero-path/512/$painting", rank.title,
                    Modifier.fillMaxWidth().height(260.dp))
                Text("${rank.threshold} XP · ${if (xp >= rank.threshold) "Достигнут" else "Впереди"}",
                    color = heroGold)
                Text("Опыт ранга сохраняется навсегда и не тратится.",
                    style = MaterialTheme.typography.bodySmall, color = heroMuted)

            }
        }
    }
}
