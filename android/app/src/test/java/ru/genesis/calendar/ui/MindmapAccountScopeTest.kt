package ru.genesis.calendar.ui

import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.CloudAccountSnapshot

class MindmapAccountScopeTest {
    @Test fun signInAndAccountSwitchDoNotOpenDraftsInThePreviousScope() {
        val first=CloudAccountSnapshot.scopeFor("first")
        val second=CloudAccountSnapshot.scopeFor("second")
        assertNull(mindmapAccountUid(null,false,"drafts"))
        assertNull(mindmapAccountUid("first",false,"drafts"))
        assertNull(mindmapAccountUid("first",true,"drafts"))
        assertEquals("first",mindmapAccountUid("first",true,first))
        assertNull(mindmapAccountUid("second",true,first))
        assertNull(mindmapAccountUid("second",false,second))
        assertEquals("second",mindmapAccountUid("second",true,second))
        assertNull(mindmapAccountUid(null,true,second))
    }
}
