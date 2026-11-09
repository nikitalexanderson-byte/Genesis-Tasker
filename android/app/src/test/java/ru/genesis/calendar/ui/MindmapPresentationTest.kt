package ru.genesis.calendar.ui

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapNode

class MindmapPresentationTest {
    @Test fun deepBranchLabelsAreResolvedOncePerNode() {
        val nodes=(0..100).map {MindmapNode("n$it",if(it==0)null else "n${it-1}",text="Ветка $it")}
        val map=MindmapDocument("deep","Tree",nodes=nodes)
        var calls=0
        val choices=mindmapBranchChoices(map,"n100"){calls++;it.text}
        assertEquals(nodes.size,calls)
        assertEquals(100,choices.size)
        assertTrue(choices.last().second.endsWith("Ветка 98 › Ветка 99"))
        assertFalse(choices.any {it.first=="n100"})
    }
    @Test fun branchDestinationsKeepTreeOrderExcludeCyclesAndDisambiguateNames() {
        val map=MindmapDocument("map","Plan",nodes=listOf(
            MindmapNode("root",null,text="План"),MindmapNode("work","root",text="Работа"),
            MindmapNode("moving","work",text="Идея"),MindmapNode("descendant","moving",text="Деталь"),
            MindmapNode("work2","root",text="Работа"),MindmapNode("other","work2",text="Идея")))
        val choices=mindmapBranchChoices(map,"moving") {it.text}
        assertEquals(listOf("root","work","work2","other"),choices.map {it.first})
        assertEquals(listOf("План","План › Работа · 1","План › Работа · 2","План › Работа · 2 › Идея"),choices.map {it.second})
        val moved=map.move("moving",choices.last().first)
        assertEquals("other",moved.nodes.first {it.id=="moving"}.parentId)
        assertEquals("moving",moved.nodes.first {it.id=="descendant"}.parentId)
        assertTrue(mindmapBranchChoices(map,"root"){it.text}.isEmpty())
    }
    @Test fun iconRoundTripPreservesTheWebPresentationAndUnknownFields() {
        val map = MindmapDocument.new("Map")
        val original = map.nodes.single().copy(extensions = """{"presentation":{"width":320,"align":"center","image":{"data":"existing"}},"tags":["keep"]}""")
        val chosen = original.withMindmapIcon("lightbulb")
        val decoded = MindmapDocument.parse(map.copy(nodes = listOf(chosen)).json()).nodes.single()
        assertEquals("lightbulb", decoded.mindmapIcon())
        val cleared = decoded.withMindmapIcon(null)
        assertNull(cleared.mindmapIcon())
        assertEquals(320, JSONObject(cleared.extensions).getJSONObject("presentation").getInt("width"))
        assertEquals("existing", JSONObject(cleared.extensions).getJSONObject("presentation").getJSONObject("image").getString("data"))
        assertEquals("keep", JSONObject(cleared.extensions).getJSONArray("tags").getString(0))
    }
}
