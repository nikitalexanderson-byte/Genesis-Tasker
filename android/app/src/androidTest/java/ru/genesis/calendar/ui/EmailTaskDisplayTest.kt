package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.SharedWorkspaceGateway

class EmailTaskDisplayTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()

    @Test fun emailCategoriesSaveIndependentlyAndSortMenuWorksInBothThemes() {
        val types=JSONObject().apply { listOf("created","projects","comments","assignment","mentions","dueSoon","overdue","approvalRequest","approvalResult","changes").forEach { put(it,true) } }
        var server=JSONObject().put("settings",JSONObject().put("types",types)
            .put("emailTypes",JSONObject(types.toString()).put("messages",true))
            .put("channels",JSONObject().put("email",false).put("inbox",true).put("push",false))
            .put("frequency","immediate").put("digestTime","09:00")
            .put("quiet",JSONObject().put("enabled",false).put("start","22:00").put("end","08:00")))
            .put("revision",0).put("capabilities",JSONObject().put("email",JSONObject().put("available",true)))
        val saved=mutableListOf<JSONObject>()
        val gateway=object:SharedWorkspaceGateway {
            override suspend fun notificationSettings()=JSONObject(server.toString())
            override suspend fun saveNotificationSettings(settings:JSONObject,revision:Int):JSONObject {
                assertEquals(server.getInt("revision"),revision)
                saved.add(JSONObject(settings.toString()))
                server=JSONObject(server.toString()).put("settings",JSONObject(settings.toString())).put("revision",revision+1)
                return JSONObject(server.toString())
            }
        }
        var dark by mutableStateOf(false)
        var sort by mutableStateOf(TaskListSort.DEFAULT)
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalGenesisUserId provides "synthetic-email-qa",LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme=if(dark)evening else standart) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        TaskListSortChoice(sort) { sort=it }
                        EmailNotificationSettings(gateway,true)
                    }
                }
            }
        }
        for ((index,eveningMode) in listOf(false,true).withIndex()) {
            compose.runOnIdle { dark=eveningMode }
            compose.onNodeWithTag("task-sort-control").performScrollTo().performClick()
            compose.onNodeWithTag(if(index==0)"task-sort-createdAt" else "task-sort-createdAtAsc").performClick()
            compose.runOnIdle { assertEquals(if(index==0)TaskListSort.NEWEST else TaskListSort.OLDEST,sort) }
            compose.onNodeWithTag("email-notifications-enabled").performScrollTo().performClick()
            compose.onNodeWithTag("email-type-comments").performScrollTo().performClick()
            compose.onNodeWithTag("email-settings-save").performScrollTo().performClick()
            compose.waitUntil(5_000) { saved.size==index+1 }
            compose.runOnIdle {
                assertEquals(index==0,saved.last().getJSONObject("channels").getBoolean("email"))
                assertEquals(index!=0,saved.last().getJSONObject("emailTypes").getBoolean("comments"))
                assertTrue(saved.last().getJSONObject("types").getBoolean("comments"))
            }
        }
    }
}
