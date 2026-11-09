package ru.genesis.calendar.data

import java.security.MessageDigest
import java.time.LocalDate
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

data class MindmapNode(val id: String, val parentId: String?, val kind: String = "idea", val text: String = "", val note: String = "", val refId: String? = null, val occurrenceDate: String? = null,val style:JSONObject?=null,val extensions:String="{}") {
    fun json() = JSONObject(extensions).put("id",id).put("parentId",parentId ?: JSONObject.NULL).put("kind",kind).put("note",note)
        .apply { if(kind=="idea") put("text",text) else put("refId",refId); occurrenceDate?.let { put("occurrenceDate",it) };style?.let {put("style",it)} }
}
data class MindmapLink(val id: String, val from: String, val to: String, val label: String,val color:String?=null) {
    fun json()=JSONObject().put("id",id).put("from",from).put("to",to).put("label",label).apply {color?.let {put("color",it)}}
}
data class MindmapDocument(val id:String, val title:String, val projectId:String?=null, val pinned:Boolean=false, val archived:Boolean=false,
    val nodes:List<MindmapNode>, val links:List<MindmapLink> = emptyList(),val appearance:JSONObject?=null,val description:String="",val extensions:String="{}") {
    fun json()=JSONObject(extensions).put("schemaVersion",1).put("id",id).put("title",title).put("projectId",projectId ?: JSONObject.NULL)
        .put("description",description).put("pinned",pinned).put("archived",archived).put("nodes",JSONArray(nodes.map { it.json() })).put("links",JSONArray(links.map { it.json() })).apply {appearance?.let {put("appearance",it)}}
    fun descendants(id:String):Set<String> { val result=mutableSetOf<String>(); val queue=java.util.ArrayDeque<String>();queue.add(id)
        while(queue.isNotEmpty()) { val next=queue.removeFirst();if(result.add(next))nodes.filter { it.parentId==next }.forEach { queue.add(it.id) } };return result }
    fun remove(id:String):MindmapDocument { require(nodes.first { it.id==id }.parentId!=null) { "Корень нельзя убрать. Архивируйте карту." }
        val removed=descendants(id);return copy(nodes=nodes.filterNot { it.id in removed },links=links.filterNot { it.from in removed || it.to in removed }) }
    fun move(id:String,parent:String,before:String?=null):MindmapDocument { require(nodes.first { it.id==id }.parentId!=null && parent !in descendants(id) && nodes.any { it.id==parent }) { "Нельзя переместить ветку в себя." }
        val moving=nodes.first { it.id==id }.copy(parentId=parent);val next=nodes.filterNot { it.id==id }.toMutableList();next.add(next.indexOfFirst { it.id==before }.takeIf { it>=0 } ?: next.size,moving);return parse(copy(nodes=next).json()) }
    fun rows(collapsed:Set<String> = emptySet(),focus:String?=null):List<Pair<MindmapNode,Int>> {
        val result=mutableListOf<Pair<MindmapNode,Int>>(); val root=nodes.firstOrNull { it.id==focus } ?: nodes.first { it.parentId==null }
        fun visit(n:MindmapNode,depth:Int) { result.add(n to depth);if(n.id !in collapsed)nodes.filter { it.parentId==n.id }.forEach { visit(it,depth+1) } };visit(root,0);return result }
    fun taskId(nodeId:String)="maptask-"+MessageDigest.getInstance("SHA-256").digest("$id:$nodeId".toByteArray()).joinToString("") { "%02x".format(it) }
    companion object {
        fun new(title:String,projectId:String?=null,template:String="empty",label:(String)->String={it}):MindmapDocument { val root=MindmapNode(UUID.randomUUID().toString(),null,text=title.trim())
            val labels=when(template) { "idea"->listOf("Замысел","Что уже известно","Вопросы","Следующий шаг");"project"->listOf("Результат","Этапы","Ресурсы","Риски");"decision"->listOf("Критерии","Варианты","За и против","Решение");else->emptyList() }
            return parse(MindmapDocument(UUID.randomUUID().toString(),title.trim(),projectId,nodes=listOf(root)+labels.map { MindmapNode(UUID.randomUUID().toString(),root.id,text=label(it)) }).json()) }
        fun parse(v:JSONObject):MindmapDocument {
            require(v.getInt("schemaVersion")==1) { "Версия карты не поддерживается. Исходные данные сохранены." }
            val idPattern=Regex("[A-Za-z0-9_-]{1,100}");fun id(value:String)=value.also { require(idPattern.matches(it)) }
            fun colorObject(row:JSONObject,key:String):JSONObject? { if(!row.has(key))return null;require(row.opt(key) is JSONObject);return row.getJSONObject(key) }
            fun colors(value:JSONObject?,allowed:Set<String>):JSONObject?=value?.also { row->row.keys().forEach {key->require(key in allowed&&Regex("#[a-fA-F0-9]{6}").matches(row.getString(key))) } }
            fun nullable(row:JSONObject,key:String)=if(row.isNull(key))null else id(row.getString(key))
            fun extras(row:JSONObject,known:Set<String>):String = JSONObject(row.toString()).apply {known.forEach {remove(it)}}.toString()
            val description=v.optString("description","");require(description.length<=12000)
            val title=v.getString("title");require(title.isNotBlank() && title.length<=2000)
            val raw=v.getJSONArray("nodes");require(raw.length() in 1..1000)
            val nodes=(0 until raw.length()).map { index -> val n=raw.getJSONObject(index);val kind=n.getString("kind");require(kind in setOf("idea","task","project"))
                val text=if(kind=="idea")n.getString("text") else "";val note=n.getString("note");require(text.length<=2000 && note.length<=12000)
                val date=if(n.has("occurrenceDate"))n.getString("occurrenceDate").also { require(kind=="task" && LocalDate.parse(it).toString()==it) } else null
                MindmapNode(id(n.getString("id")),nullable(n,"parentId"),kind,text,note,if(kind=="idea")null else id(n.getString("refId")),date,colors(colorObject(n,"style"),setOf("fill","border")),extras(n,setOf("id","parentId","kind","text","note","refId","occurrenceDate","style"))) }
            val byId=nodes.associateBy { it.id };require(byId.size==nodes.size && nodes.count { it.parentId==null }==1)
            nodes.forEach { n -> val seen=mutableSetOf(n.id);var parent=n.parentId;while(parent!=null) { require(parent in byId && seen.add(parent) && seen.size<=32);parent=byId.getValue(parent).parentId } }
            val links=v.getJSONArray("links");require(links.length()<=2000)
            val parsedLinks=(0 until links.length()).map { val l=links.getJSONObject(it);val color=l.optString("color").takeIf {it.isNotBlank()};require(color==null||Regex("#[a-fA-F0-9]{6}").matches(color));MindmapLink(id(l.getString("id")),id(l.getString("from")),id(l.getString("to")),l.getString("label"),color).also { link -> require(link.from in byId && link.to in byId && link.from!=link.to && link.label.length<=240) } }
            require(parsedLinks.map { it.id }.toSet().size==parsedLinks.size)
            val result=MindmapDocument(id(v.getString("id")),title,nullable(v,"projectId"),v.getBoolean("pinned"),v.getBoolean("archived"),nodes,parsedLinks,colors(colorObject(v,"appearance"),setOf("lineColor")),description,extras(v,setOf("schemaVersion","id","title","description","projectId","pinned","archived","nodes","links","appearance")))
            require(result.json().toString().toByteArray().size<=2_000_000);return result
        }
    }
}
