package ru.genesis.calendar.ui

/** Update/install wording is separate from refreshing data or a time-rule's "after". */
internal data class AppUpdateCopy(val title: String, val action: String, val later: String)
private val appUpdateCopies = mapOf(
    "ru" to AppUpdateCopy("Вышла новая версия приложения", "Обновить", "Позже"),
    "en" to AppUpdateCopy("A new app version is available", "Update", "Later"),
    "el" to AppUpdateCopy("Διατίθεται νέα έκδοση της εφαρμογής", "Ενημέρωση", "Αργότερα"),
    "de" to AppUpdateCopy("Eine neue App-Version ist verfügbar", "Aktualisieren", "Später"),
    "fr" to AppUpdateCopy("Une nouvelle version est disponible", "Mettre à jour", "Plus tard"),
    "es" to AppUpdateCopy("Hay una nueva versión de la aplicación", "Actualizar", "Más tarde"),
    "it" to AppUpdateCopy("È disponibile una nuova versione", "Aggiorna", "Più tardi"),
    "pt" to AppUpdateCopy("Há uma nova versão do aplicativo", "Atualizar", "Mais tarde"),
    "pl" to AppUpdateCopy("Dostępna jest nowa wersja aplikacji", "Zaktualizuj", "Później"),
    "sr" to AppUpdateCopy("Доступна је нова верзија апликације", "Ажурирај", "Касније"),
    "uk" to AppUpdateCopy("Вийшла нова версія застосунку", "Оновити", "Пізніше"),
    "zh" to AppUpdateCopy("应用有新版本", "更新", "稍后"),
    "tr" to AppUpdateCopy("Uygulamanın yeni sürümü çıktı", "Güncelle", "Daha sonra"),
    "ja" to AppUpdateCopy("アプリの新しいバージョンがあります", "更新する", "後で"),
)

internal fun appUpdateCopy(language: String): AppUpdateCopy = appUpdateCopies[language] ?: appUpdateCopies.getValue("ru")
