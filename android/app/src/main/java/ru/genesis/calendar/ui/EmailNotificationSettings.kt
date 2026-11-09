package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.rebaseNotificationSettings

@Composable internal fun EmailNotificationSettings(controller:SharedWorkspaceGateway,use24:Boolean) {
    val userId=LocalGenesisUserId.current;val en=LocalGenesisLanguage.current=="en";val scope=rememberCoroutineScope()
    var data by remember(userId){mutableStateOf<JSONObject?>(null)}
    var draft by remember(userId){mutableStateOf<JSONObject?>(null)}
    var busy by remember(userId){mutableStateOf(false)};var error by remember(userId){mutableStateOf(false)}
    var version by remember { mutableIntStateOf(0) };var frequencyMenu by remember { mutableStateOf(false) }
    LaunchedEffect(controller,userId,version){
        error=false
        try{val next=controller.notificationSettings();val previous=data;val own=draft
            draft=if(previous!=null&&own!=null)rebaseNotificationSettings(previous.getJSONObject("settings"),own,next.getJSONObject("settings")) else JSONObject(next.getJSONObject("settings").toString())
            draft=draft!!.apply { if(!has("emailTypes"))put("emailTypes",JSONObject(getJSONObject("types").toString()).put("messages",true)) };data=next}
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=true}
    }
    fun update(change:(JSONObject)->Unit){draft=draft?.let { JSONObject(it.toString()).apply(change) }}
    SettingsSection("",if(en)"Email notifications" else "Уведомления по email",
        "noreply@genesiscalendar.com",androidx.compose.ui.graphics.Color(0xfffff1cf)) {
        val settings=draft
        if(settings==null){
            if(error) Text(if(en)"Could not load email settings." else "Не удалось загрузить настройки почты.")
            else WorkspaceLoadingText()
            if(error)TextButton(onClick={version++}){Text(if(en)"Retry" else "Повторить")}
        }else{
            val channels=settings.getJSONObject("channels")
            val kinds=listOf(Triple("messages","Личные сообщения","Private messages"),Triple("comments","Новые комментарии","New comments"),
                Triple("mentions","Упоминание в комментарии","Comment mentions"),Triple("created","Новая задача","New tasks"),
                Triple("projects","Новый проект","New projects"),Triple("assignment","Назначение исполнителя","Assignments"),
                Triple("dueSoon","Приближение срока","Upcoming due dates"),Triple("overdue","Просроченная задача","Overdue tasks"),
                Triple("approvalRequest","Запрос подтверждения","Approval requests"),Triple("approvalResult","Результат подтверждения","Approval results"),
                Triple("changes","Изменения","Other changes"))
            AffairsDisclosure("События во входящих и на устройстве") {
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text("Входящие GENESIS",Modifier.weight(1f));Switch(checked=channels.optBoolean("inbox"),enabled=!busy,
                        onCheckedChange={value->update { it.getJSONObject("channels").put("inbox",value) }})
                }
                kinds.filter { it.first!="messages" }.forEach { (key,ru,english)->Row(Modifier.fillMaxWidth().heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text(if(en)english else ru,Modifier.weight(1f));Switch(checked=settings.getJSONObject("types").optBoolean(key),enabled=!busy,
                        onCheckedChange={value->update { it.getJSONObject("types").put(key,value) }})
                } }
            }
            val available=data?.optJSONObject("capabilities")?.optJSONObject("email")?.optBoolean("available")==true
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(if(en)"Email notifications" else "Получать уведомления на email",Modifier.weight(1f))
                Switch(checked=channels.optBoolean("email"),onCheckedChange={value->update { it.getJSONObject("channels").put("email",value) }},
                    enabled=!busy&&(available||channels.optBoolean("email")),modifier=Modifier.testTag("email-notifications-enabled"))
            }
            if(!available)Text(if(en)"Email delivery is not configured yet." else "Отправка писем пока не настроена.",style=MaterialTheme.typography.bodySmall)
            Text(if(en)"Registration confirmation is sent once when a new account is created on the website." else "Подтверждение регистрации отправляется один раз при создании аккаунта на сайте.",style=MaterialTheme.typography.bodySmall)
            Text(if(en)"Email types" else "События писем",style=MaterialTheme.typography.titleSmall)
            kinds.forEach { (key,ru,english)->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(if(en)english else ru,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                Switch(checked=settings.getJSONObject("emailTypes").optBoolean(key),enabled=!busy,onCheckedChange={value->update { it.getJSONObject("emailTypes").put(key,value) }},modifier=Modifier.testTag("email-type-$key"))
            } }
            val frequencies=listOf(Triple("immediate","Сразу","Immediately"),Triple("hourly","Раз в час","Hourly"),Triple("daily","Ежедневная сводка","Daily"))
            Box{
                OutlinedButton(onClick={frequencyMenu=true},enabled=!busy){Text((if(en)"Frequency: " else "Частота отправки: ")+frequencies.first { it.first==settings.optString("frequency") }.let { if(en)it.third else it.second })}
                DropdownMenu(expanded=frequencyMenu,onDismissRequest={frequencyMenu=false}){frequencies.forEach { (value,ru,english)->DropdownMenuItem(text={Text(if(en)english else ru)},onClick={update { it.put("frequency",value) };frequencyMenu=false}) }}
            }
            if(settings.optString("frequency")=="daily"){
                Text(if(en)"Daily digest time" else "Время сводки");AuthorTimePicker(settings.getString("digestTime"),use24){value->update { it.put("digestTime",value) }}
            }
            val quiet=settings.getJSONObject("quiet")
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(if(en)"Quiet hours" else "Тихие часы",Modifier.weight(1f));Switch(checked=quiet.getBoolean("enabled"),enabled=!busy,onCheckedChange={value->update { it.getJSONObject("quiet").put("enabled",value) }})
            }
            if(quiet.getBoolean("enabled")){
                Text(if(en)"From" else "С");AuthorTimePicker(quiet.getString("start"),use24){value->update { it.getJSONObject("quiet").put("start",value) }}
                Text(if(en)"Until" else "До");AuthorTimePicker(quiet.getString("end"),use24){value->update { it.getJSONObject("quiet").put("end",value) }}
            }
            AffairsDisclosure("Время и частота") {
                ImportChoice("Часовой пояс",settings.optString("timeZoneMode","fixed"),listOf("device" to genesisTranslate("Часовой пояс устройства"),"fixed" to genesisTranslate("Выбрать часовой пояс")),!busy,"notification-zone-mode") { value ->
                    update { it.put("timeZoneMode",value);if(value=="device")it.put("timeZone",java.util.TimeZone.getDefault().id) }
                }
                OutlinedTextField(settings.optString("timeZone"),{value->if(value.length<=80)update { it.put("timeZone",value) }},enabled=!busy&&settings.optString("timeZoneMode")!="device",
                    label={Text("Часовой пояс IANA")},modifier=Modifier.fillMaxWidth().testTag("notification-zone-input"))
                ImportChoice("За сколько дней напоминать о сроке",settings.optInt("reminderDays").toString(),(0..30).map { it.toString() to it.toString() },!busy,"notification-reminder-days") { value -> update { it.put("reminderDays",value.toInt()) } }
            }
            Button(onClick={scope.launch{
                busy=true;error=false
                try{val saved=controller.saveNotificationSettings(settings,data!!.getInt("revision"));data=saved;draft=JSONObject(saved.getJSONObject("settings").toString())}
                catch(cancel:CancellationException){throw cancel}catch(_:Exception){error=true}finally{busy=false}
            }},enabled=!busy&&settings.toString()!=data?.optJSONObject("settings")?.toString(),modifier=Modifier.heightIn(min=48.dp).testTag("email-settings-save")){Text(if(en)"Save" else "Сохранить")}
            if(error){
                Text(if(en)"Could not save the settings. Reload and try again." else "Не удалось сохранить настройки. Обновите их и повторите попытку.",color=MaterialTheme.colorScheme.error)
                AffairsIconButton(if(en)"Reload settings" else "Обновить настройки",AffairsAction.REFRESH,{version++},enabled=!busy)
            }
        }
    }
}
