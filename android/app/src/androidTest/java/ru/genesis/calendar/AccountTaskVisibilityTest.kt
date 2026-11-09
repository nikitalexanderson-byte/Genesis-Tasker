package ru.genesis.calendar

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.auth.AccountTaskSyncNotice
import ru.genesis.calendar.auth.AccountTaskSyncState
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.ui.GenesisApp
import ru.genesis.calendar.ui.Text
import ru.genesis.calendar.ui.standart

class AccountTaskVisibilityTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun secondLinkedGoogleAccountListTaskIsVisibleInPersonalInbox() {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val uid="linked-list-visibility-fixture"
        val owner=CloudAccountSnapshot.scopeFor(uid)
        val lists=JSONArray().put(JSONObject().put("id","primary-list").put("title","Основной список").put("accountId","google-a"))
            .put(JSONObject().put("id","secondary-list").put("title","Пробный список").put("accountId","google-b"))
        val payload=JSONObject().put("user",JSONObject().put("uid",uid).put("authProvider","google").put("email","fixture@example.invalid"))
            .put("workspace",JSONObject().put("keyMode","new").put("envelope",JSONObject.NULL))
            .put("taskLists",lists).put("tasks",JSONArray().put(JSONObject().put("id","linked-list-task")
                .put("title","пробная задача из списка").put("dueDate","").put("createdIn","google-tasks")
                .put("googleAccountId","google-b").put("googleTaskListId","secondary-list").put("googleTaskListTitle","Пробный список")))
        try {
            runBlocking {
                assertEquals(CloudAccountImporter.Result.IMPORTED,CloudAccountImporter(app.database).import(CloudAccountSnapshot.fromBootstrap(payload)))
                ru.genesis.calendar.data.TaskListsRepository.cacheBootstrap(app.database,owner,payload)
            }
            compose.runOnUiThread { app.activateAccount(uid) }
            compose.setContent { GenesisApp(app,null,testWorkspace=true) }
            compose.onNodeWithTag("navigation-Проекты").performClick()
            compose.onNodeWithTag("personal-task-list-secondary-list").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("toggle-task-list-secondary-list").performClick()
            compose.onNodeWithText("пробная задача из списка").performScrollTo().assertIsDisplayed()
        } finally {
            compose.runOnUiThread { app.activateAccount(null) }
            runBlocking {
                app.database.dao().clearAccountTaskCache(owner)
                app.database.dao().clearReminders(owner)
            }
        }
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        compose.waitForIdle()
        val device = UiDevice.getInstance(instrumentation)
        device.waitForIdle(2_000)
        assertTrue(device.takeScreenshot(File(instrumentation.targetContext.getExternalFilesDir(null), "2.3.1-$name.png")))
    }

    @Test fun firstAccountDownloadAppearsInBothTaskListAndCalendarDespiteOneUnreadableRow() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val uid = "task-visibility-fixture"
        val accountScope = CloudAccountSnapshot.scopeFor(uid)
        val date = LocalDate.now().withDayOfMonth(10)
        val longId = "account-0123456789-" + "x".repeat(100)
        try {
            runBlocking {
                app.database.dao().clearAccountTaskCache(accountScope)
                LocalPreferences(app, accountScope).set("display", "profane")
                LocalPreferences(app, accountScope).set("language", "ru")
                val payload = JSONObject().put("user", JSONObject().put("uid", uid)
                    .put("email", "fixture@example.test").put("displayName", "Fixture"))
                    .put("workspace", JSONObject().put("keyMode", "new").put("envelope", JSONObject.NULL))
                    .put("tasks", JSONArray()
                        .put(JSONObject().put("id", "website-task").put("title", "Задача с сайта").put("dueDate", date.toString()))
                        .put(JSONObject().put("id", "untitled-event").put("title", "").put("dueDate", date.toString()))
                        .put(JSONObject().put("id", longId).put("title", "Задача с длинным ID").put("dueDate", date.toString()))
                        .put(JSONObject().put("id", "invalid-date").put("title", "Unreadable fixture").put("dueDate", "invalid")))
                assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING,
                    CloudAccountImporter(app.database).import(CloudAccountSnapshot.fromBootstrap(payload)))
                assertEquals(3, app.database.dao().accountTasks(accountScope).size)
                assertTrue(app.database.dao().outbox(accountScope).isEmpty())
            }
            compose.runOnUiThread { app.activateAccount(uid) }
            compose.setContent { GenesisApp(app, null, testWorkspace = true) }
            compose.onNodeWithTag("navigation-Проекты").performClick()
            compose.onNodeWithTag("drag-task-website-task").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("drag-task-untitled-event").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Без названия").assertIsDisplayed()
            compose.onNodeWithTag("drag-task-$longId").performScrollTo().assertIsDisplayed()
            capture("imported-task-list")
            compose.onNodeWithTag("navigation-Календарь").performClick()
            compose.onNodeWithTag("calendar-task-count-$date").performScrollTo().performClick()
            compose.onNodeWithText("Задача с сайта").assertIsDisplayed()
            compose.onNodeWithText("Без названия").assertIsDisplayed()
            compose.onNodeWithText("Задача с длинным ID").assertIsDisplayed()
            capture("imported-calendar-tasks")
        } finally {
            compose.runOnUiThread { app.activateAccount(null) }
            runBlocking {
                app.database.dao().clearAccountTaskCache(accountScope)
                app.database.dao().clearReminders(accountScope)
            }
        }
    }

    @Test fun successfulSignInCannotHideDownloadProgressOrFailure() {
        var download by mutableStateOf(AccountTaskSyncState(scope = "fixture", loading = true))
        var sessionMessage by mutableStateOf("Вход подтверждён")
        compose.setContent {
            MaterialTheme(colorScheme = standart) {
                Surface {
                    Column(Modifier.safeDrawingPadding().padding(16.dp)) {
                        Text(sessionMessage)
                        AccountTaskSyncNotice(download)
                    }
                }
            }
        }
        compose.onNodeWithText("Загружаем задачи аккаунта…").assertIsDisplayed()
        compose.runOnIdle {
            sessionMessage = "Изменения отправлены"
            download = download.copy(loading = false,
                issue = "Не удалось загрузить задачи аккаунта. Нажмите «Обновить» для повторной попытки.")
        }
        compose.onNodeWithTag("account-task-sync-status").assertIsDisplayed()
        compose.onNodeWithText("Не удалось загрузить задачи аккаунта.", substring = true).assertIsDisplayed()
        capture("task-download-error")
        compose.runOnIdle { download = download.copy(confirmed = true, issue = null) }
        compose.onNodeWithTag("account-task-sync-status").assertDoesNotExist()
    }
}
