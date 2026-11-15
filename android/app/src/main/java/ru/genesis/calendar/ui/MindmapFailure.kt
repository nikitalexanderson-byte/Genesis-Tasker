package ru.genesis.calendar.ui

import ru.genesis.calendar.auth.AuthFailure

/** The transport uses AuthFailure for HTTP, protocol and network errors too. */
internal fun mindmapFailureMessage(error: Throwable): String = if (error is AuthFailure) when (error.kind) {
    AuthFailure.Kind.UNAUTHORIZED -> "Для синхронизации повторите вход. Данные и напоминания доступны на устройстве."
    AuthFailure.Kind.NETWORK -> "Нет подтверждения от сервера. Проверьте сеть и повторите."
    AuthFailure.Kind.RATE_LIMIT -> "Слишком много запросов. Повторите позже."
    AuthFailure.Kind.CONFLICT -> "Данные изменились на другом устройстве. Обновите синхронизацию."
    AuthFailure.Kind.STORAGE -> "Защищённая сессия на устройстве недоступна. Повторите вход; локальные записи не изменены."
    else -> "Не удалось загрузить данные"
} else error.message?.takeIf { it.isNotBlank() } ?: "Не удалось сохранить. Черновик остаётся на устройстве."
