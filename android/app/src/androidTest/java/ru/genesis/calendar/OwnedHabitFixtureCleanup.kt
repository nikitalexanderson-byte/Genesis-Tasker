package ru.genesis.calendar

import androidx.room.withTransaction
import kotlinx.coroutines.runBlocking
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.LocalCipher

/** Current invocation's explicit IDs only. No prefix sweep, reconciliation, ledger reset or queue clear. */
internal fun cleanupOwnedHabitFixtureRows(app: GenesisApplication, ownedIds: Set<String>) {
    check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
    require(ownedIds.none(String::isBlank))
    if (ownedIds.isEmpty()) return
    runBlocking { app.database.withTransaction {
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val record = dao.document(scope, "habits") ?: return@withTransaction
        val outbox = dao.outbox(scope)
        val cipher = LocalCipher()
        val current = HabitDocument.decode(cipher.decrypt(record.encrypted, "$scope/habits"), record.revision)
        val ownQuestIds = current.quests.filter { it.habitId in ownedIds }.map { it.id }.toSet()
        val next = current.copy(habits = current.habits.filterNot { it.id in ownedIds },
            completions = current.completions.filterNot { it.habitId in ownedIds },
            measurements = current.measurements.filterNot { it.habitId in ownedIds },
            history = current.history.filterNot { it.habitId in ownedIds },
            timers = current.timers.filterNot { it.habitId in ownedIds },
            quests = current.quests.filterNot { it.habitId in ownedIds },
            rewards = current.rewards.filterNot { it.sourceId in ownedIds || it.sourceId in ownQuestIds })
        if (next != current) {
            val revision = current.revision + 1
            dao.putDocument(DocumentRecord(scope, "habits", cipher.encrypt(HabitDocument.encode(next), "$scope/habits"), revision))
        }
        // Native debug mutations never enqueue account outbox commands. Preserve any pre-existing queue.
        check(dao.outbox(scope) == outbox)
    } }
}
