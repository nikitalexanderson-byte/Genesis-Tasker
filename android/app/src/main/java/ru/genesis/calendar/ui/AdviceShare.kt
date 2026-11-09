package ru.genesis.calendar.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.text.LineBreaker
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.FileProvider
import ru.genesis.calendar.auth.DailyAdvice
import java.io.File
import java.text.BreakIterator
import java.util.Locale
import java.util.UUID
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.size
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal const val adviceApplicationUrl = "https://genesiscalendar.com"
private const val adviceShareWidth = 1080
private const val adviceShareInset = 64

/** Fit an indivisible word instead of letting StaticLayout split it across lines. */
internal fun adviceShareTextLayout(text: String, size: Float, bold: Boolean = false,
    language: String = "ru"): StaticLayout {
    val availableWidth = adviceShareWidth - adviceShareInset * 2
    val locale = Locale.forLanguageTag(language)
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(255, 253, 248); textSize = size; textLocale = locale
        typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
    }
    val breaks = BreakIterator.getLineInstance(locale).apply { setText(text) }
    var start = breaks.first()
    var end = breaks.next()
    var widestWord = 0f
    while (end != BreakIterator.DONE) {
        widestWord = maxOf(widestWord, paint.measureText(text.substring(start, end).trim()))
        start = end; end = breaks.next()
    }
    if (widestWord > availableWidth) paint.textSize *= (availableWidth - 1f) / widestWord
    return StaticLayout.Builder.obtain(text, 0, text.length, paint, availableWidth)
        .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false)
        .setBreakStrategy(LineBreaker.BREAK_STRATEGY_SIMPLE)
        .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
        .setLineSpacing(paint.textSize * .25f, 1f).build()
}

@Composable internal fun AdviceShareButton(advice: DailyAdvice, artwork: Bitmap?, copy: JSONObject,
    authorize: (suspend () -> DailyAdvice)? = null, onFailure: (Boolean) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preparing by remember(advice.id) { mutableStateOf(false) }
    androidx.compose.material3.IconButton(onClick = {
        preparing = true; onFailure(false)
        scope.launch {
            try {
                val permitted = if ("psychopompia" in advice.categories || advice.containsAlcohol == true) {
                    val checked = requireNotNull(authorize).invoke()
                    require(checked.id == advice.id && checked.day == advice.day && checked.collection == advice.collection)
                    checked
                } else advice
                val intent = withContext(Dispatchers.IO) { adviceShareIntent(context, permitted, artwork) }
                context.startActivity(Intent.createChooser(intent, copy.getString("share")))
            } catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { onFailure(true) }
            finally { preparing = false }
        }
    }, enabled = !preparing, modifier = Modifier.size(48.dp).testTag("daily-advice-share")
        .semantics { contentDescription = copy.getString(if (preparing) "sharePreparing" else "share") }) {
        if (preparing) WorkspaceLoadingIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        else GenesisLucideIcon("share-2")
    }
}

/** One illustrated image: complete text and source credits sit on the artwork itself. */
internal fun adviceShareBitmap(advice: DailyAdvice, artwork: Bitmap?): Bitmap {
    val width = adviceShareWidth
    val inset = adviceShareInset
    val title = adviceShareTextLayout(advice.title, 48f, true, advice.language)
    val philosophy = if (advice.collection == "philosophers") philosopherQuoteParts(advice.body, advice.sources.firstOrNull()?.author.orEmpty()) else null
    val bodyText = philosophy?.let { listOf(it.context, compactAdviceBody(it.quote), if (it.author.isNotBlank()) "(${it.author})" else "")
        .filter { it.isNotBlank() }.joinToString("\n\n") } ?: compactAdviceBody(advice.body)
    val body = adviceShareTextLayout(bodyText, 36f, language = advice.language)
    val sourceText = advice.sources.joinToString("\n") { source ->
        listOf(if (philosophy?.author.isNullOrBlank()) source.author else "", source.work, source.reference).filter { it.isNotBlank() }.joinToString(" · ")
    }
    val sources = if (sourceText.isNotBlank()) adviceShareTextLayout(sourceText, 26f, language = advice.language) else null
    val sections = listOfNotNull(title, body, sources)
    val textHeight = sections.sumOf { it.height } + (sections.size - 1) * 28
    val height = maxOf(1080, inset + textHeight + 160)
    require(height <= 20_000) { "ADVICE_SHARE_TOO_LARGE" }
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.rgb(11, 21, 17))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    if (artwork != null) {
        // Preserve the source artwork's proportions while filling the shared picture.
        val scale = maxOf(width.toFloat() / artwork.width, height.toFloat() / artwork.height)
        val artWidth = artwork.width * scale; val artHeight = artwork.height * scale
        canvas.drawBitmap(artwork, null, RectF((width - artWidth) / 2f, (height - artHeight) / 2f,
            (width + artWidth) / 2f, (height + artHeight) / 2f), paint)
    }
    // Even a bright original stays readable; no separate paper block is added below it.
    paint.shader = LinearGradient(0f, 0f, 0f, height.toFloat(),
        intArrayOf(Color.argb(176, 6, 15, 14), Color.argb(220, 6, 15, 14)), null, Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    paint.shader = null
    var y = inset.toFloat()
    for (section in sections) {
        canvas.save(); canvas.translate(inset.toFloat(), y); section.draw(canvas); canvas.restore()
        y += section.height + 28
    }
    paint.color = Color.rgb(228, 199, 140); paint.textSize = 26f
    paint.typeface = Typeface.create("sans-serif", Typeface.NORMAL); paint.textAlign = Paint.Align.CENTER
    canvas.drawText("GENESIS · genesiscalendar.com", width / 2f, height - 52f, paint)
    return bitmap
}

internal fun adviceShareIntent(context: Context, advice: DailyAdvice, artwork: Bitmap?): Intent {
    val directory = File(context.cacheDir, "advice-shares")
    check(directory.isDirectory || directory.mkdirs())
    directory.listFiles()?.filter { it.name.endsWith(".png") && it.lastModified() < System.currentTimeMillis() - 86_400_000 }
        ?.forEach { it.delete() }
    val file = File(directory, "GENESIS-advice-${UUID.randomUUID()}.png")
    val image = artwork ?: advice.image?.let { requireNotNull(DailyAdviceArtwork.load(context,it)) }
    val bitmap = adviceShareBitmap(advice, image)
    try { file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
    finally { bitmap.recycle() }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
    return Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, "GENESIS\n" + adviceApplicationUrl)
        putExtra(Intent.EXTRA_SUBJECT, advice.title)
        clipData = ClipData.newUri(context.contentResolver, advice.title, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
