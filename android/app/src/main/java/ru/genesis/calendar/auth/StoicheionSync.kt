package ru.genesis.calendar.auth

import kotlinx.coroutines.delay

/** Retry only this idempotent read. A draw/roll must never be repeated automatically. */
internal suspend fun <T> stoicheionReadWithRetry(pause: suspend () -> Unit = { delay(700) }, read: suspend () -> T): T {
    try { return read() }
    catch (error: AuthFailure) {
        if (error.kind !in setOf(AuthFailure.Kind.NETWORK, AuthFailure.Kind.SERVER)) throw error
        pause()
        return read()
    }
}

internal class StoicheionSyncFailure(val kind: AuthFailure.Kind, cause: AuthFailure) : Exception(when (kind) {
    AuthFailure.Kind.UNAUTHORIZED -> "Сессия аккаунта завершилась. Повторите вход и выбор карты."
    AuthFailure.Kind.RATE_LIMIT -> "Слишком много запросов. Повторите выбор карты через минуту."
    AuthFailure.Kind.NETWORK -> "Нет подтверждения от сервера. Проверьте сеть; прежний выбор карты сохранён."
    AuthFailure.Kind.SERVER -> "Сервер временно недоступен. Прежний выбор карты сохранён. Повторите обновление позже."
    else -> "Не удалось безопасно синхронизировать карту с аккаунтом."
}, cause)
