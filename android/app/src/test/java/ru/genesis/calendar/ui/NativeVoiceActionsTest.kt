package ru.genesis.calendar.ui

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.GenesisCategory
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.GoogleTaskList
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitEngine
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.CalendarMode

class NativeVoiceActionsTest {
    private val project=GenesisProject("project-1",null,"work","Работа","",emptyList(),"active",0)
    private val category=GenesisCategory("category-1","Здоровье","#2D6C68",0)
    private val task=LocalTask(id="task-1",title="Отправить отчёт")
    private val list=GoogleTaskList("list-1","Покупки")
    private val habit=Habit(TrackerEntity.create("habit"),"Читать утром",LocalDate.of(2026,10,4),
        HabitEngine(GenesisCalendar()).defaultSchedule(LocalDate.of(2026,10,4),CalendarMode.SACRED))

    @Test fun opensExactTaskAndNeverCreatesOneByMistake() {
        assertEquals(NativeVoiceAction.EditTask("task-1","Отправить отчёт"),
            parseNativeVoiceAction("хочу отредактировать задачу Отправить отчёт",listOf(task),listOf(project),listOf(habit)))
        assertTrue(looksLikeUnsupportedVoiceAction("удали проект Работа"))
    }

    @Test fun movesTaskAndRoutesHabitDeleteToConfirmation() {
        assertEquals(NativeVoiceAction.MoveTask("task-1","Отправить отчёт","project-1"),
            parseNativeVoiceAction("перенеси задачу Отправить отчёт в проект Работа",listOf(task),listOf(project),listOf(habit)))
        assertEquals(NativeVoiceAction.DeleteHabit(habit.id,habit.title),
            parseNativeVoiceAction("удали привычку Читать утром",listOf(task),listOf(project),listOf(habit)))
    }

    @Test fun backgroundCommandsNavigateAndMarkItemsComplete() {
        assertEquals(NativeVoiceAction.Navigate("Сакральные привычки"),
            parseNativeVoiceAction("открой сакральные привычки",listOf(task),listOf(project),listOf(habit)))
        assertEquals(NativeVoiceAction.Navigate("Путь героя"),
            parseNativeVoiceAction("покажи путь героя",listOf(task),listOf(project),listOf(habit)))
        assertEquals(NativeVoiceAction.SetTaskDone(task.id,task.title,true),
            parseNativeVoiceAction("выполни задачу Отправить отчёт",listOf(task),listOf(project),listOf(habit)))
        assertEquals(NativeVoiceAction.SetHabitDone(habit.id,habit.title,false),
            parseNativeVoiceAction("сними отметку привычки Читать утром",listOf(task),listOf(project),listOf(habit)))
        assertTrue(isVoiceTaskCreationCommand("создай задачу Проверить почту"))
        assertFalse(isVoiceTaskCreationCommand("создай проект Проверить почту"))
    }

    @Test fun calendarCommandsRecognizeAlternativePhrasings() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.CalendarModeChange(CalendarMode.LUNAR),parse("переключи календарь на лунный"))
        assertEquals(NativeVoiceAction.CalendarModeChange(CalendarMode.LUNAR),parse("Генезис, пожалуйста, переключи календарь на лунный!"))
        assertEquals(NativeVoiceAction.CalendarModeChange(CalendarMode.PROFANE),parse("покажи григорианский календарь"))
        assertEquals(NativeVoiceAction.CalendarView(true),parse("открой год"))
        assertEquals(NativeVoiceAction.CalendarView(false),parse("покажи месяц"))
        assertEquals(NativeVoiceAction.CalendarStep(false,1),parse("следующий месяц"))
        assertEquals(NativeVoiceAction.CalendarStep(true,-1),parse("год назад"))
        assertEquals(NativeVoiceAction.CalendarSwipe(1),parse("свайпни влево"))
        assertEquals(NativeVoiceAction.Scroll("up"),parse("прокрути экран вверх"))
        assertEquals(NativeVoiceAction.CalendarDate(2026,10,12),parse("покажи 12 октября 2026"))
        assertEquals(NativeVoiceAction.CalendarDate(2026,5,3),parse("покажи 3 мая 2026"))
        assertEquals(NativeVoiceAction.CalendarMonth(5),parse("открой месяц 5"))
    }

    @Test fun taskAndListActionsResolveNamesBeforeOpeningEditorsOrConfirmation() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit),listOf(list))
        assertEquals(NativeVoiceAction.DeleteTask(task.id,task.title),
            parse("Генезис, удали задачу Отправить отчёт"))
        assertEquals(NativeVoiceAction.EditTaskList(list.id,list.title),
            parse("переименуй список Покупки"))
        assertEquals(NativeVoiceAction.DeleteTaskList(list.id,list.title),
            parse("удали список задач Покупки"))
        assertThrows(IllegalArgumentException::class.java) {
            parseNativeVoiceAction("удали список задач Основной",listOf(task),listOf(project),listOf(habit),
                listOf(GoogleTaskList("default","Основной",isDefault=true)))
        }
    }

    @Test fun projectAndCategoryActionsResolveNamesBeforeOpeningEditorsOrConfirmation() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit),
            listOf(list),listOf(category))
        assertEquals(NativeVoiceAction.DeleteProject(project.id,project.title),parse("удали проект Работа"))
        assertEquals(NativeVoiceAction.CreateCategory("Творчество"),parse("создай категорию жизни Творчество"))
        assertEquals(NativeVoiceAction.EditCategory(category.id,category.name),parse("измени категорию Здоровье"))
        assertEquals(NativeVoiceAction.DeleteCategory(category.id,category.name),parse("удали категорию жизни Здоровье"))
    }

    @Test fun namingWordsDoNotBecomePartOfCreatedNames() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.CreateProject("Проект номер 1"),
            parse("создай проект под названием Проект номер 1"))
        assertEquals(NativeVoiceAction.CreateHabit("Morning walk"),
            parse("create habit called Morning walk"))
        assertEquals(NativeVoiceAction.CreateTaskList("Покупки"),
            parse("создай список задач с названием Покупки"))
    }

    @Test fun moodCommandsRecognizeBothLanguagesWithoutGuessing() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.SetMood(4),parse("отметь настроение дня как радость"))
        assertEquals(NativeVoiceAction.SetMood(-3),parse("сегодня у меня настроение минус три"))
        assertEquals(NativeVoiceAction.SetMood(4),parse("запиши настроение плюс четыре"))
        assertEquals(NativeVoiceAction.SetMood(1),parse("I feel calm today"))
        assertEquals(NativeVoiceAction.SetMood(-4),parse("log my mood as drained"))
        assertNull(parse("отметь настроение серебристое"))
        assertTrue(looksLikeUnsupportedVoiceAction("отметь настроение серебристое"))
    }

    @Test fun sleepCommandsKeepPlanAndObservationSeparate() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.SetSleep("23:30","07:00"),parse("запиши сон с 23:30 до 07:00"))
        assertEquals(NativeVoiceAction.SetSleep("23:00","07:00"),parse("I fell asleep at 11 pm and woke up at 7 am"))
        assertEquals(NativeVoiceAction.SetSleep(quality=8),parse("качество сна 8 из 10"))
        assertEquals(NativeVoiceAction.SetSleepPlan("22:45","06:30"),parse("set sleep schedule from 10:45 pm to 6:30 am"))
        assertEquals(NativeVoiceAction.SetSleepPlan(reminderEnabled=true,reminderMinutesBefore=30),
            parse("включи напоминание о сне за 30 минут"))
        assertEquals(NativeVoiceAction.SetSleepPlan(reminderEnabled=false),parse("disable sleep reminder"))
        assertNull(parse("запиши сон с 25:00 до 07:00"))
    }

    @Test fun stoicheionDrawIsDistinctFromOpeningNamedCard() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.StoicheionDraw("spread"),parse("выбери 9 карт"))
        assertEquals(NativeVoiceAction.StoicheionDraw("spread"),parse("draw nine-card spread"))
        assertEquals(NativeVoiceAction.StoicheionDraw("daily"),parse("вытяни карту дня"))
        assertEquals(NativeVoiceAction.StoicheionCard("alpha"),parse("открой карту альфа"))
    }

    @Test fun taskRenamingRequiresOneExactSourceTitle() {
        fun parse(value: String, records: List<LocalTask> = listOf(task)) =
            parseNativeVoiceAction(value,records,listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.RenameTask(task.id,task.title,"Новый отчёт"),
            parse("переименуй задачу Отправить отчёт в Новый отчёт"))
        assertEquals(NativeVoiceAction.RenameTask(task.id,task.title,"Final report"),
            parse("rename task Отправить отчёт to named Final report"))
        assertThrows(IllegalArgumentException::class.java) { parse("переименуй задачу Отправить в Новый отчёт") }
        assertThrows(IllegalArgumentException::class.java) {
            parse("переименуй задачу Отправить отчёт в Новый отчёт",listOf(task,task.copy(id="task-2")))
        }
    }

    @Test fun theokyklosSectorsResolveBilingualNamesWithoutGuessing() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.TheokyklosSector("northeast"),parse("открой северо-восточный сектор"))
        assertEquals(NativeVoiceAction.TheokyklosSector("hearth"),parse("покажи сектор Очаг в Теокиклосе"))
        assertEquals(NativeVoiceAction.TheokyklosSector("northwest"),parse("open theokyklos north west sector"))
        assertEquals(NativeVoiceAction.TheokyklosSector("entrance"),parse("show entrance sector"))
        assertNull(parse("открой неизвестный сектор"))
    }

    @Test fun stoicheionCardCommandsOpenNamedCatalogCards() {
        fun parse(value: String)=parseNativeVoiceAction(value,listOf(task),listOf(project),listOf(habit))
        assertEquals(NativeVoiceAction.StoicheionCard("alpha"),parse("открой карту Стойхейона Альфа"))
        assertEquals(NativeVoiceAction.StoicheionCard("omega"),parse("выбери букву Омега"))
        assertEquals(NativeVoiceAction.StoicheionCard("theta"),parse("open stoicheion card theta"))
        assertNull(parse("открой карту Неизвестная"))
    }
}
