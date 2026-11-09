package ru.genesis.calendar.reminders

internal data class NotificationAuxCopy(val achievementTitle: String, val achievementBody: String,
    val diagnosticTitle: String, val diagnosticBody: String)

internal fun notificationChannelNames(language: String): List<String> = mapOf(
    "ru" to listOf("Задачи и события", "Привычки", "Дневная цель", "Достижения", "Синхронизация"),
    "en" to listOf("Tasks and events", "Habits", "Daily goal", "Achievements", "Sync"),
    "el" to listOf("Εργασίες και συμβάντα", "Συνήθειες", "Ημερήσιος στόχος", "Επιτεύγματα", "Συγχρονισμός"),
    "de" to listOf("Aufgaben und Ereignisse", "Gewohnheiten", "Tagesziel", "Erfolge", "Synchronisierung"),
    "fr" to listOf("Tâches et événements", "Habitudes", "Objectif quotidien", "Réussites", "Synchronisation"),
    "es" to listOf("Tareas y eventos", "Hábitos", "Objetivo diario", "Logros", "Sincronización"),
    "it" to listOf("Attività ed eventi", "Abitudini", "Obiettivo giornaliero", "Risultati", "Sincronizzazione"),
    "pt" to listOf("Tarefas e eventos", "Hábitos", "Objetivo diário", "Conquistas", "Sincronização"),
    "pl" to listOf("Zadania i wydarzenia", "Nawyki", "Dzienny cel", "Osiągnięcia", "Synchronizacja"),
    "sr" to listOf("Задаци и догађаји", "Навике", "Дневни циљ", "Достигнућа", "Синхронизација"),
    "uk" to listOf("Завдання та події", "Звички", "Щоденна мета", "Досягнення", "Синхронізація"),
    "zh" to listOf("任务和日程", "习惯", "每日目标", "成就", "同步"),
    "tr" to listOf("Görevler ve etkinlikler", "Alışkanlıklar", "Günlük hedef", "Başarılar", "Eşitleme"),
    "ja" to listOf("タスクと予定", "習慣", "今日の目標", "実績", "同期"),
)[language] ?: listOf("Tasks and events", "Habits", "Daily goal", "Achievements", "Sync")

internal fun notificationAuxCopy(language: String): NotificationAuxCopy = mapOf(
    "ru" to NotificationAuxCopy("Достижение", "Новое достижение стало частью вашего пути.",
        "Проверка уведомлений", "Системная доставка работает. GENESIS сможет напоминать при закрытом приложении."),
    "en" to NotificationAuxCopy("Achievement", "A new achievement is now part of your path.",
        "Notification test", "System delivery works. GENESIS can send reminders while the app is closed."),
    "el" to NotificationAuxCopy("Επίτευγμα", "Μια νέα επιτυχία προστέθηκε στην πορεία σας.",
        "Δοκιμή ειδοποιήσεων", "Η παράδοση ειδοποιήσεων λειτουργεί. Το GENESIS μπορεί να στέλνει υπενθυμίσεις όταν η εφαρμογή είναι κλειστή."),
    "de" to NotificationAuxCopy("Erfolg", "Ein neuer Erfolg gehört jetzt zu deinem Weg.",
        "Benachrichtigungstest", "Die Systemzustellung funktioniert. GENESIS kann auch bei geschlossener App erinnern."),
    "fr" to NotificationAuxCopy("Réussite", "Une nouvelle réussite jalonne votre parcours.",
        "Test des notifications", "La distribution fonctionne. GENESIS peut envoyer des rappels même quand l'application est fermée."),
    "es" to NotificationAuxCopy("Logro", "Un nuevo logro forma parte de tu camino.",
        "Prueba de notificaciones", "La entrega funciona. GENESIS puede enviar recordatorios con la aplicación cerrada."),
    "it" to NotificationAuxCopy("Traguardo", "Un nuovo traguardo fa parte del tuo percorso.",
        "Test delle notifiche", "La consegna funziona. GENESIS può inviare promemoria anche con l'app chiusa."),
    "pt" to NotificationAuxCopy("Conquista", "Uma nova conquista faz parte do seu caminho.",
        "Teste de notificações", "A entrega funciona. O GENESIS pode enviar lembretes com a aplicação fechada."),
    "pl" to NotificationAuxCopy("Osiągnięcie", "Nowe osiągnięcie jest częścią Twojej drogi.",
        "Test powiadomień", "Dostarczanie działa. GENESIS może wysyłać przypomnienia, gdy aplikacja jest zamknięta."),
    "sr" to NotificationAuxCopy("Достигнуће", "Ново достигнуће је део вашег пута.",
        "Провера обавештења", "Испорука обавештења ради. GENESIS може да шаље подсетнике и када је апликација затворена."),
    "uk" to NotificationAuxCopy("Досягнення", "Нове досягнення стало частиною вашого шляху.",
        "Перевірка сповіщень", "Доставка сповіщень працює. GENESIS може нагадувати, коли застосунок закрито."),
    "zh" to NotificationAuxCopy("成就", "一项新成就已成为你旅程的一部分。",
        "通知测试", "系统通知投递正常。关闭应用后，GENESIS 仍可发送提醒。"),
    "tr" to NotificationAuxCopy("Başarı", "Yeni bir başarı yolculuğunuzun parçası oldu.",
        "Bildirim testi", "Sistem bildirimi çalışıyor. GENESIS, uygulama kapalıyken de hatırlatıcı gönderebilir."),
    "ja" to NotificationAuxCopy("実績", "新しい実績があなたの歩みに加わりました。",
        "通知テスト", "システム通知は正常です。アプリを閉じていても GENESIS はリマインダーを送信できます。"),
)[language] ?: NotificationAuxCopy("Achievement", "A new achievement is now part of your path.",
    "Notification test", "System delivery works. GENESIS can send reminders while the app is closed.")

internal fun achievementNotificationBody(language: String, count: Int): String {
    if (count == 1) return notificationAuxCopy(language).achievementBody
    val templates = mapOf(
        "ru" to "Открыто достижений: %d.", "en" to "%d new achievements are now part of your path.",
        "el" to "Προστέθηκαν %d νέα επιτεύγματα στην πορεία σας.",
        "de" to "%d neue Erfolge gehören jetzt zu deinem Weg.",
        "fr" to "%d nouvelles réussites jalonnent votre parcours.",
        "es" to "%d nuevos logros forman parte de tu camino.",
        "it" to "%d nuovi traguardi fanno parte del tuo percorso.",
        "pt" to "%d novas conquistas fazem parte do seu caminho.",
        "pl" to "Nowe osiągnięcia na Twojej drodze: %d.",
        "sr" to "Нова достигнућа на вашем путу: %d.",
        "uk" to "Нових досягнень на вашому шляху: %d.",
        "zh" to "新增 %d 项成就，已成为你旅程的一部分。",
        "tr" to "%d yeni başarı yolculuğunuzun parçası oldu.",
        "ja" to "%d 件の新しい実績があなたの歩みに加わりました。",
    )
    return (templates[language] ?: templates.getValue("en")).replace("%d", count.toString())
}

/** Body, complete, snooze, and dismiss actions for private task reminders. */
internal fun taskNotificationCopy(language: String): List<String> = mapOf(
    "ru" to listOf("Время запланированного действия", "Выполнено", "Отложить на 10 мин", "Отключить"),
    "en" to listOf("Time for your scheduled action", "Complete", "Snooze 10 min", "Dismiss"),
    "el" to listOf("Ώρα για την προγραμματισμένη ενέργειά σας", "Ολοκλήρωση", "Αναβολή 10 λεπτά", "Παράβλεψη"),
    "de" to listOf("Zeit für deine geplante Aufgabe", "Erledigt", "10 Min. später", "Verwerfen"),
    "fr" to listOf("C'est l'heure de votre tâche prévue", "Terminé", "Reporter de 10 min", "Ignorer"),
    "es" to listOf("Es hora de la tarea programada", "Completada", "Posponer 10 min", "Descartar"),
    "it" to listOf("È ora dell'attività programmata", "Completata", "Rinvia di 10 min", "Ignora"),
    "pt" to listOf("Está na hora da tarefa agendada", "Concluída", "Adiar 10 min", "Dispensar"),
    "pl" to listOf("Czas na zaplanowane zadanie", "Ukończono", "Odłóż o 10 min", "Odrzuć"),
    "sr" to listOf("Време је за планирани задатак", "Завршено", "Одложи 10 мин", "Одбаци"),
    "uk" to listOf("Час для запланованого завдання", "Виконано", "Відкласти на 10 хв", "Відхилити"),
    "zh" to listOf("该完成计划中的任务了", "完成", "推迟10分钟", "忽略"),
    "tr" to listOf("Planlanan görevin zamanı geldi", "Tamamlandı", "10 dk ertele", "Kapat"),
    "ja" to listOf("予定したタスクの時間です", "完了", "10分後に通知", "閉じる"),
)[language] ?: listOf("Time for your scheduled action", "Complete", "Snooze 10 min", "Dismiss")
