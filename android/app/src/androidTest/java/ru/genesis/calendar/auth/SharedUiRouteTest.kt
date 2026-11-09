package ru.genesis.calendar.auth

import org.junit.Assert.*
import org.junit.Test

class SharedUiRouteTest {
    @Test fun projectAccessUsesOnlyScopedReadPreviewAndPatchRoutes() {
        val space = "12345678-1234-1234-1234-123456789abc"
        assertTrue(allowedSharedRoute("GET", "/shared/spaces/$space")); assertFalse(allowedSharedRoute("PATCH", "/shared/spaces/$space"))
        for (method in listOf("GET", "POST", "PATCH")) assertTrue(allowedSharedRoute(method, "/shared/spaces/$space/members/synthetic-user/project-access"))
        for (method in listOf("PUT", "DELETE")) assertFalse(allowedSharedRoute(method, "/shared/spaces/$space/members/synthetic-user/project-access"))
        assertFalse(allowedSharedRoute("PATCH", "/shared/spaces/$space/members/a/b/project-access"))
        assertFalse(allowedSharedRoute("PATCH", "/shared/spaces/invalid/members/user/project-access"))
    }
    @Test fun uiStateInvitationsAndListsUseOnlyTheirExpectedMethods() {
        val space = "12345678-1234-1234-1234-123456789abc"
        assertTrue(allowedSharedRoute("GET", "/shared/spaces/$space/ui"))
        assertTrue(allowedSharedRoute("PATCH", "/shared/spaces/$space/ui"))
        assertFalse(allowedSharedRoute("POST", "/shared/spaces/$space/ui"))
        assertFalse(allowedSharedRoute("PATCH", "/shared/spaces/invalid/ui"))
        assertFalse(allowedSharedRoute("PATCH", "/shared/spaces/$space/ui/../projects"))
        assertTrue(allowedSharedRoute("POST", "/shared/spaces/$space/invitations"))
        assertFalse(allowedSharedRoute("GET", "/shared/spaces/$space/invitations"))
        assertTrue(allowedSharedRoute("GET", "/shared/task-lists"))
        assertFalse(allowedSharedRoute("POST", "/shared/task-lists"))
    }
}
