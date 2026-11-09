package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.time.*
import java.util.UUID
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

data class HabitNotificationSettings(val enabled: Boolean = false, val motivational: Boolean = true,
    val tone: String = "calm", val dailyGoalTime: String = "20:30",
    val quietHoursStart: String = "22:00", val quietHoursEnd: String = "07:30")

data class HabitFeedbackSettings(val animations: Boolean = true, val sound: Boolean = false,
    val haptics: Boolean = false, val achievementPopups: Boolean = true,
    val questsEnabled: Boolean = true, val gamificationWidgets: Boolean = true, val soundScheme: String = "calm")

private fun defaultHabitSettingsJson() = JSONObject().put("enabled", true)
    .put("nativeAppearance", JSONObject().put("mode", "scheduled")
        .put("lightAt", "07:00").put("darkAt", "21:00"))
    .put("notifications", JSONObject().put("enabled", false).put("motivational", true)
        .put("tone", "calm").put("dailyGoalTime", "20:30")
        .put("quietHoursStart", "22:00").put("quietHoursEnd", "07:30"))
    .put("feedback", JSONObject().put("animations", true).put("sound", false)
        .put("haptics", false).put("achievementPopups", true).put("questsEnabled", true)
        .put("gamificationWidgets", true).put("soundScheme", "calm")).toString()

data class HabitSettings(val enabled: Boolean = true,
    val notifications: HabitNotificationSettings = HabitNotificationSettings(),
    val feedback: HabitFeedbackSettings = HabitFeedbackSettings(), val rawJson: String = defaultHabitSettingsJson())

data class HabitCompletionResult(val newlyUnlockedAchievements: Int = 0)

data class LocalHabitWorkspace(val habits: List<Habit> = emptyList(), val completions: List<HabitCompletion> = emptyList(),
    val goals: List<DailyGoalRecord> = emptyList(), val rewards: List<RewardTransaction> = emptyList(),
    val progress: UserProgress = UserProgress(), val revision: Long = 0,
    val achievementUnlocks: List<AchievementUnlock> = emptyList(),
    val streakFreezeTransactions: List<StreakFreezeTransaction> = emptyList(),
    val quests: List<HabitQuest> = emptyList(), val settings: HabitSettings = HabitSettings(),
    val hiddenDefaultTemplates: List<String> = emptyList(), val measurements: List<HabitMeasurementEvent> = emptyList(),
    val timers: List<HabitTimerOperation> = emptyList(), val timerEpoch: String = "", val history: List<HabitHistoryEdit> = emptyList())

internal const val HABIT_LAUREL_RETENTION_COMPLETIONS = 50

internal fun habitCompletionCount(completions: List<HabitCompletion>, habitId: String): Int = completions
    .asSequence().filter { it.habitId == habitId && it.completed }.map { it.date }.distinct().count()

internal fun deleteHabitFromWorkspace(workspace: LocalHabitWorkspace, habitId: String,
    timestamp: String): LocalHabitWorkspace {
    val habit=workspace.habits.firstOrNull { it.id==habitId } ?: return workspace
    val state=HabitLifecycle.state(habit)
    if(state.status=="deleted") return workspace
    return HabitLifecycleWorkspace.apply(workspace,HabitLifecycleCommand("habit-delete:${UUID.randomUUID()}",habitId,timestamp,"delete",state.heads.map { it.id }))
}

/** Local draft scope only. This document is not a cloud schema-16 import/sync adapter. */
class HabitsRepository(private val app: GenesisApplication) {
    val timerOwner: String by lazy { HabitTimerDevice.owner(app) }
    private val db=app.database
    private val dao=db.dao()
    private val cipher=LocalCipher()
    private val scope=app.workspaceScope
    private val backupMutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private fun engine()=HabitEngine(GenesisCalendar(ZoneId.systemDefault()))
    val workspace=dao.observeDocument(scope,"habits").map { record ->
        if(record == null) LocalHabitWorkspace() else HabitDocument.decode(cipher.decrypt(record.encrypted,"$scope/habits"),record.revision)
    }.flowOn(Dispatchers.IO)

    private suspend fun mutate(preserveEconomy: Boolean = false, skipNoop: Boolean = false, feedback: Boolean = false, change: (LocalHabitWorkspace) -> LocalHabitWorkspace): Pair<LocalHabitWorkspace, LocalHabitWorkspace> {
        lateinit var mutation: Pair<LocalHabitWorkspace, LocalHabitWorkspace>
        db.withTransaction {
            backupMutation.check()
            val record=dao.document(scope,"habits")
            val current=if(record==null) LocalHabitWorkspace() else HabitDocument.decode(cipher.decrypt(record.encrypted,"$scope/habits"),record.revision)
            val changedAt = Instant.now().toString()
            val candidate=observeChangedHabitAvailability(current,HabitTimerWorkspace.finishDisabled(change(current),changedAt,timerOwner),changedAt)
            app.requireQuotaGrowth("habits",current.habits.count { HabitLifecycle.state(it).status!="deleted" },candidate.habits.count { HabitLifecycle.state(it).status!="deleted" },scope)
            // A known lifecycle replay must retain the exact encrypted document and pending outbox identity.
            if (skipNoop && candidate == current) { mutation=current to current; return@withTransaction }
            val lifecycleChanged=candidate.habits.any { habit -> current.habits.firstOrNull { it.id==habit.id }?.let {
                it.lifecycleHistory.filter { row -> row.action!="observe" }!=habit.lifecycleHistory.filter { row -> row.action!="observe" }
            }==true }
            val economy=if(lifecycleChanged) candidate else current
            val projected=reconcile(candidate)
            val next=(if(preserveEconomy || lifecycleChanged) projected.copy(rewards=economy.rewards,streakFreezeTransactions=economy.streakFreezeTransactions,
                achievementUnlocks=economy.achievementUnlocks,quests=economy.quests,progress=projected.progress.copy(lifetimeXp=if(projected.progress.grossLifetimeXp != null) projected.progress.lifetimeXp else economy.progress.lifetimeXp,
                    laurelsBalance=economy.progress.laurelsBalance,streakFreezeCount=economy.progress.streakFreezeCount)) else projected).copy(revision=current.revision+1)
            dao.putDocument(DocumentRecord(scope,"habits",cipher.encrypt(HabitDocument.encode(next),"$scope/habits"),next.revision))
            if (scope.startsWith("account-")) dao.putOutbox(OutboxRecord(scope,"habits",next.revision,UUID.randomUUID().toString()))
            mutation = current to next
        }
        if (feedback) habitFeedbackTransition(scope, mutation.first, mutation.second)?.let(app::offerHabitFeedback)
        app.scheduler.restoreHabitNotifications()
        return mutation
    }

    suspend fun refresh() { if(dao.document(scope,"habits") != null) mutate { it } }
    suspend fun expireIdleHabits(now: Instant = Instant.now()) = mutate(skipNoop=true) { HabitAutoDeleteWorkspace.apply(it,now) }
    suspend fun applyTimer(command: HabitTimerCommand): Pair<LocalHabitWorkspace, LocalHabitWorkspace> {
        if (command.action in setOf("start", "resume")) require(app.featureAccess(scope).allows("habit-timer")) { "FEATURE_SUBSCRIPTION_REQUIRED" }
        return mutate(feedback = true) { workspace ->
            require(command.owner == timerOwner) { "HABIT_TIMER_OTHER_DEVICE" }
            HabitTimerWorkspace.apply(workspace, command)
        }
    }

    suspend fun updateSettings(settings: HabitSettings) = mutate { it.copy(settings = settings) }
    suspend fun correctHistory(command: HabitHistoryCommand) = mutate(preserveEconomy = true) { workspace -> HabitHistory.apply(workspace, command) }
    suspend fun lifecycle(command: HabitLifecycleCommand) = mutate(skipNoop=true) { workspace -> HabitLifecycleWorkspace.apply(workspace,command) }
    suspend fun decideDay(command: HabitDayDecisionCommand) = mutate(preserveEconomy=true, skipNoop=true) { workspace -> HabitDayDecisionWorkspace.apply(workspace,command) }
    suspend fun updateAppearance(value: JSONObject) = mutate { workspace ->
        workspace.copy(settings = workspace.settings.copy(rawJson = JSONObject(workspace.settings.rawJson)
            .put("nativeAppearance", value).toString()))
    }

    suspend fun restoreDefaultTemplates() = mutate { it.copy(hiddenDefaultTemplates = emptyList()) }

    suspend fun resetTracking() = mutate { workspace ->
        LocalHabitWorkspace(revision = workspace.revision, timerEpoch = HabitTimers.nextEpoch(workspace.timerEpoch), settings = workspace.settings.copy(
            rawJson = JSONObject(workspace.settings.rawJson).apply {
                put("dailyGoalModeChanges", JSONArray())
                put("plannedRestDays", JSONArray())
            }.toString()))
    }

    suspend fun save(habit: Habit) = mutate { workspace ->
        require(habit.title.isNotBlank() && habit.title.length<=500) { "Введите название до 500 символов." }
        require(habit.priority in 1..10)
        require(habit.emoji.isNotBlank() && habit.emoji.length<=32)
        require(habit.color.matches(Regex("#[0-9a-fA-F]{6}")))
        require(habit.ritualId in setOf("none","morning","day","evening","custom"))
        require(habit.ritualName.length<=60 && (habit.ritualId!="custom" || habit.ritualName.isNotBlank()))
        require(habit.scoringMode in setOf("none","binary","quality-ten","quality-bipolar"))
        val previous=workspace.habits.firstOrNull { it.id==habit.id }
        require(previous==null || previous.entity.version==habit.entity.version) { "Привычка изменилась. Откройте её заново." }
        habit.stoicheionRestoration?.let { snapshot ->
            require(StoicheionRestorationCodec.decode(StoicheionRestorationCodec.encode(snapshot)) == snapshot) {
                "STOICHEION_RESTORATION_INVALID_SNAPSHOT"
            }
            require(previous?.stoicheionRestoration == null || previous.stoicheionRestoration.cycleId == snapshot.cycleId) {
                "STOICHEION_RESTORATION_HABIT_ALREADY_LINKED"
            }
            require(StoicheionRestoration.canAttach(workspace.habits, habit.id, previous?.stoicheionRestoration, snapshot)) {
                "STOICHEION_RESTORATION_CYCLE_EXISTS"
            }
        }
        require(previous==null || (previous.scoringMode==habit.scoringMode && previous.qualityScale==habit.qualityScale)) {
            "Начисление XP фиксируется при создании привычки. Для другой формулы создайте новую привычку."
        }
        val now=Instant.now().toString()
        val guarded=preserveHabitCreationSettings(habit,previous,LocalDate.now(),now)
        val saved=guarded.copy(entity=guarded.entity.changed(now),schedule=engine().normalizeSchedule(guarded.schedule))
        val others=workspace.habits.filterNot { it.id==habit.id }.map { other ->
            if(saved.isKeyHabit && other.isKeyHabit) other.copy(isKeyHabit=false,entity=other.entity.changed(now)) else other
        }
        val result=workspace.copy(habits=others+saved.copy(active=previous?.active ?: saved.active))
        if(previous!=null && previous.active!=saved.active) HabitLifecycleWorkspace.apply(result,
            HabitLifecycleCommand("habit-state:${UUID.randomUUID()}",saved.id,now,if(saved.active) "resume" else "pause",HabitLifecycle.state(previous).heads.map { it.id }))
        else result
    }

    suspend fun resolveRule(id: String,chosenId: String,heads: List<String>,operationId: String) = mutate { workspace ->
        val habit=workspace.habits.firstOrNull { it.id==id } ?: error("Привычка не найдена")
        val resolved=HabitRuleHistory.resolve(habit,chosenId,heads,operationId)
        workspace.copy(habits=workspace.habits.map { if(it.id==id) resolved else it })
    }

    suspend fun delete(id: String) {
        mutate { workspace -> deleteHabitFromWorkspace(workspace, id, Instant.now().toString()) }
        app.scheduler.restore()
    }

    suspend fun complete(id: String, completed: Boolean, quality: Double? = null,
        date: LocalDate = LocalDate.now()): HabitCompletionResult {
        val (before, after) = mutate(feedback = true) { workspace ->
            val habit=workspace.habits.firstOrNull { it.id==id } ?: error("Привычка не найдена")
            val today=LocalDate.now()
            require(date == today) { "Отметьте привычку в день выполнения." }
            require(engine().isScheduled(habit,date,workspace.completions)) { "На этот день привычка не запланирована." }
            val existing=workspace.completions.firstOrNull { it.habitId==id && it.date==date }
            val measurementState = if(HabitMeasurements.effective(HabitMeasurements.rule(habit,date)) != null)
                HabitMeasurements.progress(habit,date,workspace.measurements) else null
            val entries=if(existing!=null && existing.completed==completed && existing.qualityValue==quality) workspace.completions else
                engine().updateCompletion(workspace.completions,habit,date,today,completed,quality,existing?.note ?: "",
                    measurementCompleted = measurementState?.completed,
                    measurementRewardEligible = measurementState?.let { it.rewardTotal >= it.target } ?: false)
            workspace.copy(completions=entries)
        }
        val known = before.achievementUnlocks.mapTo(hashSetOf()) { it.achievementId }
        return HabitCompletionResult(after.achievementUnlocks.count { it.achievementId !in known })
    }

    suspend fun completeFromReminder(target: HabitReminderTarget, quality: Double? = null) = mutate(feedback = true) { workspace ->
        check(app.workspaceScope == scope) { "HABIT_REMINDER_SCOPE_CHANGED" }
        val habit = workspace.habits.firstOrNull { it.id == target.habitId }
        val action = habitReminderAction(habit, target, workspace.completions, workspace.measurements)
        val measured = habit?.takeIf { HabitMeasurements.effective(HabitMeasurements.rule(it, target.date)) != null }
            ?.let { HabitMeasurements.progress(it, target.date, workspace.measurements) }
        val qualityInput = action == "input" && habit != null && quality != null && habit.qualityScale != "none"
            && measured?.completed != false
            && (habit.intervalSchedule?.completionMode != "each" || habit.intervalSchedule.times().all {
                it in habitIntervalMarks(habit, workspace.completions.firstOrNull { entry -> entry.habitId == habit.id && entry.date == target.date }) })
        require(action in setOf("complete", "interval", "completed") || qualityInput) { "HABIT_REMINDER_$action" }
        if (action == "completed") workspace else {
            val current = requireNotNull(habit)
            val engine = HabitEngine(GenesisCalendar(ZoneId.of(HabitMeasurements.rule(current, target.date).schedule.timezone)))
            val entries = if (action == "interval") engine.updateIntervalCompletion(workspace.completions,
                current, target.date, target.date, requireNotNull(target.intervalTime), true)
            else engine.updateCompletion(workspace.completions, current, target.date, target.date, true,
                quality, workspace.completions.firstOrNull { it.habitId == current.id && it.date == target.date }?.note ?: "",
                measurementCompleted = measured?.completed, measurementRewardEligible = measured?.let { it.rewardTotal >= it.target } ?: false)
            workspace.copy(completions = entries)
        }
    }

    suspend fun recordIntervalFromReminder(target: HabitReminderTarget, time: String, checked: Boolean) = mutate(feedback = true) { workspace ->
        check(app.workspaceScope == scope) { "HABIT_REMINDER_SCOPE_CHANGED" }
        val habit = requireNotNull(workspace.habits.firstOrNull { it.id == target.habitId }) { "HABIT_REMINDER_unavailable" }
        require(habitReminderAction(habit, target, workspace.completions, workspace.measurements) in setOf("input", "interval")) { "HABIT_REMINDER_stale" }
        require(habit.intervalSchedule?.completionMode == "each" && time in habit.intervalSchedule.times())
        val engine = HabitEngine(GenesisCalendar(ZoneId.of(HabitMeasurements.rule(habit, target.date).schedule.timezone)))
        workspace.copy(completions = engine.updateIntervalCompletion(workspace.completions, habit, target.date, target.date, time, checked))
    }

    suspend fun completeInterval(id: String, time: String, completed: Boolean,
        date: LocalDate = LocalDate.now()): HabitCompletionResult {
        val (before, after) = mutate(feedback = true) { workspace ->
            val habit = workspace.habits.firstOrNull { it.id == id } ?: error("Привычка не найдена")
            require(HabitMeasurements.effective(HabitMeasurements.rule(habit,date)) == null)
            require(date == LocalDate.now()) { "Отметьте привычку в день выполнения." }
            require(engine().isScheduled(habit,date,workspace.completions)) { "На этот день привычка не запланирована." }
            workspace.copy(completions = engine().updateIntervalCompletion(workspace.completions,
                habit,date,LocalDate.now(),time,completed))
        }
        val known = before.achievementUnlocks.mapTo(hashSetOf()) { it.achievementId }
        return HabitCompletionResult(after.achievementUnlocks.count { it.achievementId !in known })
    }

    suspend fun recordMeasurement(id: String, date: LocalDate, value: Long?, entryId: String? = null,
        replaces: List<String> = emptyList(), note: String = "", operationId: String = "habit-value-${UUID.randomUUID()}",
        reminderTarget: HabitReminderTarget? = null) = mutate(feedback = true) { workspace ->
        val habit = workspace.habits.firstOrNull { it.id == id } ?: error("Привычка не найдена")
        if (reminderTarget != null) {
            check(app.workspaceScope == scope) { "HABIT_REMINDER_SCOPE_CHANGED" }
            require(reminderTarget.habitId == id && reminderTarget.date == date &&
                habitReminderAction(habit, reminderTarget, workspace.completions, workspace.measurements) == "input") { "HABIT_REMINDER_stale" }
        } else require(date == LocalDate.now() && engine().isScheduled(habit,date,workspace.completions)) { "На этот день привычка не запланирована." }
        val measurements = HabitMeasurements.append(habit,date,value,workspace.measurements,entryId,replaces,note,operationId)
        workspace.copy(measurements = measurements, completions = HabitMeasurements.project(workspace.habits,
            measurements,workspace.completions,LocalDate.now(),Instant.now().toString()))
    }

    suspend fun claimHeroPathAmphora(rankId: String) = mutate { workspace ->
        workspace.copy(rewards = HeroPathRewards.claim(workspace.progress, workspace.rewards,
            rankId, Instant.now().toString()))
    }

    suspend fun buyHestiaSpark() = mutate { workspace ->
        val (rewards, freezes) = StreakProtection.purchase(workspace.rewards,
            workspace.streakFreezeTransactions, UUID.randomUUID().toString(), Instant.now().toString())
        workspace.copy(rewards = rewards, streakFreezeTransactions = freezes)
    }

    suspend fun revealHiddenHeroicPath() = mutate { workspace ->
        val current = workspace.progress
        require(HeroProgress.hiddenUnlocked(current.lifetimeXp)) { "Врата ещё закрыты." }
        if (current.hiddenHeroicPathRevealedAt != null) workspace else workspace.copy(
            progress = current.copy(hiddenHeroicPathRevealedAt = Instant.now().toString()))
    }

    private fun reconcile(workspace: LocalHabitWorkspace): LocalHabitWorkspace {
        val now = Instant.now().toString()
        val measured = HabitMeasurements.project(workspace.habits,workspace.measurements,workspace.completions,LocalDate.now(),now)
        val projected = workspace.copy(completions = HabitHistory.project(workspace.habits,workspace.history,measured,workspace.measurements))
        return reconcileHabitWorkspace(projected,LocalDate.now(),ZoneId.systemDefault().id,now)
    }
}

    /** Local day closing, automatic protection and deterministic reward reconciliation. */
    internal fun reconcileHabitWorkspace(workspace: LocalHabitWorkspace, today: LocalDate, zone: String, timestamp: String): LocalHabitWorkspace {
        fun engine()=HabitEngine(GenesisCalendar(ZoneId.of(zone)))
        val previous=DailyGoals.normalize(workspace.goals)
        val protectableDates=mutableSetOf<LocalDate>()
        val timezoneBoundary=previous.lastOrNull { it.date<=today }?.takeIf { it.timezone!=zone }?.let { today.minusDays(1) }
        var goals=previous.map { record ->
            if(record.status=="open" && record.date<today) DailyGoals.build(record.date,record.mode,record.timezone,
                record.scheduledCount.toDouble(),record.completedCount.toDouble(),today,record.updatedAt,
                isTimezoneShift=record.date==timezoneBoundary).also {
                    if(it.status=="missed") protectableDates += it.date
                } else record
        }
        val latest=goals.lastOrNull { it.date<=today }?.date
        val earliest=(workspace.habits.filter { it.active }.map { it.schedule.startDate }+workspace.completions.map { it.date }).minOrNull()
        var cursor=latest?.plusDays(1) ?: earliest?.coerceAtLeast(today.minusDays(3699)) ?: today
        while(cursor<=today) {
            var record=engine().dailyGoalForDate(workspace.habits,workspace.completions,goals,emptyList(),emptySet(),cursor,today,timestamp,workspace.measurements)
            if(cursor==timezoneBoundary) record=record.copy(timezone=zone,status="timezone-shift")
            if(record.status=="missed") protectableDates += record.date
            goals=DailyGoals.normalize(goals+record)
            cursor=cursor.plusDays(1)
        }
        workspace.history.map { it.date }.distinct().filter { it < today }.forEach { date ->
            val changed = engine().dailyGoalForDate(workspace.habits,workspace.completions,goals,emptyList(),emptySet(),date,today,timestamp,workspace.measurements)
            goals = DailyGoals.normalize(goals.filterNot { it.date == date } + changed)
            protectableDates -= date
        }
        val current=engine().dailyGoalForDate(workspace.habits,workspace.completions,goals,emptyList(),emptySet(),today,today,timestamp,workspace.measurements)
        goals=DailyGoals.normalize(goals.filterNot { it.date==today }+current)
        val (protectedGoals, freezes)=StreakProtection.protect(goals,workspace.streakFreezeTransactions,
            protectableDates,today,timestamp)
        goals=protectedGoals
        // The website retired per-missed-habit Laurel resets. Normalization also repairs old
        // local ledgers by ignoring those entries without discarding legitimate awards.
        val questsEnabled = workspace.settings.feedback.questsEnabled
        val hasPeriods=workspace.habits.any { it.periodGoal!=null || it.ruleHistory.any { rule -> rule.periodGoal!=null } }
        val economy = HabitHistory.economy(workspace)
        val rewardGoals=if(hasPeriods || workspace.history.isNotEmpty()) goals.map { record ->
            val (scheduled,completed)=engine().dailyCounts(economy.habits,economy.completions,record.date,economy.measurements,today,true)
            DailyGoals.build(record.date,record.mode,record.timezone,scheduled.toDouble(),completed.toDouble(),today,record.updatedAt,
                isRestDay=record.status=="rest",isTimezoneShift=record.status=="timezone-shift",isStreakProtected=record.status=="protected")
        } else goals
        val projected=if(hasPeriods) HabitPeriodGoals.goalCompletions(economy.habits,economy.measurements,economy.completions,
            (workspace.quests.map { it.startDate }+workspace.habits.map { it.createdDate }).minOrNull() ?: today,today,Instant.parse(timestamp)) else economy.completions
        val quests=if (questsEnabled) HabitQuests.reconcile(workspace.quests,workspace.habits,projected,
            rewardGoals,today,timestamp) { habit,date ->
                val goal=HabitMeasurements.rule(habit,date).periodGoal
                if(goal!=null) HabitPeriodGoals.settlement(habit,date,economy.measurements,economy.completions,
                    today.atTime(12,0).atZone(ZoneId.of(goal.context.timeZone)).toInstant())!=null else engine().isScheduled(habit,date,workspace.completions)
            } else workspace.quests
        val practiceLedger=HabitPracticeGoals.penalties(workspace.habits,workspace.completions,workspace.rewards,today,Instant.parse(timestamp))
        val nonQuestLedger=StreakProtection.reconcileComeback(rewardGoals,
            StreakRewards.reconcile(rewardGoals,Rewards.reconcileDailyGoals(rewardGoals,practiceLedger,today)),today)
        val ledger=if (questsEnabled) HabitQuests.reconcileRewards(quests,nonQuestLedger) else nonQuestLedger
        val progress=HeroProgress.reconcile(workspace.progress,habitCompletionCredits(HabitPracticeGoals.xpEntries(workspace.habits,workspace.completions)),timestamp,
            DailyGoals.streak(goals,today),Rewards.balance(ledger),streakFreezeCount=StreakProtection.count(freezes),
            rhythmScore=DailyGoals.rhythmScore(goals,today))
        val unlocks=Achievements.reconcile(workspace.achievementUnlocks,projected,rewardGoals,
            if(workspace.history.isEmpty()) progress.longestStreak else DailyGoals.streak(rewardGoals,today).longestStreak,ledger,timestamp)
        return HabitAutoDeleteWorkspace.reconcilePoints(workspace.copy(goals=goals,rewards=ledger,progress=progress,achievementUnlocks=unlocks,
            streakFreezeTransactions=freezes,quests=quests))
    }
/** Explicit local format, never presented as the full synced HabitWorkspace schema. */
internal object HabitDocument {
    private fun JSONArray.objects()=(0 until length()).map { getJSONObject(it) }
    private fun ints(array: JSONArray)=(0 until array.length()).map { array.getInt(it) }
    private fun JSONObject.nullable(key: String)=if(isNull(key)) null else getString(key).takeIf(String::isNotBlank)
    private fun entity(v: JSONObject)=TrackerEntity(v.getString("id"),v.getString("createdAt"),v.getString("updatedAt"),v.getInt("version"),v.getString("syncState"))
    private fun entity(e: TrackerEntity)=JSONObject().put("id",e.id).put("createdAt",e.createdAt).put("updatedAt",e.updatedAt).put("version",e.version).put("syncState",e.syncState)
    private fun recurrence(c: RecurrenceConfig)=JSONObject().put("enabled",c.enabled).put("mode",c.mode).put("pattern",c.pattern).put("days",JSONArray(c.days))
        .put("interval",c.interval).put("rangeStart",c.rangeStart).put("rangeEnd",c.rangeEnd).put("months",JSONArray(c.months)).put("pyatas",JSONArray(c.pyatas)).put("calendarContext",calendarContextJson(c.calendarContext)).put("invalidDayPolicy","skip")
    private fun recurrence(c: JSONObject)=RecurrenceConfig(c.getBoolean("enabled"),c.getString("mode"),c.getString("pattern"),ints(c.getJSONArray("days")),
        c.getInt("interval"),c.getString("rangeStart"),c.getString("rangeEnd"),ints(c.getJSONArray("months")),ints(c.getJSONArray("pyatas")),calendarContextFromJson(c.optJSONObject("calendarContext")))
    private fun measurement(value: HabitMeasurement) = JSONObject().put("kind",value.kind).put("unit",value.unit)
        .put("target",value.target).put("quickAdd",value.quickAdd)
    private fun measurement(value: JSONObject) = HabitMeasurement(value.getString("kind"),value.getString("unit"),
        value.getLong("target").also { require(value.getDouble("target") == it.toDouble()) },
        value.getLong("quickAdd").also { require(value.getDouble("quickAdd") == it.toDouble()) })
    private fun optionalMeasurement(value: JSONObject): HabitMeasurement? =
        if(value.isNull("measurement")) null else measurement(value.getJSONObject("measurement"))
    private fun periodGoal(value: HabitPeriodGoal) = JSONObject().put("version",value.version).put("period",value.period)
        .put("metric",value.metric).put("target",value.target).put("calendar",value.calendar).put("context",calendarContextJson(value.context))
    private fun optionalPeriodGoal(value: JSONObject): HabitPeriodGoal? = if(value.isNull("periodGoal")) null else {
        val goal = value.getJSONObject("periodGoal")
        require(goal.get("target") is Number && goal.getDouble("version")==1.0) { "INVALID_HABIT_PERIOD_GOAL" }
        HabitPeriodGoal(goal.getInt("version"),goal.getString("period"),goal.getString("metric"),
            goal.getLong("target").also { require(goal.getDouble("target") == it.toDouble()) },goal.getString("calendar"),
            requireNotNull(calendarContextFromJson(goal.getJSONObject("context"))))
    }
    private fun optionalRules(value: JSONObject): List<HabitRuleVersion> =
        if(value.isNull("ruleHistory")) emptyList() else value.getJSONArray("ruleHistory").objects().map(::rule).also { rules ->
            HabitRuleHistory.validate(rules)
        }
    private fun schedule(value: TrackerSchedule) = JSONObject().put("startDate",value.startDate.toString())
        .put("endDate",value.endDate?.toString() ?: JSONObject.NULL).put("timezone",value.timezone).put("recurrence",recurrence(value.recurrence))
    private fun schedule(value: JSONObject) = TrackerSchedule(LocalDate.parse(value.getString("startDate")),
        value.nullable("endDate")?.let(LocalDate::parse),value.getString("timezone"),recurrence(value.getJSONObject("recurrence")))
    private fun rule(value: HabitRuleVersion) = JSONObject().put("id",value.id).put("effectiveDate",value.effectiveDate.toString())
        .put("recordedAt",value.recordedAt).put("measurement",value.measurement?.let(::measurement) ?: JSONObject.NULL)
        .put("schedule",schedule(value.schedule)).apply {
            value.periodGoal?.let { put("periodGoal",periodGoal(it)) }
            value.supersedes?.let { put("supersedes",JSONArray(it)) }
            value.selectedRuleId?.let { put("selectedRuleId",it) }
        }
    private fun rule(value: JSONObject) = HabitRuleVersion(value.getString("id"),LocalDate.parse(value.getString("effectiveDate")),
        value.getString("recordedAt"),optionalMeasurement(value),schedule(value.getJSONObject("schedule")),optionalPeriodGoal(value),
        if(value.has("supersedes")) value.getJSONArray("supersedes").let { rows -> (0 until rows.length()).map {
            (rows.get(it) as? String) ?: error("INVALID_HABIT_RULE_HISTORY") } }.sorted() else null,
        if(value.has("selectedRuleId")) (value.get("selectedRuleId") as? String) ?: error("INVALID_HABIT_RULE_HISTORY") else null)
    private fun measurementEvent(value: HabitMeasurementEvent) = entity(value.entity).put("habitId",value.habitId)
        .put("date",value.date.toString()).put("entryId",value.entryId).put("ruleId",value.ruleId)
        .put("replaces",JSONArray(value.replaces)).put("value",value.value ?: JSONObject.NULL).put("note",value.note)
        .put("source",value.source).put("historical",value.historical)
    private fun measurementEvent(value: JSONObject): HabitMeasurementEvent {
        require(value.has("value"))
        val amount = if(value.isNull("value")) null else value.getLong("value").also { require(it.toDouble() == value.getDouble("value")) }
        return HabitMeasurementEvent(entity(value),value.getString("habitId"),LocalDate.parse(value.getString("date")),
            value.getString("entryId"),value.getString("ruleId"),value.getJSONArray("replaces").let { ids ->
                (0 until ids.length()).map { ids.getString(it) } },amount,value.optString("note"),value.getString("source"),value.optBoolean("historical"))
    }
    private fun habit(h: Habit): JSONObject = entity(h.entity).put("title",h.title).put("description",h.description).put("createdDate",h.createdDate.toString())
        .put("measurement",h.measurement?.let(::measurement) ?: JSONObject.NULL).put("ruleHistory",JSONArray(h.ruleHistory.map(::rule)))
        .apply {
            put("autoDeletePolicy",h.autoDeletePolicy?.let { p -> JSONObject().put("version",p.version).put("id",p.id)
                .put("count",p.count).put("unit",p.unit).put("points",p.points).put("startOn",p.startOn.toString()) } ?: JSONObject.NULL)
            h.periodGoal?.let { put("periodGoal",periodGoal(it)) }
            put("lifecycleHistory",HabitLifecycleCodec.encode(h.lifecycleHistory))
            h.stoicheionRestoration?.let { put("stoicheionRestoration",StoicheionRestorationCodec.encode(it)) }
            h.practiceGoal?.let { put("practiceGoal",JSONObject().put("version",it.version).put("requiredCompletions",it.requiredCompletions).put("penaltyLaurels",it.penaltyLaurels)
                .apply { it.startDate?.let { start -> put("startDate",start.toString()) } }) }
        }
        .put("emoji",h.emoji).put("priority",h.priority).put("isKeyHabit",h.isKeyHabit).put("ritualId",h.ritualId).put("ritualName",h.ritualName).put("color",h.color)
        .put("active",h.active).put("timerEnabled",h.timerEnabled).put("sourceTemplateId",h.sourceTemplateId ?: JSONObject.NULL).put("sacredPracticeId",h.sacredPracticeId ?: JSONObject.NULL)
        .put("timerPreferences",h.timerPreferences?.let { p -> JSONObject().put("modes",JSONArray(p.modes))
            .put("workMinutes",p.workMinutes).put("breakMinutes",p.breakMinutes).put("progress",p.progress) } ?: JSONObject.NULL)
        .put("sacredSectorId",h.sacredSectorId ?: JSONObject.NULL).put("preferredTime",h.preferredTime).put("scoringMode",h.scoringMode).put("qualityScale",h.qualityScale)
        .put("intervalSchedule",h.intervalSchedule?.let { interval -> JSONObject().put("intervalMinutes",interval.intervalMinutes)
            .put("startTime",interval.startTime).put("endTime",interval.endTime).put("completionMode",interval.completionMode) } ?: JSONObject.NULL)
        .put("schedule",JSONObject().put("startDate",h.schedule.startDate.toString()).put("endDate",h.schedule.endDate?.toString() ?: JSONObject.NULL)
            .put("timezone",h.schedule.timezone).put("recurrence",recurrence(h.schedule.recurrence)))
        .put("reminder",JSONObject().put("enabled",h.reminder.enabled).put("time",h.reminder.time).put("syncToGoogleTasks",h.reminder.syncToGoogleTasks)
            .put("timing",h.reminder.timing).put("minutesBefore",h.reminder.minutesBefore)
            .put("allowDuringQuietHours",h.reminder.allowDuringQuietHours)
            .put("showInGoogleCalendar",h.reminder.showInGoogleCalendar).put("googleTaskId",h.reminder.googleTaskId ?: JSONObject.NULL).put("googleEventId",h.reminder.googleEventId ?: JSONObject.NULL))
    private fun habit(v: JSONObject): Habit {
        val s=v.getJSONObject("schedule"); val r=v.getJSONObject("reminder")
        return HabitLifecycle.project(Habit(entity(v),v.getString("title"),LocalDate.parse(v.getString("createdDate")),
            TrackerSchedule(LocalDate.parse(s.getString("startDate")),s.nullable("endDate")?.let(LocalDate::parse),s.getString("timezone"),recurrence(s.getJSONObject("recurrence"))),
            v.getString("description"),v.getString("emoji"),v.getInt("priority"),v.getBoolean("isKeyHabit"),v.getString("ritualId"),v.getString("ritualName"),v.getString("color"),
            v.getBoolean("active"),v.nullable("sourceTemplateId"),v.nullable("sacredPracticeId"),v.nullable("sacredSectorId"),v.getString("preferredTime"),v.getString("scoringMode"),v.getString("qualityScale"),
            HabitReminder(r.getBoolean("enabled"),r.getString("time"),r.getBoolean("syncToGoogleTasks"),r.getBoolean("showInGoogleCalendar"),r.nullable("googleTaskId"),r.nullable("googleEventId"),
                r.optString("timing").takeIf { it in setOf("habit", "custom") } ?: if (v.getString("preferredTime").isNotBlank() &&
                    r.getString("time") != v.getString("preferredTime")) "custom" else "habit",
                r.optInt("minutesBefore",0).coerceIn(0,1440),r.optBoolean("allowDuringQuietHours",false)))
            .copy(measurement = optionalMeasurement(v), ruleHistory = optionalRules(v), periodGoal = optionalPeriodGoal(v),
                timerEnabled = v.optBoolean("timerEnabled", true),
                timerPreferences = v.optJSONObject("timerPreferences")?.let { p ->
                    HabitTimerPreferences(p.getJSONArray("modes").let { a -> (0 until a.length()).map(a::getString) },
                        p.getInt("workMinutes"),p.getInt("breakMinutes"),p.getString("progress")) },
                autoDeletePolicy = if(v.isNull("autoDeletePolicy")) null else v.getJSONObject("autoDeletePolicy").let { p ->
                    HabitAutoDeletePolicy(p.getInt("version"),p.getString("id"),p.getInt("count"),p.getString("unit"),p.getString("points"),LocalDate.parse(p.getString("startOn"))) },
                lifecycleHistory = if(v.has("lifecycleHistory")) HabitLifecycleCodec.decode(v.getJSONArray("lifecycleHistory")) else emptyList(),
                stoicheionRestoration = StoicheionRestorationCodec.decode(v.optJSONObject("stoicheionRestoration")),
                practiceGoal = v.optJSONObject("practiceGoal")?.let { HabitPracticeGoal(it.getInt("version"),it.getInt("requiredCompletions"),it.getInt("penaltyLaurels"),it.nullable("startDate")?.let(LocalDate::parse)) },
                intervalSchedule = v.optJSONObject("intervalSchedule")?.let { interval ->
                HabitIntervalSchedule(interval.optInt("intervalMinutes"),interval.optString("startTime"),
                    interval.optString("endTime"),if(interval.optString("completionMode")=="day") "day" else "each").takeIf { it.valid() } }))
    }
    fun encode(w: LocalHabitWorkspace): String {
        val p=w.progress
        return JSONObject().put("localSchema",1).put("habits",JSONArray(w.habits.map(::habit)))
            .put("measurements",JSONArray(w.measurements.map(::measurementEvent)))
            .put("timers",HabitTimerCodec.encode(w.timers))
            .put("history",HabitHistoryCodec.encode(w.history))
            .put("timerEpoch",HabitTimers.workspaceEpoch(w.timerEpoch,w.history.isNotEmpty(),w.habits.any { it.lifecycleHistory.isNotEmpty() }
                || w.history.any { it.source=="decision" } || w.completions.any { it.skippedAt!=null }))
            .put("completions",JSONArray(w.completions.map { c -> entity(c.entity).put("habitId",c.habitId).put("date",c.date.toString()).put("completed",c.completed)
                .put("qualityConfirmedAt",c.qualityConfirmedAt ?: JSONObject.NULL).put("qualityValue",c.qualityValue ?: JSONObject.NULL).put("score",c.score).put("xpAwarded",c.xpAwarded).put("note",c.note)
                .put("completedTimes",JSONArray(c.completedTimes)).apply { c.skippedAt?.let { put("skippedAt",it) } } }))
            .put("goals",JSONArray(w.goals.map { g -> JSONObject().put("date",g.date.toString()).put("mode",g.mode).put("timezone",g.timezone).put("scheduledCount",g.scheduledCount)
                .put("completedCount",g.completedCount).put("targetCount",g.targetCount).put("status",g.status).put("updatedAt",g.updatedAt) }))
            .put("rewards",JSONArray(w.rewards.map { t -> JSONObject().put("id",t.id).put("amount",t.amount).put("reason",t.reason).put("sourceId",t.sourceId)
                .put("idempotencyKey",t.idempotencyKey).put("createdAt",t.createdAt).put("userId",t.userId).put("currency",t.currency) }))
            .put("achievementUnlocks",JSONArray(w.achievementUnlocks.map { unlock ->
                JSONObject().put("achievementId",unlock.achievementId).put("unlockedAt",unlock.unlockedAt) }))
            .put("streakFreezeTransactions",JSONArray(w.streakFreezeTransactions.map { item ->
                JSONObject().put("amount",item.amount).put("reason",item.reason).put("sourceId",item.sourceId)
                    .put("idempotencyKey",item.idempotencyKey).put("createdAt",item.createdAt) }))
            .put("quests",JSONArray(w.quests.map { q -> entity(q.entity).put("cadence",q.cadence)
                .put("kind",q.kind).put("habitId",q.habitId ?: JSONObject.NULL)
                .put("startDate",q.startDate.toString()).put("endDate",q.endDate.toString())
                .put("target",q.target).put("progress",q.progress).put("rewardLaurels",q.rewardLaurels)
                .put("completedAt",q.completedAt ?: JSONObject.NULL) }))
            .put("settings", settings(w.settings))
            .put("hiddenDefaultTemplates", JSONArray(w.hiddenDefaultTemplates))
            .put("progress",JSONObject().put("lifetimeXp",p.lifetimeXp).put("laurelsBalance",p.laurelsBalance).put("currentRankId",p.currentRankId ?: JSONObject.NULL)
                .put("hiddenHeroicPathRevealedAt",p.hiddenHeroicPathRevealedAt ?: JSONObject.NULL).put("currentStreak",p.currentStreak).put("longestStreak",p.longestStreak)
                .put("lastQualifiedDate",p.lastQualifiedDate?.toString() ?: JSONObject.NULL).put("streakGoalMode",p.streakGoalMode).put("streakFreezeCount",p.streakFreezeCount)
                .put("rhythmScore",p.rhythmScore).put("updatedAt",p.updatedAt).apply {
                    p.grossLifetimeXp?.let { put("grossLifetimeXp",it) }; p.forfeitedHabitXp?.let { put("forfeitedHabitXp",it) }
                }).toString()
    }
    fun decode(json: String, revision: Long): LocalHabitWorkspace {
        val v=JSONObject(json); require(v.getInt("localSchema")==1) { "Неподдерживаемая версия локальных привычек" }
        val p=v.getJSONObject("progress")
        return LocalHabitWorkspace(v.getJSONArray("habits").objects().map(::habit),v.getJSONArray("completions").objects().map { c ->
            HabitCompletion(entity(c),c.getString("habitId"),LocalDate.parse(c.getString("date")),c.getBoolean("completed"),if(c.isNull("qualityValue")) null else c.getDouble("qualityValue"),c.getInt("score"),c.getInt("xpAwarded"),c.getString("note"),c.optString("qualityConfirmedAt").takeUnless { it.isBlank() || it == "null" },
                c.optJSONArray("completedTimes")?.let { times -> (0 until times.length()).map { times.optString(it) }.filter { Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(it) }.distinct().sorted().take(1440) }.orEmpty(),c.nullable("skippedAt")) },
            v.getJSONArray("goals").objects().map { g -> DailyGoalRecord(LocalDate.parse(g.getString("date")),g.getString("mode"),g.getString("timezone"),g.getInt("scheduledCount"),g.getInt("completedCount"),g.getInt("targetCount"),g.getString("status"),g.getString("updatedAt")) },
            v.getJSONArray("rewards").objects().map { t -> RewardTransaction(t.getString("id"),t.getInt("amount"),t.getString("reason"),t.getString("sourceId"),t.getString("idempotencyKey"),t.getString("createdAt"),t.getString("userId"),t.getString("currency")) },
            UserProgress(p.getInt("lifetimeXp"),p.getInt("laurelsBalance"),p.nullable("currentRankId"),p.nullable("hiddenHeroicPathRevealedAt"),p.getInt("currentStreak"),p.getInt("longestStreak"),p.nullable("lastQualifiedDate")?.let(LocalDate::parse),p.getString("streakGoalMode"),p.getInt("streakFreezeCount"),p.getInt("rhythmScore"),p.getString("updatedAt"),if(p.isNull("grossLifetimeXp")) null else p.getInt("grossLifetimeXp"),if(p.isNull("forfeitedHabitXp")) null else p.getInt("forfeitedHabitXp")),revision,
            Achievements.normalize(v.optJSONArray("achievementUnlocks")?.objects()?.map { unlock ->
                AchievementUnlock(unlock.getString("achievementId"),unlock.getString("unlockedAt"))
            } ?: emptyList()),StreakProtection.normalize(v.optJSONArray("streakFreezeTransactions")?.objects()?.map { item ->
                StreakFreezeTransaction(item.getInt("amount"),item.getString("reason"),item.getString("sourceId"),
                    item.getString("idempotencyKey"),item.getString("createdAt"))
            } ?: emptyList()),HabitQuests.normalize(v.optJSONArray("quests")?.objects()?.map { q ->
                HabitQuest(entity(q),q.getString("cadence"),q.getString("kind"),q.nullable("habitId"),
                    LocalDate.parse(q.getString("startDate")),LocalDate.parse(q.getString("endDate")),
                    q.getInt("target"),q.getInt("progress"),q.getInt("rewardLaurels"),q.nullable("completedAt"))
            } ?: emptyList()), settings(v.optJSONObject("settings")),
            v.optJSONArray("hiddenDefaultTemplates")?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
            } ?: emptyList(), if(v.isNull("measurements")) emptyList() else v.getJSONArray("measurements").objects().map(::measurementEvent),
            if(v.isNull("timers")) emptyList() else HabitTimerCodec.decode(v.getJSONArray("timers"), HabitTimerCodec.epoch(v, "timerEpoch")),
            HabitTimerCodec.epoch(v, "timerEpoch"), HabitHistoryCodec.decode(v.optJSONArray("history") ?: JSONArray(),HabitTimerCodec.epoch(v, "timerEpoch"))).let { workspace ->
                val timerIds = HabitTimers.measurementIds(workspace.timers)
                workspace.copy(measurements = workspace.measurements.filter { !it.entryId.startsWith("timer-value:") || it.entryId in timerIds })
            }
    }

    private fun settings(value: HabitSettings): JSONObject {
        val root = runCatching { JSONObject(value.rawJson) }.getOrElse { JSONObject() }
        root.put("enabled", value.enabled)
        root.put("notifications", JSONObject().put("enabled", value.notifications.enabled)
            .put("motivational", value.notifications.motivational).put("tone", value.notifications.tone)
            .put("dailyGoalTime", value.notifications.dailyGoalTime)
            .put("quietHoursStart", value.notifications.quietHoursStart)
            .put("quietHoursEnd", value.notifications.quietHoursEnd))
        root.put("feedback", JSONObject().put("animations", value.feedback.animations)
            .put("sound", value.feedback.sound).put("haptics", value.feedback.haptics)
            .put("achievementPopups", value.feedback.achievementPopups)
            .put("questsEnabled", value.feedback.questsEnabled)
            .put("gamificationWidgets", value.feedback.gamificationWidgets).apply {
                // Preserve the raw shape of old portable backups until a scheme is selected.
                if (value.feedback.soundScheme != "calm" || root.optJSONObject("feedback")?.has("soundScheme") == true)
                    put("soundScheme", habitSoundScheme(value.feedback.soundScheme))
            })
        return root
    }

    private fun settings(value: JSONObject?): HabitSettings {
        val root = value ?: JSONObject(defaultHabitSettingsJson())
        val notifications = root.optJSONObject("notifications") ?: JSONObject()
        val feedback = root.optJSONObject("feedback") ?: JSONObject()
        fun time(name: String, fallback: String) = notifications.optString(name)
            .takeIf { Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(it) } ?: fallback
        return HabitSettings(root.optBoolean("enabled", true), HabitNotificationSettings(
            notifications.optBoolean("enabled", false), notifications.optBoolean("motivational", true),
            notifications.optString("tone").takeIf { it in setOf("calm", "heroic", "ironic") } ?: "calm",
            time("dailyGoalTime", "20:30"), time("quietHoursStart", "22:00"), time("quietHoursEnd", "07:30")),
            HabitFeedbackSettings(feedback.optBoolean("animations", true), feedback.optBoolean("sound", false),
                feedback.optBoolean("haptics", false), feedback.optBoolean("achievementPopups", true),
                feedback.optBoolean("questsEnabled", true), feedback.optBoolean("gamificationWidgets", true), habitSoundScheme(feedback.optString("soundScheme"))),
            root.toString())
    }
}
