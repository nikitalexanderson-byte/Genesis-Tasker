package ru.genesis.calendar.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private class NavigationAnchors(val page: String) {
    val parents = mutableStateMapOf<Any, Rect>()
    var viewport by mutableStateOf(Rect.Zero)
    var origin by mutableStateOf(Offset.Zero)
    val children = mutableStateMapOf<Any, Pair<String, Rect>>()
    val groups = mutableStateMapOf<Any, Rect>()
}
private val LocalNavigationAnchors = staticCompositionLocalOf<NavigationAnchors?> { null }
internal data class NavigationPageContext(val page: String, val active: Boolean)
internal val LocalNavigationPageContext = staticCompositionLocalOf<NavigationPageContext?> { null }
// Keep the provider stable while the glow animates. Only the small navigation
// controls that read the State should recompose; the page below must not.
internal val LocalNavigationGlowPhase = staticCompositionLocalOf<State<Float>?> { null }
internal val LocalCompactSubmenus = staticCompositionLocalOf { false }
internal val LocalSubmenuOutlineMode = staticCompositionLocalOf { false }
/** The navigation shell owns the submenu while only page content is paged. */
internal val LocalFixedSubmenu = staticCompositionLocalOf { false }

/** A single bottom-drawer entry for Free; paid access is still read from the server. */
@Composable internal fun NativeSidebarUpgradeAction(onDismissDrawer: () -> Unit, modifier: Modifier = Modifier) {
    val access = LocalFeatureAccess.current
    val open = LocalNativeUpgrade.current
    if (open != null && access.currentPlan() == "free") {
        NativeUpgradeSidebarButton({ onDismissDrawer(); open(null) }, modifier)
    }
}

internal fun navigationGlowColor(phase: Float, evening: Boolean): Color {
    val colors = if (evening) listOf(Color(0xff83bdb0), Color(0xffaa9cc9),
        Color(0xffd6bd87), Color(0xff83bdb0)) else listOf(Color(0xff377a70),
        Color(0xff7969a0), Color(0xffa17c3b), Color(0xff377a70))
    val position = (phase.coerceIn(0f, 1f) * 3f).coerceAtMost(2.999f)
    val index = position.toInt()
    return lerp(colors[index], colors[index + 1], position - index)
}

/** Coordinates follow layout and horizontal scrolling; the spring gently follows the parent. */
@Composable internal fun NavigationConnectionScope(page: String, selectedSubmenuId: String? = null,
    showConnections: Boolean = true,
    outlineMode: Boolean = false,
    iconGlow: Boolean = false,
    content: @Composable () -> Unit) {
    val motionPhase = if ((iconGlow || showConnections) && ValueAnimator.areAnimatorsEnabled()) {
        val transition = rememberInfiniteTransition(label = "icon-navigation-glow")
        transition.animateFloat(0f, 1f,
            infiniteRepeatable(tween(5_400, easing = LinearEasing)), label = "glow-phase")
    } else null
    val glowPhase = if (iconGlow) motionPhase else null
    val anchors = remember(page) { NavigationAnchors(page) }
    val viewport = anchors.viewport
    val parent = anchors.parents.values
        .filter { it.right > viewport.left && it.left < viewport.right &&
            it.bottom > viewport.top && it.top < viewport.bottom }
        .minByOrNull { kotlin.math.abs(it.center.x - viewport.center.x) }
        ?: anchors.parents.values.minByOrNull { kotlin.math.abs(it.center.x - viewport.center.x) }
        ?: Rect.Zero
    val rail = viewport.height > viewport.width * 1.5f
    val targetX = if (viewport.width > 16f)
        parent.center.x.coerceIn(viewport.left + 8f, viewport.right - 8f) else 0f
    val parentX by animateFloatAsState(targetX, spring(dampingRatio = 1f, stiffness = 450f), label = "menu-link-x")
    val parentY by animateFloatAsState(parent.center.y, spring(dampingRatio = 1f, stiffness = 450f), label = "menu-link-y")
    val ink = MaterialTheme.colorScheme.secondary.copy(alpha = if (LocalEveningTheme.current) .6f else .4f)
    val frameInk = MaterialTheme.colorScheme.outlineVariant.copy(alpha =
        if (LocalEveningTheme.current) .62f else .76f)
    Box(Modifier.fillMaxSize().onGloballyPositioned { anchors.origin = it.positionInRoot() }
        .drawWithContent {
            drawContent()
            if (parent == Rect.Zero) return@drawWithContent
            val group = anchors.groups.values.filter {
                it.right > anchors.origin.x && it.left < anchors.origin.x + size.width &&
                    it.bottom > anchors.origin.y && it.top < anchors.origin.y + size.height &&
                    it.width > 40.dp.toPx() && it.height > 12.dp.toPx()
            }.minByOrNull { it.top }
            if (outlineMode && group != null) {
                val connector = Path()
                if (rail && group.left > parent.right) {
                    val startX = parent.right - anchors.origin.x
                    val endX = group.left - anchors.origin.x
                    val startY = parent.center.y - anchors.origin.y
                    val endY = group.center.y - anchors.origin.y
                    val half = 8.dp.toPx()
                    connector.moveTo(startX, startY - half)
                    connector.cubicTo((startX + endX) / 2f, startY - half,
                        (startX + endX) / 2f, endY - half, endX, endY - half)
                    connector.moveTo(startX, startY + half)
                    connector.cubicTo((startX + endX) / 2f, startY + half,
                        (startX + endX) / 2f, endY + half, endX, endY + half)
                } else if (!rail && group.top > parent.bottom) {
                    val startY = parent.bottom - anchors.origin.y
                    val endY = group.top - anchors.origin.y
                    val half = minOf(9.dp.toPx(), group.width / 4f)
                    val x = parent.center.x.coerceIn(group.left + half,
                        group.right - half) - anchors.origin.x
                    val startX = parent.center.x - anchors.origin.x
                    connector.moveTo(startX - half, startY)
                    connector.cubicTo(startX - half, (startY + endY) / 2f,
                        x - half, (startY + endY) / 2f, x - half, endY)
                    connector.moveTo(startX + half, startY)
                    connector.cubicTo(startX + half, (startY + endY) / 2f,
                        x + half, (startY + endY) / 2f, x + half, endY)
                }
                drawPath(connector, frameInk, style = Stroke(width = 1.dp.toPx(),
                    cap = StrokeCap.Round))
                return@drawWithContent
            }
            if (!showConnections) return@drawWithContent
            val startY = parent.bottom - anchors.origin.y + 2.dp.toPx()
            anchors.children.values.forEach { (id, child) ->
                val endY = child.top - anchors.origin.y - 2.dp.toPx()
                val endX = child.center.x - anchors.origin.x
                if (child.center.x !in anchors.origin.x..(anchors.origin.x + size.width) ||
                    child.top !in anchors.origin.y..(anchors.origin.y + size.height)) return@forEach
                val path: Path
                val point: (Float) -> Offset
                if (rail) {
                    val startX = parent.right - anchors.origin.x + 2.dp.toPx()
                    val railX = viewport.right - anchors.origin.x + 5.dp.toPx()
                    val railY = parentY - anchors.origin.y
                    val branchY = endY - 8.dp.toPx()
                    if (endX <= railX || kotlin.math.abs(branchY - railY) > size.height) return@forEach
                    path = Path().apply {
                        moveTo(startX, railY)
                        lineTo(railX, railY)
                        lineTo(railX, branchY)
                        lineTo(endX, branchY)
                        lineTo(endX, endY)
                    }
                    point = { t ->
                        if (t < .5f) Offset(railX, railY + (branchY - railY) * t * 2f)
                        else Offset(railX + (endX - railX) * (t - .5f) * 2f, branchY)
                    }
                } else {
                    if (endY <= startY || endY - startY >= 180.dp.toPx()) return@forEach
                    val startX = parentX - anchors.origin.x
                    val midY = (startY + endY) / 2f
                    path = Path().apply {
                        moveTo(startX, startY)
                        cubicTo(startX, midY, endX, midY, endX, endY)
                    }
                    point = { t ->
                        val inverse = 1f - t
                        Offset(inverse * inverse * inverse * startX +
                            3f * inverse * inverse * t * startX +
                            3f * inverse * t * t * endX + t * t * t * endX,
                            inverse * inverse * inverse * startY +
                            3f * inverse * inverse * t * midY +
                            3f * inverse * t * t * midY + t * t * t * endY)
                    }
                }
                    val selected = selectedSubmenuId == id
                    drawPath(path, ink.copy(alpha = if (selected) .44f else .18f),
                        style = Stroke(width = (if (selected) 1.5.dp else .8.dp).toPx(), cap = StrokeCap.Round))
                    if (selected && motionPhase != null) {
                        drawCircle(ink.copy(alpha = .52f), 1.6.dp.toPx(), point(motionPhase.value))
                    }
            }
        }.testTag("navigation-connections")) {
        CompositionLocalProvider(LocalNavigationAnchors provides anchors,
            LocalNavigationGlowPhase provides glowPhase,
            LocalSubmenuOutlineMode provides outlineMode) { content() }
    }
}

@Composable internal fun navigationParentAnchor(page: String): Modifier {
    val anchors = LocalNavigationAnchors.current ?: return Modifier
    if (anchors.page != page) return Modifier
    val token = remember { Any() }
    DisposableEffect(anchors, token) { onDispose { anchors.parents.remove(token) } }
    return Modifier.onGloballyPositioned {
        val position = it.positionInRoot()
        anchors.parents[token] = Rect(position,
            androidx.compose.ui.geometry.Size(it.size.width.toFloat(), it.size.height.toFloat()))
    }
}
@Composable internal fun navigationViewportAnchor(): Modifier {
    val anchors = LocalNavigationAnchors.current ?: return Modifier
    return Modifier.onGloballyPositioned { anchors.viewport = it.boundsInRoot() }
}

@Composable internal fun navigationSubmenuAnchor(id: String): Modifier {
    val anchors = LocalNavigationAnchors.current ?: return Modifier
    val context = LocalNavigationPageContext.current
    if (context?.active != true || context.page != anchors.page) return Modifier
    val token = remember { Any() }
    DisposableEffect(anchors, token) { onDispose { anchors.children.remove(token) } }
    return Modifier.onGloballyPositioned { anchors.children[token] = id to it.boundsInRoot() }
}

@Composable internal fun navigationSubmenuGroupAnchor(): Modifier {
    val anchors = LocalNavigationAnchors.current ?: return Modifier
    val context = LocalNavigationPageContext.current
    if (context?.active != true || context.page != anchors.page) return Modifier
    val token = remember { Any() }
    DisposableEffect(anchors, token) { onDispose { anchors.groups.remove(token) } }
    return Modifier.onGloballyPositioned { anchors.groups[token] = it.boundsInRoot() }
}

internal data class SubmenuItem(val id: String, val title: String, val accent: Color? = null, val tag: String? = null)

/** Equal-height, full-width controls across Calendar, Habits, Tasks and Projects. */
@Composable internal fun ConnectedSubmenu(items: List<SubmenuItem>, selectedId: String,
    onSelect: (String) -> Unit, modifier: Modifier = Modifier,
    connectToParent: Boolean = true) {
    val compact = LocalCompactSubmenus.current
    val framed = connectToParent && LocalSubmenuOutlineMode.current
    val glowPhase = if (connectToParent) LocalNavigationGlowPhase.current?.value ?: -1f else -1f
    val evening = LocalEveningTheme.current
    val frameColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha =
        if (evening) .62f else .76f)
    Column(modifier.fillMaxWidth().padding(start = if (compact) 8.dp else 12.dp,
        end = if (compact) 8.dp else 12.dp,
        top = if (compact) 6.dp else 8.dp, bottom = if (compact) 3.dp else 5.dp)
        .then(if (framed) Modifier.then(navigationSubmenuGroupAnchor())
            .border(1.dp, frameColor, RoundedCornerShape(19.dp))
            .padding(horizontal = 6.dp, vertical = 5.dp) else Modifier),
        verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 6.dp)) {
        items.chunked(if(items.size in 1..4) items.size else 3).forEachIndexed { rowIndex, row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEachIndexed { itemIndex, item ->
                    val picked = selectedId == item.id
                    val glow = if (glowPhase >= 0f) navigationGlowColor(
                        (glowPhase + (rowIndex * 3 + itemIndex) * .08f) % 1f, evening) else null
                    androidx.compose.material3.Surface(onClick = { onSelect(item.id) }, shape = RoundedCornerShape(14.dp),
                        color = selectedControlContainer(picked, fallback = item.accent?.let { androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surface,it,.17f) }
                            ?: if (glow != null) lerp(if (picked) MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surface, glow, if (picked) .10f else .045f)
                            else MaterialTheme.colorScheme.surface),
                        border = selectedControlBorder(picked, fallback = if (glow != null) BorderStroke(1.dp, Brush.horizontalGradient(listOf(
                            glow.copy(alpha = if (picked) .44f else .24f),
                            navigationGlowColor((glowPhase + .16f) % 1f, evening)
                                .copy(alpha = if (picked) .72f else .43f),
                            glow.copy(alpha = if (picked) .44f else .24f))))
                        else BorderStroke(1.dp, item.accent?.copy(alpha=if(picked) .9f else .55f)
                            ?: MaterialTheme.colorScheme.outlineVariant)),
                        modifier = Modifier.weight(1f).height(if (compact) 44.dp else 48.dp)
                            .testTag(item.tag ?: "submenu-${item.id}")
                            .semantics { selected = picked; role = Role.Tab }
                            .then(if (connectToParent) navigationSubmenuAnchor(item.id) else Modifier)) {
                        Row(Modifier.padding(horizontal = 5.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center) {
                            item.accent?.let { accent ->
                                androidx.compose.material3.Surface(Modifier.size(8.dp), color = accent,
                                    shape = RoundedCornerShape(50)) {}
                                Spacer(Modifier.width(5.dp))
                            }
                            Text(item.title, style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                                textAlign = TextAlign.Center,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                                color = if (picked) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
        }
    }
}
