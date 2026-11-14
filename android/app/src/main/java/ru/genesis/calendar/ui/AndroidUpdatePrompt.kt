package ru.genesis.calendar.ui

import android.app.DownloadManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import ru.genesis.calendar.ui.AlertDialog


import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import java.net.HttpURLConnection
import java.net.URL
import java.io.File
import java.io.IOException
import java.security.MessageDigest

internal data class AndroidRelease(val versionCode: Int, val versionName: String, val sha256: String,
    val required: Boolean = false)

internal fun newerAndroidRelease(body: String, installedCode: Int): AndroidRelease? {
    val json = JSONObject(body)
    val code = json.getInt("versionCode")
    val name = json.getString("versionName")
    val sha256 = json.getString("sha256")
    val minimumCode = json.optInt("minimumSupportedVersionCode", 0)
    require(code > 0 && Regex("[0-9]+(?:\\.[0-9]+){1,3}").matches(name) &&
        Regex("[a-fA-F0-9]{64}").matches(sha256) && minimumCode in 0..code) { "UPDATE_METADATA_INVALID" }
    if (code <= installedCode) return null
    return AndroidRelease(code, name, sha256.lowercase(), minimumCode > installedCode)
}

/** A stale offer may only advance to the current full release, never to an intermediate APK. */
internal fun latestAndroidRelease(offered: AndroidRelease, published: AndroidRelease?): AndroidRelease? {
    if (published == null) return null
    require(published.versionCode >= offered.versionCode) { "UPDATE_METADATA_ROLLBACK" }
    require(published.versionCode != offered.versionCode ||
        published.versionName == offered.versionName && published.sha256 == offered.sha256) { "UPDATE_METADATA_CHANGED" }
    return published
}

/** Never hand the package installer a partial download or an HTML error page. */
internal fun verifiedApk(file: File, expectedSha256: String): Boolean {
    if (!file.isFile || file.length() == 0L) return false
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val length = input.read(buffer)
            if (length < 0) break
            digest.update(buffer, 0, length)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) } == expectedSha256
}

internal fun updateInstallIntent(context: Context, apk: Uri): Intent =
    Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
        data = apk
        clipData = ClipData.newUri(context.contentResolver, "GENESIS update", apk)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

internal fun fetchAndroidRelease(): AndroidRelease? {
    val connection = URL("${ru.genesis.calendar.auth.AUTH_ORIGIN}/android-update.json?check=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
    connection.connectTimeout = 10_000
    connection.readTimeout = 12_000
    connection.useCaches = false
    connection.setRequestProperty("Cache-Control", "no-cache, no-store, max-age=0")
    connection.setRequestProperty("Pragma", "no-cache")
    try {
        if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IOException("UPDATE_CHECK_FAILED")
        val body = connection.inputStream.bufferedReader().use { reader ->
            val result = StringBuilder()
            val buffer = CharArray(1_024)
            while (result.length <= 8_192) {
                val count = reader.read(buffer, 0, minOf(buffer.size, 8_193 - result.length))
                if (count < 0) break
                result.append(buffer, 0, count)
            }
            result.toString()
        }
        if (body.length > 8_192) throw IOException("UPDATE_METADATA_INVALID")
        return newerAndroidRelease(body, BuildConfig.VERSION_CODE)
    } finally { connection.disconnect() }
}

/** Release discovery is public and must also work with expired or missing account sessions. */
@Composable
internal fun AndroidUpdatePrompt(context: Context, synchronizedAt: Long?, enabled: Boolean,
    offerOptional: Boolean = true) {
    if (!enabled) return
    if (BuildConfig.PLAY_DISTRIBUTION) { PlayUpdatePrompt(context,synchronizedAt);return }
    var release by remember { mutableStateOf<AndroidRelease?>(null) }
    var lastOffered by remember { mutableIntStateOf(0) }
    val resumeEpoch = rememberUpdateResumeEpoch()
    LaunchedEffect(enabled, synchronizedAt, offerOptional, resumeEpoch) {
        if (enabled) {
            val found = withContext(Dispatchers.IO) { runCatching(::fetchAndroidRelease).getOrNull() }
            if (found != null && (found.required || offerOptional && !BuildConfig.PLAY_DISTRIBUTION)
                && (found.required || found.versionCode != lastOffered)) {
                lastOffered = found.versionCode
                release = found
            }
        }
    }
    release?.let { offered ->
        AndroidUpdateDialog(context, offered) { release = null }
    }
}

@Composable
internal fun AndroidUpdateDialog(context: Context, release: AndroidRelease, onDismiss: () -> Unit) {
    val language=LocalGenesisLanguage.current
    val copy=appUpdateCopy(language)
    val downloads = remember(context) { context.getSystemService(DownloadManager::class.java) }
    val scope = rememberCoroutineScope()
    var target by remember(release) { mutableStateOf(release) }
    var checkingLatest by remember(release) { mutableStateOf(false) }
    var downloadId by remember(release) { mutableLongStateOf(0L) }
    var destination by remember(release) { mutableStateOf<File?>(null) }
    var downloaded by remember(release) { mutableStateOf<Uri?>(null) }
    var error by remember(release) { mutableStateOf(false) }
    var installError by remember(release) { mutableStateOf(false) }
    var verifying by remember(release) { mutableStateOf(false) }
    LaunchedEffect(downloadId) {
        if (downloadId <= 0) return@LaunchedEffect
        while (true) {
            val status = withContext(Dispatchers.IO) {
                downloads.query(DownloadManager.Query().setFilterById(downloadId)).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    else DownloadManager.STATUS_FAILED
                }
            }
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    verifying = true
                    val file = destination
                    val valid = withContext(Dispatchers.IO) {
                        file != null && runCatching { verifiedApk(file, target.sha256) }.getOrDefault(false)
                    }
                    if (valid && file != null) {
                        downloaded = runCatching {
                            FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                        }.getOrNull()
                    }
                    verifying = false
                    if (downloaded == null) {
                        downloads.remove(downloadId)
                        downloadId = 0L
                        destination = null
                        error = true
                    }
                    break
                }
                DownloadManager.STATUS_FAILED -> {
                    downloads.remove(downloadId)
                    downloadId = 0L
                    destination = null
                    error = true
                    break
                }
            }
            delay(1_000)
        }
    }
    AlertDialog(onDismissRequest = { if (!target.required) onDismiss() },
        properties = DialogProperties(dismissOnBackPress = !target.required,
            dismissOnClickOutside = !target.required),
        title = { Text(if (target.required) "Обновите GENESIS до ${target.versionName}"
            else "${genesisTranslate("Доступна новая версия GENESIS")} ${target.versionName}") },
        text = {
            Text(when {
                checkingLatest -> "Проверяем обновления…"
                installError -> "Не удалось открыть установщик Android. Попробуйте ещё раз."
                error -> "Не удалось скачать обновление. Проверьте соединение и попробуйте снова."
                downloaded != null -> "Обновление скачано. Установите его через системный установщик Android."
                downloadId > 0 -> "Скачиваем обновление…"
                target.required -> "Поддержка установленной версии завершена. Синхронизация сохранённых данных доступна; для дальнейшей работы установите обновление."
                else -> "Доступно обновление приложения. Скачайте его прямо здесь."
            })
        },
        confirmButton = {
            Button(onClick = {
                if (BuildConfig.PLAY_DISTRIBUTION) {
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=ru.genesis.calendar"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure { installError = true }
                    return@Button
                }
                scope.launch {
                    checkingLatest = true
                    error = false; installError = false
                    try {
                        val latest = withContext(Dispatchers.IO) { latestAndroidRelease(target, fetchAndroidRelease()) }
                        if (latest == null) { onDismiss(); return@launch }
                        if (latest.versionCode != target.versionCode) {
                            if (downloadId > 0L) downloads.remove(downloadId)
                            downloadId = 0L; destination = null; downloaded = null
                        }
                        target = latest
                        val file = downloaded
                        if (file != null) {
                            installError = false
                            if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
                                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:${context.packageName}"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            } else {
                                runCatching {
                                    context.startActivity(updateInstallIntent(context, file))
                                }.onFailure { installError = true }
                            }
                        } else if (downloadId == 0L || error) {
                            error = false
                            runCatching {
                                val name = "GENESIS-${latest.versionName}-${System.currentTimeMillis()}.apk"
                                val directory = requireNotNull(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS))
                                val file = File(directory, name)
                                val request = DownloadManager.Request(Uri.parse(
                                    "${ru.genesis.calendar.auth.AUTH_ORIGIN}/downloads/GENESIS-Android-Native-${latest.versionName}.apk"))
                                    .setTitle("GENESIS ${latest.versionName}")
                                    .setDescription(translateGenesisText(context,"Обновление приложения",language))
                                    .setMimeType("application/vnd.android.package-archive")
                                    // A completed system notification opens the APK directly, bypassing
                                    // the fresh-release check above. Installation stays in this dialog.
                                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                                    .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
                                destination = file
                                downloadId = downloads.enqueue(request)
                            }.onFailure { error = true; downloadId = 0L; destination = null }
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { error = true }
                    finally { checkingLatest = false }
                }
            }, enabled = !checkingLatest && !verifying && (downloadId == 0L || downloaded != null),
                modifier = Modifier.testTag("android-update-download")) {
                Text(if (checkingLatest) genesisTranslate("Проверяем обновления…") else if (BuildConfig.PLAY_DISTRIBUTION) genesisTranslate("Обновить в Google Play") else if (downloaded != null) genesisTranslate("Установить")
                    else if (downloadId > 0 && !error) genesisTranslate("Скачивается…") else copy.action,translate=false)
            }
        },
        dismissButton = { if (!target.required) TextButton(onClick = onDismiss) { Text(copy.later,translate=false) } },
        modifier = Modifier.testTag("android-update-dialog"))
}
