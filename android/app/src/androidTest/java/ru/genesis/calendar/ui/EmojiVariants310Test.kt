package ru.genesis.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity

class EmojiVariants310Test {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    @Test fun neutralTileKeepsTonesBehindLongPressAndDoesNotSelectOnHold(){
        val values=listOf("👋","👋🏻","👋🏼","👋🏽","👋🏾","👋🏿","💪","💪🏻")
        val grouped=groupEmojiVariants(values)
        assertEquals(listOf("👋","💪"),grouped.map{it.first})
        var selected by mutableStateOf("")
        compose.setContent { MaterialTheme(colorScheme=standart) { FullEmojiChoice("👋",selected,grouped.first().second,{selected=it},Modifier.testTag("emoji-neutral")) } }
        compose.onNodeWithTag("emoji-variant-👋🏿").assertDoesNotExist()
        compose.onNodeWithTag("emoji-neutral").performTouchInput{longClick()}
        compose.runOnIdle{assertEquals("",selected)}
        compose.onNodeWithTag("emoji-variant-👋🏿").performClick()
        compose.runOnIdle{assertEquals("👋🏿",selected)}
        compose.onNodeWithTag("emoji-neutral").assertContentDescriptionEquals("👋")
        compose.onNodeWithTag("emoji-neutral").performClick()
        compose.runOnIdle{assertEquals("👋",selected)}
    }
    @Test fun zwjGenderAndVariationSelectorsSurviveGrouping(){
        val groups=groupEmojiVariants(listOf("👩‍⚕️","👩🏻‍⚕️","👩🏿‍⚕️","👨‍⚕️","👨🏿‍⚕️"))
        assertEquals(2,groups.size);assertEquals("👩‍⚕️",groups[0].first);assertEquals(3,groups[0].second.size)
        assertEquals("👨‍⚕️",groups[1].first)
    }
}
