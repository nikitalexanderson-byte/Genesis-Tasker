package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import org.json.JSONObject

@Composable internal fun SharedTaskPeopleAndDetails(categories:List<JSONObject>,members:List<JSONObject>,category:String,
    assignee:String?,disabled:Boolean,onCategory:(String)->Unit,onAssignee:(String?)->Unit,details:@Composable ()->Unit) {
    AffairsDisclosure("Дополнительные параметры задачи") {
        ImportChoice("Категория",category.ifBlank{"@none"},listOf("@none" to genesisTranslate("Без категории"))+
            categories.map { it.getString("id") to it.getString("title") },!disabled,"shared-task-category") { onCategory(it.takeUnless { value->value=="@none" }.orEmpty()) }
        details()
        TemplateMember("Исполнитель",assignee,members,!disabled,"shared-task-assignee",onAssignee)
    }
}
