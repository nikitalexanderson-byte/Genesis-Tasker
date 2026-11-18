package ru.genesis.calendar.data

import androidx.room.RoomDatabase
import androidx.room.withTransaction as roomWithTransaction
import kotlinx.coroutines.asContextElement
import kotlinx.coroutines.withContext

/** All app-owned Room transaction bodies carry this context across dispatcher
 * hops. It contains no account/key data. Legacy IO checks it before taking scope
 * locks, avoiding both lock inversion and Room's library-restricted probe API. */
private val roomTransactionContext=ThreadLocal<Boolean>()
internal fun genesisRoomTransactionActive()=roomTransactionContext.get()==true

/** Use the supported Room transaction API for actual commit/rollback and its
 * dispatcher. The additional context also restores correctly after nesting,
 * exceptions and cancellation. Never detach work from this transaction body. */
internal suspend fun <T> RoomDatabase.withTransaction(operation:suspend ()->T):T=roomWithTransaction {
    withContext(roomTransactionContext.asContextElement(true)){operation()}
}
