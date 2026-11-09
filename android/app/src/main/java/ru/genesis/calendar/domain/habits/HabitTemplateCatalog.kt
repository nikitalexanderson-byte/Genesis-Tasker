// Generated from real web TS by android/tools/export-habit-vectors.mjs.
package ru.genesis.calendar.domain.habits

data class HabitTemplate(val id: String, val icon: String, val title: String, val description: String, val schedulePreset: String, val suggestedTime: String, val color: String)
object HabitTemplateCatalog {
    val templates = listOf(
        HabitTemplate("daily-plan","🗓️","План на день","5 минут утром, чтобы определить главные задачи дня.","daily","08:00","#bb8f4a"),
        HabitTemplate("morning-water","💧","Стакан воды после пробуждения","Начать день с простого действия.","daily","07:30","#2d7771"),
        HabitTemplate("morning-mobility","🤸","Утренняя разминка","5–10 минут движения после пробуждения.","daily","07:45","#668b55"),
        HabitTemplate("walk","🚶","Прогулка","Минимум 20 минут движения на свежем воздухе.","daily","18:00","#668b55"),
        HabitTemplate("reading","📚","Чтение","20 минут чтения без отвлечений.","daily","20:00","#5271a8"),
        HabitTemplate("focus-session","🎯","Фокус-сессия","Не менее 30 минут сосредоточенной работы над одной важной задачей.","weekdays","10:00","#8b5f83"),
        HabitTemplate("meditation","🧘","Медитация / дыхательная практика","5 минут спокойного наблюдения или дыхательной практики.","daily","08:15","#8b5f83"),
        HabitTemplate("ten-minute-reset","🧹","10 минут порядка","Небольшая уборка или организация пространства.","daily","19:00","#bb8f4a"),
        HabitTemplate("evening-review","✍️","Вечерний обзор дня","Кратко вспомнить сделанное и определить главное на завтра.","daily","21:00","#b06779"),
        HabitTemplate("screen-free-bedtime","🌙","Без экрана перед сном","Отложить телефон и другие экраны минимум за 30 минут до сна.","daily","22:30","#9b5d4a")
    )
}
