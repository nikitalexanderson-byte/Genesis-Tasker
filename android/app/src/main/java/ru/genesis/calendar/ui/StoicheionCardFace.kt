package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

/** Native layers matching StoicheionCardFace on the site: painting, Greek-key frame, title, sigil, body and invocation. */
@Composable
internal fun StoicheionCardFace(letter: StoicheionLetter, modifier: Modifier = Modifier) {
    // The painting is always dark, including inside a light app palette.
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
    BoxWithConstraints(modifier.aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp))
        .background(Color(0xff06191c)).testTag("stoicheion-face-${letter.id}")) {
        val width = maxWidth
        val height = maxHeight
        OriginalImage("stoicheion-cards/${letter.id}.webp", "Живописная основа карты ${letter.name}",
            Modifier.matchParentSize())
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(
            Color(0xe6010a0c), Color(0x40010a0c), Color.Transparent,
            Color.Transparent, Color(0x6e010a0c), Color(0xf0010a0c)))))
        Canvas(Modifier.matchParentSize()) { drawGreekKeyFrame() }
        val titleSize = max(10f, min(18f, width.value * .072f)).sp
        Text("${letter.order.toString().padStart(2, '0')}  ${letter.name.uppercase()}",
            Modifier.align(Alignment.TopCenter).padding(top = height * .083f).width(width * .72f)
                .background(Brush.horizontalGradient(listOf(Color.Transparent, Color(0xd1021012), Color(0xd1021012), Color.Transparent)))
                .padding(vertical = height * .012f),
            color = Color(0xfff3e5c0), fontFamily = GenesisHeadingFont, fontWeight = FontWeight.SemiBold,
            fontSize = titleSize, textAlign = TextAlign.Center, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        Row(Modifier.align(Alignment.TopCenter).padding(top = height * .165f)
            .size(width * .27f).border(width * .008f, letter.accent.copy(alpha = .82f), CircleShape)
            .background(Brush.radialGradient(listOf(letter.accent.copy(alpha = .45f), Color(0xf0071c1f))), CircleShape),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text(letter.symbol, color = Color(0xfff4dda0), fontFamily = GenesisHeadingFont,
                fontSize = max(30f, min(50f, width.value * .19f)).sp)
            Text(letter.lowercase, color = letter.accent, fontFamily = GenesisHeadingFont,
                fontSize = max(12f, width.value * .07f).sp)
        }
        Column(Modifier.align(Alignment.BottomCenter).padding(bottom = height * .068f)
            .width(width * .76f).background(Brush.horizontalGradient(listOf(
                Color(0x73020f11), Color(0xeb020f11), Color(0xeb020f11), Color(0x73020f11))))
            .border(width * .004f, letter.accent.copy(alpha = .55f))
            .padding(vertical = height * .012f, horizontal = width * .018f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(height * .003f)) {
            Text(letter.body.uppercase(), color = Color(0xfff5e6c3), fontFamily = GenesisHeadingFont,
                fontWeight = FontWeight.SemiBold, fontSize = max(8f, min(14f, width.value * .057f)).sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(letter.bodyGreek, color = Color(0xfff4dda0), fontFamily = GenesisHeadingFont,
                fontSize = max(8f, min(12f, width.value * .05f)).sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(letter.invocation, color = Color(0xffc7bca4), fontFamily = GenesisHeadingFont,
                fontSize = max(7f, min(10f, width.value * .034f)).sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
    }
}
}

/** Same 512×768 border geometry and Greek-key rhythm as public/stoicheion-cards/frame-greek-key.svg. */
private fun DrawScope.drawGreekKeyFrame() {
    val sx = size.width / 512f
    val sy = size.height / 768f
    val gold = Color(0xffdec47f)
    val dark = Color(0xff06191c)
    withTransform({ scale(sx, sy, pivot = Offset.Zero) }) {
        drawRoundRect(dark, Offset(7f, 7f), Size(498f, 754f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(24f), style = Stroke(14f))
        drawRoundRect(Brush.linearGradient(listOf(Color(0xfff0d999), Color(0xffad8240), Color(0xffe3c783))),
            Offset(8f, 8f), Size(496f, 752f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(23f), style = Stroke(3f))
        drawRoundRect(gold.copy(alpha = .72f), Offset(18f, 18f), Size(476f, 732f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(17f), style = Stroke(1.5f))
        drawRect(dark.copy(alpha = .78f), Offset(24f, 24f), Size(464f, 36f))
        drawRect(dark.copy(alpha = .78f), Offset(24f, 708f), Size(464f, 36f))
        drawRect(dark.copy(alpha = .78f), Offset(24f, 60f), Size(36f, 648f))
        drawRect(dark.copy(alpha = .78f), Offset(452f, 60f), Size(36f, 648f))
        drawRect(gold, Offset(24f, 24f), Size(464f, 720f), style = Stroke(4.6f))
        drawRect(gold, Offset(60f, 60f), Size(392f, 648f), style = Stroke(4.6f))
        repeat(12) { i ->
            val x = 60f + i * (392f / 12f)
            drawHorizontalKey(x, 28f, false, gold)
            drawHorizontalKey(x, 708f, true, gold)
        }
        repeat(20) { i ->
            val y = 60f + i * (648f / 20f)
            drawVerticalKey(28f, y, false, gold)
            drawVerticalKey(452f, y, true, gold)
        }
        listOf(32f to 32f, 460f to 32f, 32f to 716f, 460f to 716f).forEach { (x, y) ->
            drawRect(gold, Offset(x, y), Size(20f, 20f), style = Stroke(4.6f))
        }
    }
}

private fun DrawScope.drawHorizontalKey(x: Float, y: Float, mirrored: Boolean, color: Color) {
    val unitX = 392f / 12f / 40f
    val unitY = 32f / 35f
    fun px(n: Float) = x + n * unitX
    fun py(n: Float) = y + (if (mirrored) 35f - n else n) * unitY
    val path = Path().apply {
        moveTo(px(0f), py(0f)); lineTo(px(0f), py(35f)); lineTo(px(40f), py(35f))
        moveTo(px(10f), py(0f)); lineTo(px(10f), py(15f)); lineTo(px(30f), py(15f)); lineTo(px(30f), py(35f))
        moveTo(px(40f), py(5f)); lineTo(px(20f), py(5f)); lineTo(px(20f), py(25f)); lineTo(px(0f), py(25f))
    }
    drawPath(path, color, style = Stroke(4.6f))
}

private fun DrawScope.drawVerticalKey(x: Float, y: Float, mirrored: Boolean, color: Color) {
    val ux = 32f / 35f
    val uy = (648f / 20f) / 40f
    fun px(n: Float) = x + (if (mirrored) 35f - n else n) * ux
    fun py(n: Float) = y + n * uy
    val path = Path().apply {
        moveTo(px(0f), py(0f)); lineTo(px(35f), py(0f)); lineTo(px(35f), py(40f))
        moveTo(px(0f), py(10f)); lineTo(px(15f), py(10f)); lineTo(px(15f), py(30f)); lineTo(px(35f), py(30f))
        moveTo(px(5f), py(40f)); lineTo(px(5f), py(20f)); lineTo(px(25f), py(20f)); lineTo(px(25f), py(0f))
    }
    drawPath(path, color, style = Stroke(4.6f))
}
