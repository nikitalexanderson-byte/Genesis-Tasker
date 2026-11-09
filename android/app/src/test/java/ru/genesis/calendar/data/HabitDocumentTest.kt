package ru.genesis.calendar.data

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.auth.WorkspacePatch

class HabitDocumentTest {
    @Test fun actualWebConflictSurvivesNativeChoiceAndThreeWaySyncWithoutRebindingEvents() {
        val web=JSONObject(javaClass.getResource("/habit-rule-history-web.json")!!.readText())
        val imported=HabitDocument.decode(CloudAccountImporter.habitsDocument(web),1)
        val day=LocalDate.parse("2026-05-04");val original=imported.habits.single()
        assertEquals(2,HabitRuleHistory.state(original,day).conflicts.size)
        val selected=HabitRuleHistory.resolve(original,"web-rule-left",listOf("web-rule-left","web-rule-right"),
            "native-choice","2026-05-04T13:00:00Z")
        val local=WorkspacePatch.localDocument(web,null,JSONObject(HabitDocument.encode(imported.copy(habits=listOf(selected)))),null)
        val patched=WorkspacePatch.apply(web,local,web,setOf("habits"),2,"2026-05-04T13:00:00Z","history-interop")
        val returned=HabitDocument.decode(CloudAccountImporter.habitsDocument(patched.document),2)
        val rule=HabitMeasurements.rule(returned.habits.single(),day)
        assertEquals("web-rule-left",rule.id);assertEquals(150_000L,rule.periodGoal!!.target)
        assertEquals("web-rule-left",returned.measurements.single().ruleId)
        assertEquals(150_125L,HabitMeasurements.progress(returned.habits.single(),day,returned.measurements).total)
        assertEquals(10,returned.completions.single().xpAwarded)
        assertEquals(returned,HabitDocument.decode(HabitDocument.encode(returned),2))
        java.io.File("build/test-results/habit-rule-history-native.json").apply { parentFile.mkdirs();writeText(patched.document.toString(2)) }
    }

    @Test fun utcDeviceCalendarContextsUseTheWebCompatibleUtcSpelling() {
        val context=CalendarContext(timeZone="GMT")
        val encoded=calendarContextJson(context) as JSONObject
        assertEquals("UTC",encoded.getString("timeZone"))
        assertEquals("UTC",calendarContextFromJson(JSONObject().put("version",2).put("timeZone","GMT"))!!.timeZone)
        assertEquals("Europe/Moscow",(calendarContextJson(CalendarContext(timeZone="Europe/Moscow")) as JSONObject).getString("timeZone"))
    }
    @Test fun actualWebPeriodEntriesSurviveNativeRuleChangesAndThreeWaySync() {
        val web=JSONObject(javaClass.getResource("/habit-period-goals-web.json")!!.readText())
        val imported=HabitDocument.decode(CloudAccountImporter.habitsDocument(web),3)
        val day=LocalDate.parse("2026-05-04")
        val original=imported.habits.single()
        assertEquals(3L,HabitPeriodGoals.progress(original,day,imported.measurements,imported.completions,
            java.time.Instant.parse("2026-05-04T12:00:00Z"))!!.value)
        val edited=preserveHabitCreationSettings(original.copy(periodGoal=original.periodGoal!!.copy(target=4)),
            original,day,"2026-05-04T13:00:00Z")
        assertEquals(LocalDate.parse("2026-05-11"),edited.ruleHistory.last().effectiveDate)
        assertEquals(3L,HabitMeasurements.rule(edited,day).periodGoal!!.target)
        val events=HabitMeasurements.append(edited,day,1000,imported.measurements,operationId="native-period-extra",timestamp="2026-05-04T13:00:00Z")
        val local=WorkspacePatch.localDocument(web,null,JSONObject(HabitDocument.encode(imported.copy(habits=listOf(edited),measurements=events))),null)
        val patched=WorkspacePatch.apply(web,local,web,setOf("habits"),3,"2026-05-04T13:00:00Z","period-interop")
        val returned=HabitDocument.decode(CloudAccountImporter.habitsDocument(patched.document),4)
        assertEquals(4,returned.measurements.size)
        assertEquals(3L,HabitMeasurements.rule(returned.habits.single(),day).periodGoal!!.target)
        assertEquals(4L,HabitMeasurements.rule(returned.habits.single(),day.plusDays(7)).periodGoal!!.target)
        assertEquals(returned,HabitDocument.decode(HabitDocument.encode(returned),4))
    }

    @Test fun aPeriodicGoalSettlesOnceAndDoesNotUseProtectionOnIntermediateDays() {
        val day=LocalDate.parse("2026-05-04")
        val habit=Habit(TrackerEntity.create("habit","2026-05-04T12:00:00Z","period-reconcile"),"Synthetic goal",day,
            HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow"))).defaultSchedule(day,CalendarMode.PROFANE),
            periodGoal=HabitPeriodGoal(period="week",metric="entries",target=3,calendar="profane",context=CalendarContext(timeZone="Europe/Moscow")))
        var events=emptyList<HabitMeasurementEvent>()
        repeat(3) { events=HabitMeasurements.append(habit,day,1000,events,operationId="period-event-$it",timestamp="2026-05-04T12:00:00Z") }
        val entries=HabitMeasurements.project(listOf(habit),events,emptyList(),day,"2026-05-04T12:00:00Z")
        val open=reconcileHabitWorkspace(LocalHabitWorkspace(habits=listOf(habit),measurements=events,completions=entries),
            day.plusDays(2),"Europe/Moscow","2026-05-06T12:00:00Z")
        assertTrue(open.goals.all { it.scheduledCount==0 })
        assertTrue(open.streakFreezeTransactions.isEmpty())
        val settled=reconcileHabitWorkspace(open,day.plusDays(6),"Europe/Moscow","2026-05-10T12:00:00Z")
        assertEquals(1,settled.goals.count { it.scheduledCount>0 })
        assertEquals(1,settled.goals.single { it.date==day.plusDays(6) }.completedCount)
        assertTrue(settled.achievementUnlocks.any { it.achievementId=="first-step" })
        assertEquals(settled.rewards,reconcileHabitWorkspace(settled,day.plusDays(6),"Europe/Moscow","2026-05-10T13:00:00Z").rewards)
    }

    @Test fun actualWebRulesAndEntriesSurviveNativeEditAndThreeWayPatch() {
        // Generated by the web defaultHabit/applyEditableHabitUpdate/event constructors.
        val web = JSONObject(javaClass.getResource("/habit-measurements-web.json")!!.readText())
        val imported = HabitDocument.decode(CloudAccountImporter.habitsDocument(web), 3)
        val day = LocalDate.of(2026, 10, 16)
        val original = imported.habits.single()
        assertEquals("march", original.ruleHistory.first().schedule.recurrence.calendarContext!!.gregorianYearStart)
        assertEquals(30_125L, HabitMeasurements.progress(original, day, imported.measurements).total)
        val edited = preserveHabitCreationSettings(original.copy(measurement = original.measurement!!.copy(target = 120_000)),
            original, day.plusDays(1), "2026-10-17T11:00:00.000Z")
        val events = HabitMeasurements.append(edited, day, 15_000, imported.measurements,
            operationId = "native-entry", timestamp = "2026-10-16T12:00:00.000Z")
        val local = WorkspacePatch.localDocument(web, null, JSONObject(HabitDocument.encode(imported.copy(
            habits = listOf(edited), measurements = events))), null)
        val patched = WorkspacePatch.apply(web, local, web, setOf("habits"), 3,
            "2026-10-17T11:00:00.000Z", "native-web-vector")
        val returned = HabitDocument.decode(CloudAccountImporter.habitsDocument(patched.document), 4)
        assertEquals(3, returned.habits.single().ruleHistory.size)
        assertEquals(45_125L, HabitMeasurements.progress(returned.habits.single(), day, returned.measurements).total)
        val oldRules = web.getJSONArray("habits").getJSONObject(0).getJSONArray("ruleHistory")
        val returnedRules = patched.document.getJSONArray("habits").getJSONObject(0).getJSONArray("ruleHistory")
        for (index in 0 until oldRules.length()) assertEquals(canonical(oldRules.getJSONObject(index)), canonical(returnedRules.getJSONObject(index)))
        assertFalse(WorkspacePatch.apply(patched.document, patched.document, patched.document, setOf("habits"),
            4, "2026-10-17T12:00:00.000Z", "native-web-vector").changed)
    }
    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") {
            JSONObject.quote(it) + ":" + canonical(value.get(it)) }
        is org.json.JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }
    @Test fun measuredEntriesRuleHistoryAndCorrectionsRoundTripAcrossCloudCodec() {
        val measured=habit().copy(measurement=HabitMeasurement("duration","min",60_000,15_000))
        val updated=preserveHabitCreationSettings(measured.copy(measurement=measured.measurement!!.copy(target=90_000)),measured,day,stamp)
        val root=HabitMeasurements.append(updated,day,60_125,emptyList(),operationId="session",timestamp=stamp)
        val corrected=HabitMeasurements.append(updated,day,45_500,root,"session",listOf("session"),operationId="edit",timestamp=stamp)
        val workspace=LocalHabitWorkspace(habits=listOf(updated),measurements=corrected,revision=3)
        assertEquals(workspace,HabitDocument.decode(HabitDocument.encode(workspace),3))
        val native=JSONObject(HabitDocument.encode(workspace))
        val cloud=JSONObject().put("habits",native.getJSONArray("habits")).put("habitMeasurements",native.getJSONArray("measurements"))
            .put("habitCompletions",native.getJSONArray("completions")).put("dailyGoalRecords",native.getJSONArray("goals"))
            .put("rewardTransactions",native.getJSONArray("rewards")).put("userProgress",native.getJSONObject("progress"))
        val imported=HabitDocument.decode(CloudAccountImporter.habitsDocument(cloud),3)
        assertEquals(updated,imported.habits.single());assertEquals(corrected,imported.measurements)
    }
    @Test fun corruptMeasurementDoesNotSilentlyBecomeBinary() {
        val payload=JSONObject(HabitDocument.encode(LocalHabitWorkspace(habits=listOf(habit()))))
        payload.getJSONArray("habits").getJSONObject(0).put("measurement",false)
        assertThrows(Exception::class.java) { HabitDocument.decode(payload.toString(),0) }
    }
    @Test fun intervalConfigurationAndPartialMarksRoundTripWithoutChangingOtherData() {
        val interval=HabitIntervalSchedule(30,"09:00","10:00","each")
        val habit=habit().copy(intervalSchedule=interval)
        val partial=engine.updateIntervalCompletion(emptyList(),habit,day,day,"09:00",true)
        val workspace=LocalHabitWorkspace(habits=listOf(habit),completions=partial,revision=7)
        val decoded=HabitDocument.decode(HabitDocument.encode(workspace),7)
        assertEquals(workspace,decoded)
        assertEquals(listOf("09:00"),decoded.completions.single().completedTimes)
        assertFalse(decoded.completions.single().completed)
        assertEquals(habit.reminder.googleTaskId,decoded.habits.single().reminder.googleTaskId)
    }
    private val day=LocalDate.of(2026,9,23)
    private val stamp="2026-09-23T10:00:00.000Z"
    private val engine=HabitEngine(GenesisCalendar(ZoneId.of("Europe/Moscow")))
    private fun habit()=Habit(TrackerEntity("h1",stamp,stamp),"Тест \"кавычки\" ☀",day,engine.defaultSchedule(day,CalendarMode.PROFANE),
        description="Строка 1\nСтрока 2",reminder=HabitReminder(googleTaskId="opaque-test-binding",
            timing="custom",minutesBefore=15,allowDuringQuietHours=true))

    @Test fun documentRoundTripPreservesScheduleIdentityBindingsHistoryAndLedger() {
        val habit=habit()
        val entries=engine.updateCompletion(emptyList(),habit,day,day,true,null,"Тест",stamp,"completion-1")
        val workspace=reconcileHabitWorkspace(LocalHabitWorkspace(listOf(habit),entries,revision=4),day,"Europe/Moscow",stamp)
        assertEquals(workspace,HabitDocument.decode(HabitDocument.encode(workspace),4))
        assertEquals(10,workspace.progress.lifetimeXp)
        assertEquals(11,workspace.progress.laurelsBalance) // 8 for perfect day + 3 daily trial
        val replay=reconcileHabitWorkspace(workspace,day,"Europe/Moscow",stamp)
        assertEquals(workspace,replay)
    }

    @Test fun pauseAndResumeMetadataSurvivesRoundTrip() {
        val h=habit().copy(active=false,scoringMode="quality-bipolar",qualityScale="bipolar",isKeyHabit=true,
            sacredPracticeId="practice-test",sacredSectorId="sector-test",sourceTemplateId="daily-plan",
            schedule=habit().schedule.copy(endDate=day.plusDays(9),recurrence=RecurrenceConfig(true,"lunar","lunar-days",days=listOf(1,29,30),months=listOf(2))))
        val w=LocalHabitWorkspace(habits=listOf(h))
        assertEquals(w,HabitDocument.decode(HabitDocument.encode(w),0))
    }

    @Test fun websiteHabitPersonalizationAndGoogleChoicesSurviveRoundTrip() {
        val configured = habit().copy(emoji="🧘",color="#2d7771",isKeyHabit=true,
            ritualId="custom",ritualName="Восстановление",
            reminder=HabitReminder(enabled=true,time="07:30",syncToGoogleTasks=true,
                showInGoogleCalendar=true,googleTaskId="habit-task",googleEventId="habit-event"))
        val restored=HabitDocument.decode(HabitDocument.encode(LocalHabitWorkspace(habits=listOf(configured))),0)
            .habits.single()
        assertEquals(configured,restored)
    }

    @Test fun achievementUnlockPersistsAfterCompletionIsRemovedAndLegacyDocumentDecodes() {
        val h = habit()
        val entries = engine.updateCompletion(emptyList(), h, day, day, true, null, "", stamp, "unlock-1")
        val first = reconcileHabitWorkspace(LocalHabitWorkspace(listOf(h), entries), day,
            "Europe/Moscow", stamp)
        assertTrue(first.achievementUnlocks.any { it.achievementId == "first-step" })
        val removed = reconcileHabitWorkspace(first.copy(completions = emptyList()), day,
            "Europe/Moscow", "2026-09-23T11:00:00.000Z")
        assertEquals(first.achievementUnlocks, removed.achievementUnlocks)
        val legacy = JSONObject(HabitDocument.encode(first)).apply { remove("achievementUnlocks") }
        assertTrue(HabitDocument.decode(legacy.toString(), 0).achievementUnlocks.isEmpty())
    }

    @Test fun hestiaTransactionsSurviveEncryptedDocumentFormatAndLegacyDocumentDecodes() {
        val freeze = StreakFreezeTransaction(1, "purchase", "p1",
            "hestia-spark-purchase:self:p1", stamp)
        val workspace = LocalHabitWorkspace(streakFreezeTransactions = listOf(freeze))
        assertEquals(workspace, HabitDocument.decode(HabitDocument.encode(workspace), 0))
        val legacy = JSONObject(HabitDocument.encode(workspace)).apply { remove("streakFreezeTransactions") }
        assertTrue(HabitDocument.decode(legacy.toString(), 0).streakFreezeTransactions.isEmpty())
    }

    @Test fun questIdentityProgressAndRewardSurviveDocumentRoundTrip() {
        val h = habit()
        val first = reconcileHabitWorkspace(LocalHabitWorkspace(habits = listOf(h)), day,
            "Europe/Moscow", stamp)
        assertEquals(3, first.quests.size)
        assertEquals(first, HabitDocument.decode(HabitDocument.encode(first), first.revision))
        val legacy = JSONObject(HabitDocument.encode(first)).apply { remove("quests") }
        assertTrue(HabitDocument.decode(legacy.toString(), 0).quests.isEmpty())
        val entry = engine.updateCompletion(emptyList(), h, day, day, true, null, "", stamp, "quest-1")
        val completed = reconcileHabitWorkspace(first.copy(completions = entry), day,
            "Europe/Moscow", stamp)
        assertTrue(completed.quests.any { it.cadence == "daily" && it.completedAt != null })
        assertEquals(3, completed.rewards.filter { it.reason == "daily-quest" }.sumOf { it.amount })
        assertEquals(completed.rewards, reconcileHabitWorkspace(completed, day,
            "Europe/Moscow", stamp).rewards)
    }

    @Test fun disablingQuestsPreservesExistingProgressWithoutAdvancingOrPayingIt() {
        val h = habit()
        val initial = reconcileHabitWorkspace(LocalHabitWorkspace(habits = listOf(h)), day,
            "Europe/Moscow", stamp)
        assertEquals(3, initial.quests.size)
        val entry = engine.updateCompletion(emptyList(), h, day, day, true, null, "", stamp, "quest-disabled")
        val disabledSettings = initial.settings.copy(feedback = initial.settings.feedback.copy(questsEnabled = false))
        val disabled = reconcileHabitWorkspace(initial.copy(completions = entry, settings = disabledSettings), day,
            "Europe/Moscow", "2026-09-23T11:00:00.000Z")
        assertEquals(initial.quests, disabled.quests)
        assertFalse(disabled.rewards.any { it.reason.endsWith("quest") })
    }

    @Test fun closingNewMissConsumesPurchasedSparkWithoutXpOrFalseCompletion() {
        val h = habit()
        val entries = engine.updateCompletion(emptyList(), h, day, day, true, null, "", stamp, "c-protected")
        val first = reconcileHabitWorkspace(LocalHabitWorkspace(listOf(h), entries), day,
            "Europe/Moscow", stamp)
        val bonus = Rewards.create(200.0, "comeback", "seed", "seed-comeback", stamp)
        val (paid, freezes) = StreakProtection.purchase(first.rewards + bonus, emptyList(),
            "purchase-test", stamp)
        val purchased = reconcileHabitWorkspace(first.copy(rewards = paid,
            streakFreezeTransactions = freezes), day, "Europe/Moscow", stamp)
        val next = reconcileHabitWorkspace(purchased, day.plusDays(2), "Europe/Moscow",
            "2026-09-25T10:00:00.000Z")
        val missed = next.goals.single { it.date == day.plusDays(1) }
        assertEquals("protected", missed.status)
        assertEquals(0, missed.completedCount)
        assertEquals(10, next.progress.lifetimeXp)
        assertEquals(0, next.progress.streakFreezeCount)
        assertEquals(1, next.progress.currentStreak)
        assertEquals(next, HabitDocument.decode(HabitDocument.encode(next), next.revision))
        assertEquals(next.rewards, reconcileHabitWorkspace(next, day.plusDays(2),
            "Europe/Moscow", "2026-09-25T11:00:00.000Z").rewards)
    }

    @Test fun missedDayNeverResetsLaurelsAndLifetimeXpRemains() {
        val h=habit()
        val entries=engine.updateCompletion(emptyList(),h,day,day,true,null,"",stamp,"c1")
        val first=reconcileHabitWorkspace(LocalHabitWorkspace(listOf(h),entries),day,"Europe/Moscow",stamp)
        val afterMissing=reconcileHabitWorkspace(first,day.plusDays(2),"Europe/Moscow","2026-09-25T10:00:00.000Z")
        assertEquals(11,afterMissing.progress.laurelsBalance)
        assertEquals(10,afterMissing.progress.lifetimeXp)
        assertEquals(0,afterMissing.rewards.count { it.reason=="habit-missed-reset" })
        val replay=reconcileHabitWorkspace(afterMissing,day.plusDays(2),"Europe/Moscow","2026-09-25T11:00:00.000Z")
        assertEquals(afterMissing.rewards,replay.rewards)
        assertEquals(afterMissing.progress,replay.progress)
    }

    @Test fun futureSchemaOrCorruptJsonNeverBecomesAnEmptyReplacementWorkspace() {
        assertThrows(Exception::class.java) { HabitDocument.decode("{}",1) }
        assertThrows(IllegalArgumentException::class.java) { HabitDocument.decode("{\"localSchema\":999}",1) }
    }

    @Test fun webCompatibleSettingsAndHiddenTemplatesSurviveRoundTrip() {
        val raw = JSONObject().put("enabled", true).put("reportRange", "quarter")
            .put("notifications", JSONObject().put("enabled", true).put("motivational", false)
                .put("tone", "heroic").put("dailyGoalTime", "19:45")
                .put("quietHoursStart", "23:00").put("quietHoursEnd", "06:30"))
            .put("feedback", JSONObject().put("animations", false).put("sound", true)
                .put("haptics", true).put("achievementPopups", false)
                .put("questsEnabled", false).put("gamificationWidgets", false))
        val settings = HabitSettings(true,
            HabitNotificationSettings(true, false, "heroic", "19:45", "23:00", "06:30"),
            HabitFeedbackSettings(false, true, true, false, false, false), raw.toString())
        val workspace = LocalHabitWorkspace(settings = settings,
            hiddenDefaultTemplates = listOf("daily-plan"))
        val decoded = HabitDocument.decode(HabitDocument.encode(workspace), 0)
        assertEquals(settings.enabled, decoded.settings.enabled)
        assertEquals(settings.notifications, decoded.settings.notifications)
        assertEquals(settings.feedback, decoded.settings.feedback)
        assertEquals("quarter", JSONObject(decoded.settings.rawJson).getString("reportRange"))
        assertEquals(listOf("daily-plan"), decoded.hiddenDefaultTemplates)
    }

    @Test fun deletionPreservesRecoverableHistoryAndAppliesWebLaurelThreshold() {
        val h = habit()
        fun completions(count: Int) = (0 until count).map { offset ->
            HabitCompletion(TrackerEntity("c$offset",stamp,stamp),h.id,day.plusDays(offset.toLong()),true,
                score=10,xpAwarded=10)
        }
        val reward = Rewards.create(25.0,"comeback","seed","seed-reward",stamp)
        val early = deleteHabitFromWorkspace(LocalHabitWorkspace(habits=listOf(h),
            completions=completions(49),rewards=listOf(reward)),h.id,"2026-09-26T10:00:00Z")
        assertEquals("deleted",HabitLifecycle.state(early.habits.single()).status)
        assertEquals(49,early.completions.size)
        assertEquals(0,Rewards.balance(early.rewards))
        assertTrue(early.rewards.any { it.reason=="habit-deleted-reset" })

        val mastered = deleteHabitFromWorkspace(LocalHabitWorkspace(habits=listOf(h),
            completions=completions(50),rewards=listOf(reward)),h.id,"2026-09-26T10:00:00Z")
        assertEquals(25,Rewards.balance(mastered.rewards))
        assertTrue(mastered.rewards.any { it.reason=="habit-mastery-retained" })
    }
}
