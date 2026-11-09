package ru.genesis.calendar.ui

private fun slavic(count: Int, one: String, few: String, many: String): String {
    val lastTwo = count % 100
    if (lastTwo in 11..14) return many
    return when (count % 10) { 1 -> one; 2, 3, 4 -> few; else -> many }
}

internal fun taskCountCopy(count: Int, language: String): String {
    val noun = when (language) {
        "ru" -> slavic(count, "задача", "задачи", "задач")
        "uk" -> slavic(count, "завдання", "завдання", "завдань")
        "pl" -> if (count == 1) "zadanie" else if (count % 100 in 12..14 || count % 10 !in 2..4)
            "zadań" else "zadania"
        "sr" -> slavic(count, "задатак", "задатка", "задатака")
        "en" -> if (count == 1) "task" else "tasks"
        "el" -> if (count == 1) "εργασία" else "εργασίες"
        "de" -> if (count == 1) "Aufgabe" else "Aufgaben"
        "fr" -> if (count == 1) "tâche" else "tâches"
        "es" -> if (count == 1) "tarea" else "tareas"
        "it" -> "attività"
        "pt" -> if (count == 1) "tarefa" else "tarefas"
        "zh" -> "项任务"
        "tr" -> "görev"
        "ja" -> "件のタスク"
        else -> if (count == 1) "task" else "tasks"
    }
    return "$count $noun"
}

internal fun taskListCountCopy(count: Int, language: String): String {
    val noun = when (language) {
        "ru" -> slavic(count, "список", "списка", "списков")
        "uk" -> slavic(count, "список", "списки", "списків")
        "pl" -> if (count == 1) "lista" else if (count % 100 in 12..14 || count % 10 !in 2..4)
            "list" else "listy"
        "sr" -> slavic(count, "списак", "списка", "спискова")
        "en" -> if (count == 1) "list" else "lists"
        "el" -> if (count == 1) "λίστα" else "λίστες"
        "de" -> if (count == 1) "Liste" else "Listen"
        "fr" -> if (count == 1) "liste" else "listes"
        "es" -> if (count == 1) "lista" else "listas"
        "it" -> if (count == 1) "elenco" else "elenchi"
        "pt" -> if (count == 1) "lista" else "listas"
        "zh" -> "个列表"
        "tr" -> "liste"
        "ja" -> "件のリスト"
        else -> if (count == 1) "list" else "lists"
    }
    return "$count $noun"
}

internal fun taskSummaryCopy(total: Int, active: Int, lists: Int, language: String): String {
    val activeLabel = when (language) {
        "ru" -> "активных"; "en" -> "active"; "el" -> "ενεργές"; "de" -> "offen"
        "fr" -> "en cours"; "es" -> "activas"; "it" -> "attive"; "pt" -> "ativas"
        "pl" -> "aktywne"; "sr" -> "активних"; "uk" -> "активних"; "zh" -> "进行中"
        "tr" -> "etkin"; "ja" -> "進行中"; else -> "active"
    }
    return "${taskCountCopy(total, language)} · $active $activeLabel · ${taskListCountCopy(lists, language)}"
}
