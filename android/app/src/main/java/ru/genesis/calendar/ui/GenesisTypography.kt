package ru.genesis.calendar.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ru.genesis.calendar.R

/** Full original Google Fonts TTFs, bundled for offline Cyrillic and Latin text. */
@OptIn(ExperimentalTextApi::class)
private fun genesisVariableFamily(resource: Int, opticalSize: Float): FontFamily = FontFamily(
    listOf(400, 500, 600, 700).map { weight ->
        Font(resource, weight = FontWeight(weight), variationSettings = FontVariation.Settings(
            FontVariation.weight(weight), FontVariation.opticalSizing(opticalSize.sp)))
    }
)

/** One licensed UI family across controls, reading and headings, including explicit overrides. */
internal val GenesisUiFont = genesisVariableFamily(R.font.inter, 14f)
internal val GenesisBodyFont = GenesisUiFont
internal val GenesisHeadingFont = GenesisUiFont

private fun genesisTextStyle(size: Int, line: Int,
    weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = GenesisUiFont,
    fontWeight = weight, fontSize = size.sp, lineHeight = line.sp,
    letterSpacing = 0.sp, platformStyle = PlatformTextStyle(includeFontPadding = false)
)

/** GENESIS 3.2.4: Inter for every UI role; semantic Greek symbols retain their content. */
val GenesisTypography = Typography(
    displayLarge = genesisTextStyle(42, 48, FontWeight.SemiBold),
    displayMedium = genesisTextStyle(36, 42, FontWeight.SemiBold),
    displaySmall = genesisTextStyle(30, 36, FontWeight.SemiBold),
    headlineLarge = genesisTextStyle(28, 34, FontWeight.SemiBold),
    headlineMedium = genesisTextStyle(25, 31, FontWeight.SemiBold),
    headlineSmall = genesisTextStyle(22, 28, FontWeight.SemiBold),
    titleLarge = genesisTextStyle(20, 26, FontWeight.SemiBold),
    titleMedium = genesisTextStyle(size = 16, line = 22, weight = FontWeight.SemiBold),
    titleSmall = genesisTextStyle(size = 14, line = 20, weight = FontWeight.SemiBold),
    bodyLarge = genesisTextStyle(size = 16, line = 24),
    bodyMedium = genesisTextStyle(size = 14, line = 21),
    bodySmall = genesisTextStyle(size = 12, line = 18),
    labelLarge = genesisTextStyle(size = 14, line = 20, weight = FontWeight.SemiBold),
    labelMedium = genesisTextStyle(size = 12, line = 18, weight = FontWeight.Medium),
    labelSmall = genesisTextStyle(size = 11, line = 16, weight = FontWeight.Medium)
)

