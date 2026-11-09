package ru.genesis.calendar.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.activity
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.R
import com.yandex.authsdk.YandexAuthLoginOptions
import com.yandex.authsdk.YandexAuthOptions
import com.yandex.authsdk.YandexAuthResult
import com.yandex.authsdk.YandexAuthSdk

private val welcomeNight = Color(0xFF07171B)
private val welcomeGreen = Color(0xFF103134)
private val welcomeGold = Color(0xFFC8A45E)
private val welcomeCream = Color(0xFFF6F0DF)
private val welcomeMuted = Color(0xFFB8C9C2)

/** A single Google entry for the account used throughout GENESIS. */
@Composable
fun WelcomeScreen(state: AuthPanelState, controller: AuthController, language: String,
    preferredLanguage: String? = null, onLanguage: (String) -> Unit) {
    val context = LocalContext.current
    val activity = context.activity()
    WelcomeContent(state, language, onLanguage,
        onSignIn = { activity?.let { controller.signIn(it, preferredLanguage) } },
        signInEnabled = activity != null, onRetry = controller::checkSession,
        onWeb = { openWebsite(context) },
        onLegal = { path -> context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.GENESIS_ORIGIN + path))) })
}

@Composable internal fun WelcomeContent(state: AuthPanelState, language: String, onLanguage: (String) -> Unit,
    onSignIn: () -> Unit, signInEnabled: Boolean = true, onRetry: () -> Unit, onWeb: () -> Unit,
    onLegal: (String) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Brush.verticalGradient(
        listOf(welcomeNight, welcomeGreen, welcomeNight))).safeDrawingPadding().testTag("genesis-welcome")) {
        @Composable fun Intro() {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                OriginalImage("icons/icon-192.png", "GENESIS", Modifier.size(44.dp))
                Text("Genesis Tasker", Modifier.padding(start = 10.dp), color = welcomeCream,
                    style = MaterialTheme.typography.titleLarge.copy(fontFamily = GenesisHeadingFont))
            }
            Text("Выбор языка", color = welcomeMuted, style = MaterialTheme.typography.labelMedium)
            LanguageChips(language, dark = true, flagsOnly = true, onLanguage = onLanguage)
            HorizontalDivider(color = welcomeGold.copy(alpha = .24f))
            androidx.compose.foundation.text.BasicText(genesisTranslate("Календарь задач и проектов"),
                Modifier.fillMaxWidth().testTag("welcome-purpose-title"), maxLines = 1, softWrap = false,
                style = MaterialTheme.typography.headlineLarge.copy(color = welcomeGold,
                    fontFamily = GenesisHeadingFont, fontStyle = FontStyle.Italic),
                autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = 14.sp, maxFontSize = 32.sp))
            Text("Планируйте задачи, проекты и повторяющиеся практики. Личное пространство синхронизируется с сайтом и вашими устройствами.",
                Modifier.testTag("welcome-intro"), color = welcomeMuted, style = MaterialTheme.typography.bodyLarge)
        }
        @Composable fun SignIn() {
            Surface(Modifier.fillMaxWidth().testTag("welcome-auth-card"), shape = AffairsLayout.shape,
                color = welcomeGreen, border = BorderStroke(1.dp, welcomeGold.copy(alpha = .4f))) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        WelcomeMeaningIcon("lock-keyhole", "account")
                        Text("Войти в GENESIS", color = welcomeCream,
                            style = MaterialTheme.typography.titleLarge.copy(fontFamily = GenesisHeadingFont))
                    }
                    Text("Вход через Google открывает ваши данные GENESIS. Подключение календаря и задач выполняется отдельно.",
                        color = welcomeMuted, style = MaterialTheme.typography.bodyMedium)
                    if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth(), color = welcomeGold, trackColor = welcomeNight)
                    if (state.checkedAt == null || state.message !in setOf("На сервере нет активного входа.", "Серверная сессия ещё не проверена.")) {
                        Text(if (state.checkedAt == null) "Проверяем аккаунт…" else state.message,
                            Modifier.testTag("welcome-status"), color = welcomeMuted, style = MaterialTheme.typography.bodySmall)
                    }
                    if (state.user == null) ProviderSignInIcon("google", Color.White, Color(0xFF202124),
                        genesisTranslate("Войти через Google"), "welcome-google-sign-in", !state.busy && signInEnabled,
                        Modifier.fillMaxWidth(), onSignIn)
                    else Button(onRetry, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                        .testTag("welcome-google-sign-in"), colors = ButtonDefaults.buttonColors(containerColor = welcomeGold, contentColor = welcomeNight)) {
                        Text(if (state.busy) "Проверяем аккаунт…" else "Повторить синхронизацию")
                    }
                    TextButton(onWeb, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("welcome-open-web")) {
                        Text("Открыть веб-версию", color = welcomeMuted, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                WelcomeTrustLine("calendar-days", "Календарь и задачи на ваших устройствах")
                WelcomeTrustLine("network", "Защищённая структура проектов")
                WelcomeTrustLine("shield-check", "Личное пространство после входа")
            }
        }
        @Composable fun Legal() {
            Column(Modifier.fillMaxWidth().testTag("welcome-legal"), horizontalAlignment = Alignment.CenterHorizontally) {
                TextButton({ onLegal("/terms") }, Modifier.heightIn(min = 48.dp).testTag("welcome-terms")) {
                    Text("Пользовательское соглашение", color = welcomeMuted, style = MaterialTheme.typography.labelMedium)
                }
                TextButton({ onLegal("/privacy") }, Modifier.heightIn(min = 48.dp).testTag("welcome-privacy")) {
                    Text("Политика конфиденциальности", color = welcomeMuted, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        if (maxWidth >= 760.dp) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { Intro() }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { SignIn() }
            }
            Legal()
        } else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)) { Intro(); SignIn(); Legal() }
    }
}

@Composable private fun WelcomeMeaningIcon(icon: String, tag: String) {
    val enabled = android.animation.ValueAnimator.areAnimatorsEnabled()
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(icon) { entered = true }
    val scale by androidx.compose.animation.core.animateFloatAsState(if (entered || !enabled) 1f else .8f,
        animationSpec = androidx.compose.animation.core.tween(if (enabled) 350 else 0), label = "welcome-$tag")
    Surface(Modifier.size(44.dp).testTag("welcome-icon-$tag"), shape = AffairsLayout.controlShape,
        color = welcomeNight, border = BorderStroke(1.dp, welcomeGold.copy(alpha = .4f))) {
        Box(contentAlignment = Alignment.Center) {
            GenesisLucideIcon(icon, Modifier.size(26.dp).graphicsLayer { scaleX = scale; scaleY = scale }, welcomeGold)
        }
    }
}
@Composable
private fun ProviderSignInIcon(provider: String, background: Color, foreground: Color,
    description: String, tag: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled,
        modifier = modifier.heightIn(min = 56.dp).testTag(tag)
            .semantics { contentDescription = description },
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, welcomeGold.copy(alpha = .42f)),
        contentPadding = PaddingValues(horizontal = 8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = background, contentColor = foreground)) {
        if (provider == "google") Image(painterResource(R.drawable.google_signin_mark), null,
            Modifier.size(30.dp))
        else Surface(Modifier.size(30.dp), shape = CircleShape, color = Color(0xFFE32924)) {
            Box(contentAlignment = Alignment.Center) {
                Text("Я", color = Color.White,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            }
        }
        Spacer(Modifier.width(5.dp))
        Text(description, color = foreground,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            textAlign = TextAlign.Start, maxLines = 2)
    }
}

@Composable
private fun WelcomeTrustLine(symbol: String, text: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        WelcomeMeaningIcon(symbol, symbol)
        Text(text, Modifier.weight(1f), color = welcomeMuted,
            style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun LanguageChips(language: String, dark: Boolean = false, flagsOnly: Boolean = false,
    onLanguage: (String) -> Unit) {
    val languages = listOf(Triple("ru", "🇷🇺", "Русский"), Triple("en", "🇬🇧", "English"),
            Triple("el", "🇬🇷", "Ελληνικά"), Triple("de", "🇩🇪", "Deutsch"),
            Triple("fr", "🇫🇷", "Français"), Triple("es", "🇪🇸", "Español"),
            Triple("it", "🇮🇹", "Italiano"), Triple("pt", "🇵🇹", "Português"),
            Triple("pl", "🇵🇱", "Polski"), Triple("sr", "🇷🇸", "Српски"),
            Triple("uk", "🇺🇦", "Українська"), Triple("zh", "🇨🇳", "简体中文"),
            Triple("tr", "🇹🇷", "Türkçe"), Triple("ja", "🇯🇵", "日本語"))
    if (flagsOnly) {
        val night = dark || LocalEveningTheme.current
        val selection = genesisSelectionColors(if (night) eveningPalette(LocalDarkPalette.current) else MaterialTheme.colorScheme,night)
        BoxWithConstraints(Modifier.fillMaxWidth().testTag("welcome-language-grid")) {
            // Keep complete rows as languages are added; compact cells still have a 48 dp height.
            val columns = balancedLanguageColumns(languages.size, ((maxWidth.value + 2f) / 46f).toInt())
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                languages.chunked(columns).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        row.forEach { (value, flag, label) ->
                            val active = language == value
                            Surface(onClick = { onLanguage(value) },
                                modifier = Modifier.weight(1f).height(48.dp).testTag("language-$value")
                                    .semantics {
                                        contentDescription = label
                                        role = Role.RadioButton
                                        selected = active
                                    },
                                shape = RoundedCornerShape(10.dp),
                                color = if (active) selection.container else if (night) welcomeGreen else MaterialTheme.colorScheme.surface,
                                border = BorderStroke(if (active) 2.dp else 1.dp, if (active) selection.outline
                                    else if (night) welcomeMuted else MaterialTheme.colorScheme.outlineVariant)) {
                                Box(contentAlignment = Alignment.Center) {
                                    UntranslatedText(flag, fontSize = 20.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)) {
        languages.forEach { (value, flag, label) ->
                FilterChip(selected = language == value, onClick = { onLanguage(value) },
                    label = {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            UntranslatedText(flag)
                            if (!flagsOnly) UntranslatedText(label)
                        }
                    },
                    colors = if (dark) FilterChipDefaults.filterChipColors(
                        containerColor = welcomeGreen,
                        labelColor = welcomeCream,
                        selectedContainerColor = Color(0xFF2E7770),
                        selectedLabelColor = Color.White) else FilterChipDefaults.filterChipColors(),
                    modifier = Modifier.heightIn(min = 48.dp).testTag("language-$value")
                        .semantics { contentDescription = label })
            }
    }
    }
}

internal fun balancedLanguageColumns(count: Int, availableColumns: Int): Int =
    (minOf(count, availableColumns.coerceAtLeast(1), 7) downTo 1).first { count % it == 0 }

private fun openWebsite(context: Context) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW,
        Uri.parse("${ru.genesis.calendar.auth.AUTH_ORIGIN}/")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
