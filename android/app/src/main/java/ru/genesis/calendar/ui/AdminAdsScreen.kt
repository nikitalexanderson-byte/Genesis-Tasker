package ru.genesis.calendar.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AdminGateway
import ru.genesis.calendar.auth.AdminProtocol
import ru.genesis.calendar.data.AdminDraftRepository
import java.time.ZoneId
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.Base64
import java.util.UUID

@Composable
internal fun AdminAdsScreen(gateway: AdminGateway, closeSignal: Int = 0, use24: Boolean = true, onClose: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as GenesisApplication
    val uid = LocalGenesisUserId.current
    val scope = rememberCoroutineScope()
    val repository = remember(app, uid, gateway) { AdminDraftRepository(app, uid, gateway) }
    val zone = remember { ZoneId.systemDefault() }
    fun emptyState(generation: Long = 0) = JSONObject().put("schemaVersion", 1).put("draftId", UUID.randomUUID().toString()).put("generation", generation)
        .put("form", AdminProtocol.emptyForm()).put("editingId", "").put("baseline", "").put("zoneId", zone.id).put("sentBody", JSONObject.NULL)
    var stateJson by remember(repository) { mutableStateOf(emptyState().toString()) }
    var persisted by remember(repository) { mutableStateOf(stateJson) }
    var ads by remember(gateway) { mutableStateOf(emptyList<JSONObject>()) }
    var ready by remember { mutableStateOf(false) }
    var storageBlocked by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<JSONObject?>(null) }
    var editTarget by remember { mutableStateOf<JSONObject?>(null) }
    val state = JSONObject(stateJson); val form = state.getJSONObject("form")
    val formZone = ZoneId.of(state.optString("zoneId", zone.id))
    val editing = state.optString("editingId").takeIf(String::isNotBlank)
    val pending = state.optJSONObject("sentBody")
    val dirty = editing != null || pending != null || form.toString() != AdminProtocol.emptyForm().toString()
    fun change(key: String, value: Any) { stateJson = JSONObject(stateJson).apply { put("generation", getLong("generation") + 1); getJSONObject("form").put(key, value) }.toString(); error = ""; message = "" }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""; message = ""
        scope.launch { try { gateway.check(); action(); gateway.check() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = adminError(failure.message) } finally { busy = false } }
    }
    suspend fun persist(snapshot: String = stateJson, required: Boolean = false) {
        val saved = repository.save(JSONObject(snapshot)); if (required) require(saved) { "ADMIN_DRAFT_CHANGED" }
        if (saved && stateJson == snapshot) persisted = snapshot
    }
    fun accept(row: JSONObject) {
        stateJson = emptyState(JSONObject(stateJson).getLong("generation") + 1).put("form", AdminProtocol.form(row, zone)).put("editingId", row.getString("id"))
            .put("baseline", AdminProtocol.fingerprint(row)).toString()
    }
    suspend fun refresh() {
        val array = gateway.ads().getJSONArray("ads"); require(array.length() <= 5000)
        val next = (0 until array.length()).map { array.getJSONObject(it).also { ad -> AdminProtocol.adId(ad.getString("id")); AdminProtocol.fingerprint(ad) } }
        ads = next
        val current = JSONObject(stateJson); val sent = current.optJSONObject("sentBody")
        if (sent != null) {
            val currentId = current.optString("editingId")
            val known = sent.optJSONArray("knownIds")?.let { (0 until it.length()).map(it::getString).toSet() }.orEmpty()
            val matches = next.filter { (if (currentId.isBlank()) it.getString("id") !in known else it.getString("id") == currentId) && AdminProtocol.fingerprint(it) == sent.getString("fingerprint") }
            if (matches.size == 1) { accept(matches.single()); persist(); message = "Сервер подтвердил сохранённое объявление." }
        }
    }
    fun close() { if (!busy) { if (storageBlocked) onClose() else run { persist(); onClose() } } }
    BackHandler(onBack = ::close)
    LaunchedEffect(closeSignal) { if (closeSignal > 0) close() }
    LaunchedEffect(repository) {
        busy = true
        try { repository.load()?.let { stateJson = it.toString(); persisted = stateJson } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { storageBlocked = true; error = "Не удалось прочитать защищённый черновик рекламы. Сохранённая запись не изменена." }
        try { if (!storageBlocked) { refresh(); ready = true } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = adminError(failure.message) }
        finally { busy = false }
    }
    LaunchedEffect(stateJson, ready, busy) {
        if (!ready || busy || stateJson == persisted) return@LaunchedEffect
        val snapshot = stateJson; delay(300)
        try { persist(snapshot) } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "Черновик рекламы не сохранён. Повторите сохранение перед выходом." }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && !busy && pending == null) run {
            val data = withContext(Dispatchers.IO) {
                val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
                    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while (true) { val count = stream.read(buffer); if (count < 0) break; require(output.size() + count <= 500_000) { "ADMIN_AD_IMAGE_INVALID" }; output.write(buffer, 0, count) }
                    output.toByteArray()
                } ?: error("ADMIN_AD_IMAGE_INVALID")
                try {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    require(bounds.outWidth in 1..3000 && bounds.outHeight in 1..3000 && bounds.outMimeType in setOf("image/png", "image/jpeg", "image/webp")) { "ADMIN_AD_IMAGE_INVALID" }
                    "data:${bounds.outMimeType};base64," + Base64.getEncoder().encodeToString(bytes)
                } finally { bytes.fill(0) }
            }
            change("imageData", data); change("imageUrl", ""); persist()
        }
    }
    val previewSource = form.optString("imageData").ifBlank { form.optString("imageUrl") }
    val preview by produceState<android.graphics.Bitmap?>(null, previewSource) {
        value = null
        if (previewSource.isNotBlank()) { delay(300); value = withContext(Dispatchers.IO) { runCatching { genesisImageBitmap(previewSource, 1000) }.getOrNull() } }
    }
    val enabled = ready && !storageBlocked && !busy && pending == null
    Column(Modifier.fillMaxWidth().testTag("native-admin-ads")) {
        AffairsPageHeader("Управление рекламой", "Админ-панель", onBack = ::close)
        if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        if (error.isNotBlank()) Text(error, Modifier.padding(8.dp), color = MaterialTheme.colorScheme.error)
        if (message.isNotBlank()) Text(message, Modifier.padding(8.dp), color = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Реклама в разделе «Сегодня»", style = MaterialTheme.typography.titleMedium)
            Text("Черновики скрыты. Опубликованное объявление появится вторым блоком у подходящих пользователей.", style = MaterialTheme.typography.bodySmall)
            if (!ready && !storageBlocked) OutlinedButton(onClick = { run { refresh(); ready = true } }, enabled = !busy) { Text("Обновить") }
            ads.forEach { ad ->
                ListItem(headlineContent = { UntranslatedText(ad.getString("title")) }, supportingContent = { Text(if (ad.getBoolean("enabled")) "Опубликовано" else "Черновик") },
                    trailingContent = { Row {
                        AffairsIconButton("Изменить объявление", AffairsAction.EDIT, { if (dirty) editTarget = ad else accept(ad) }, enabled = enabled)
                        AffairsIconButton("Удалить объявление", AffairsAction.DELETE, { deleteTarget = ad }, enabled = enabled)
                    } })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            Text(if (editing == null) "Новое объявление" else "Изменить объявление", style = MaterialTheme.typography.titleLarge)
            if (pending != null) {
                Text("Ответ сохранения не получен. Объявление могло быть опубликовано. Обновите список и проверьте результат; повторный запрос не отправляется.", color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { run { refresh() } }, enabled = !busy, modifier = Modifier.testTag("admin-ad-reconcile")) { Text("Проверить результат на сервере") }
            }
            AdminField("Заголовок", form.getString("title"), enabled, 120) { change("title", it) }
            AdminField("Описание", form.getString("description"), enabled, 2000, 3) { change("description", it) }
            OutlinedButton(onClick = { imagePicker.launch(arrayOf("image/png", "image/jpeg", "image/webp")) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("Выбрать PNG, JPEG или WEBP до 500 КБ") }
            AdminField("HTTPS-ссылка на картинку", form.getString("imageUrl"), enabled, 2048) { change("imageUrl", it); change("imageData", "") }
            preview?.let { Image(it.asImageBitmap(), "Предпросмотр рекламы", Modifier.fillMaxWidth().heightIn(max = 220.dp), contentScale = ContentScale.Fit) }
            AdminField("HTTPS-ссылка объявления", form.getString("linkUrl"), enabled, 2048) { change("linkUrl", it) }
            AdminField("Языки: коды через запятую, пусто — все", form.getString("languages"), enabled, 150) { change("languages", it) }
            AdminField("Регионы устройства: коды стран, пусто — все", form.getString("countries"), enabled, 150) { change("countries", it) }
            Text("Часовой пояс черновика: ${formZone.id}. Даты показа — григорианские.", style = MaterialTheme.typography.bodySmall)
            AdminDateTimeField("Начало показа", form.getString("startsAt"), enabled, use24) { change("startsAt", it) }
            AdminDateTimeField("Окончание показа", form.getString("endsAt"), enabled, use24) { change("endsAt", it) }
            AdminField("Повторять через часов: 1–720", form.getString("repeatHours"), enabled, 3) { change("repeatHours", it) }
            AdminField("Приоритет: 0–10", form.getString("priority"), enabled, 2) { change("priority", it) }
            Text("Платформы · пустой выбор означает все", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val array = form.getJSONArray("platforms"); val platforms = (0 until array.length()).map(array::getString)
                listOf("web", "android").forEach { platform -> FilterChip(platform in platforms,
                    onClick = { change("platforms", JSONArray(if (platform in platforms) platforms - platform else platforms + platform)) }, enabled = enabled,
                    modifier = Modifier.heightIn(min = 48.dp), label = { Text(platform) }) }
            }
            AdminChoice("Опубликовать", form.getBoolean("enabled"), enabled) { change("enabled", it) }
            Text("Пользователь сможет закрыть рекламу через 60 секунд просмотра. До публикации она скрыта.", style = MaterialTheme.typography.bodySmall)
            Text("Перед сохранением сверяем объявление с сервером. При одновременной работе администраторов проверьте результат после сохранения.", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { confirmation = "discard" }, enabled = !busy && dirty) { Text("Отменить черновик рекламы") }
            Spacer(Modifier.height(8.dp))
        }
        Row(Modifier.fillMaxWidth().padding(12.dp).imePadding(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { run { refresh() } }, enabled = !busy) { Text("Обновить") }
            Button(enabled = enabled, modifier = Modifier.weight(1f).testTag("admin-ad-save"), onClick = {
                run { AdminProtocol.input(JSONObject(stateJson).getJSONObject("form"), formZone); confirmation = "save" }
            }) { Text(if (form.getBoolean("enabled")) "Опубликовать" else "Сохранить черновик") }
        }
    }
    if (confirmation == "save") AlertDialog(onDismissRequest = { if (!busy) confirmation = "" }, title = { Text(if (form.getBoolean("enabled")) "Опубликовать объявление?" else "Сохранить объявление?") },
        text = { Column { UntranslatedText(form.getString("title")); Text(if (form.getBoolean("enabled")) "Объявление станет доступно подходящей аудитории в указанный период." else "Объявление останется скрытым.") } },
        confirmButton = { TextButton(enabled = !busy, modifier = Modifier.testTag("admin-ad-confirm-save"), onClick = { run {
            val current = JSONObject(stateJson); val body = AdminProtocol.input(current.getJSONObject("form"), ZoneId.of(current.getString("zoneId"))); val id = current.optString("editingId").takeIf(String::isNotBlank)
            require(current.optJSONObject("sentBody") == null)
            val observed = gateway.ads().getJSONArray("ads"); val observedRows = (0 until observed.length()).map { observed.getJSONObject(it) }
            if (id != null) {
                val latest = observedRows.firstOrNull { it.getString("id") == id }
                require(latest != null && AdminProtocol.fingerprint(latest) == current.getString("baseline")) { "ADMIN_AD_CONFLICT" }
            }
            current.put("sentBody", JSONObject().put("fingerprint", AdminProtocol.fingerprint(body)).put("draftId", current.getString("draftId"))
                .put("targetId", id ?: JSONObject.NULL).put("knownIds", JSONArray(observedRows.filter { AdminProtocol.fingerprint(it) == AdminProtocol.fingerprint(body) }.map { it.getString("id") }))
                .put("submittedAt", java.time.Instant.now().toString()))
                .put("generation", current.getLong("generation") + 1); stateJson = current.toString(); persist(required = true); confirmation = ""
            val saved = gateway.saveAd(id, body).getJSONObject("ad"); if (id != null) require(saved.getString("id") == id)
            require(AdminProtocol.fingerprint(saved) == AdminProtocol.fingerprint(body)) { "ADMIN_AD_ACK_INVALID" }
            accept(saved); persist(); refresh(); message = "Объявление сохранено."
        } }) { Text(if (form.getBoolean("enabled")) "Опубликовать" else "Сохранить") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { confirmation = "" }) { Text("Отмена") } })
    if (confirmation == "discard" || editTarget != null) AlertDialog(onDismissRequest = { if (!busy) { confirmation = ""; editTarget = null } }, title = { Text("Отменить черновик рекламы?") },
        text = { Text(if (pending == null) "Несохранённые поля будут удалены. Объявления на сервере сохранятся." else "Запрос мог выполниться на сервере. Отмена черновика не удалит опубликованное объявление. Проверьте список перед новым созданием.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { run {
            val target = editTarget; stateJson = emptyState(JSONObject(stateJson).getLong("generation") + 1).toString(); persist()
            if (target != null) { accept(target); persist() }; confirmation = ""; editTarget = null
        } }) { Text("Отменить черновик") } }, dismissButton = { TextButton(onClick = { confirmation = ""; editTarget = null }) { Text("Продолжить редактирование") } })
    deleteTarget?.let { target -> AlertDialog(onDismissRequest = { if (!busy) deleteTarget = null }, title = { Text("Удалить объявление?") },
        text = { Text(target.getString("title")) }, confirmButton = { TextButton(enabled = !busy, onClick = { run {
            val rows = gateway.ads().getJSONArray("ads"); val latest = (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.getString("id") == target.getString("id") }
            if (latest != null) {
                require(AdminProtocol.fingerprint(latest) == AdminProtocol.fingerprint(target)) { "ADMIN_AD_CONFLICT" }
                val result = gateway.deleteAd(AdminProtocol.adId(target.getString("id"))); require(result.getBoolean("deleted"))
            }
            if (JSONObject(stateJson).optString("editingId") == target.getString("id")) { stateJson = emptyState(JSONObject(stateJson).getLong("generation") + 1).toString(); persist() }
            deleteTarget = null; refresh(); message = "Объявление удалено."
        } }) { Text("Удалить") } }, dismissButton = { TextButton(enabled = !busy, onClick = { deleteTarget = null }) { Text("Отмена") } }) }
}

@Composable private fun AdminField(label: String, value: String, enabled: Boolean, max: Int, lines: Int = 1, onChange: (String) -> Unit) {
    OutlinedTextField(value, { onChange(it.take(max)) }, enabled = enabled, label = { Text(label) }, minLines = lines, maxLines = if (lines > 1) 8 else 2, modifier = Modifier.fillMaxWidth())
}

@Composable private fun AdminDateTimeField(label: String, value: String, enabled: Boolean, use24: Boolean, onChange: (String) -> Unit) {
    val parsed = runCatching { LocalDateTime.parse(value) }.getOrNull()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            AuthorDatePicker(parsed?.toLocalDate()?.toString().orEmpty(), ru.genesis.calendar.domain.CalendarMode.PROFANE,
                enabled = enabled, placeholder = "Без ограничения", modifier = Modifier.weight(1f)) { date ->
                onChange(date + "T" + (parsed?.toLocalTime() ?: LocalTime.MIDNIGHT).toString())
            }
            if (parsed != null) {
                if (enabled) AuthorTimePicker(parsed.toLocalTime().toString().take(5), use24) { time -> onChange(parsed.toLocalDate().toString() + "T" + time) }
                else UntranslatedText(parsed.toLocalTime().toString().take(5))
                AffairsIconButton("Снять ограничение даты", AffairsAction.CLOSE, { onChange("") }, enabled = enabled)
            }
        }
    }
}

@Composable internal fun AdminChoice(label: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    val accessible = genesisTranslate(label)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = accessible }); Text(label, Modifier.weight(1f))
    }
}

internal fun adminError(code: String?): String = when (code) {
    "ADMIN_AD_TEXT_INVALID" -> "Укажите заголовок до 120 символов и описание до 2000 символов."
    "ADMIN_AD_HTTPS_REQUIRED" -> "Укажите полную HTTPS-ссылку."
    "ADMIN_AD_IMAGE_INVALID", "ADMIN_AD_IMAGE_REQUIRED" -> "Выберите PNG, JPEG или WEBP до 500 КБ и до 3000 × 3000 пикселей либо HTTPS-ссылку на картинку."
    "ADMIN_AD_AUDIENCE_INVALID" -> "Проверьте коды языков, стран и платформы."
    "ADMIN_AD_DATE_INVALID" -> "Проверьте даты: окончание должно быть позже начала. Время должно существовать в часовом поясе устройства."
    "ADMIN_AD_NUMBER_INVALID" -> "Частота: 1–720 часов. Приоритет: 0–10."
    "ADMIN_AD_CONFLICT" -> "Объявление изменилось или удалено. Черновик сохранён. Обновите список и откройте актуальную версию перед изменением."
    "SUBSCRIPTION_STATUS_CONFLICT" -> "Тариф изменился. Обновите пользователя перед сохранением."
    else -> "Действие администратора не выполнено или ответ не получен. Проверьте доступ и обновите данные. Черновик сохранён."
}
