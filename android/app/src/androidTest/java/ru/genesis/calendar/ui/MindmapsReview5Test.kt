package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import java.io.File
import java.util.Base64
import kotlin.math.abs

/** Real Compose gestures and encrypted Room; synthetic isolated account, no live session or HTTP. */
class MindmapsReview5Test {
    @get:Rule val compose=createAndroidComposeRule<PagerTestActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private val width get()=args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get()=args.getString("genesisDark")=="true"
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private class Gateway:MindmapTransport {
        private val rows=mutableMapOf<String,JSONObject>()
        override fun check() {}
        override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account")
            .put("key",Base64.getEncoder().encodeToString(ByteArray(32) {it.toByte()})))
        override suspend fun request(path:String,body:JSONObject?):JSONObject {
            if(body==null)return JSONObject().put("maps",JSONArray(rows.values.toList()))
            val id=path.substringAfterLast('/');val revision=body.getLong("expectedRevision")+1
            rows[id]=JSONObject(body.toString()).put("id",id).put("revision",revision)
            return JSONObject().put("revision",revision)
        }
    }
    private fun await(tag:String) {compose.waitUntil(15000) {compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()};compose.waitForIdle()}
    private fun capture(name:String) {compose.waitForIdle();captureNativeWindow(File(context.getExternalFilesDir(null),"review5-mindmaps-$width-${if(dark)"dark" else "light"}-$name.png"))}
    @Test fun hostedHeaderSearchPaletteAndRealTwoFingerZoomKeepEditingAndPositions() {
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        val repository=MindmapRepository(db,"review5-map-fixture","review5-user",Gateway())
        val map=MindmapDocument.new("Очень длинное название карты для проверки бегущей строки и сохранения доступного названия",template="idea")
        val archived=MindmapDocument.new("Скрытая архивная карта").copy(archived=true)
        runBlocking {repository.save(map);repository.save(archived)}
        var back=0
        compose.setContent {
            val density=Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f)
            CompositionLocalProvider(LocalDensity provides density,LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark,
                LocalFeatureAccess provides validationDataExchangeAccess()) {
                MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) {
                        MobileWorkspaceShell("Проекты",null,emptyList(),"Синтетическая проверка",true,onNavigate={},actions={CalendarModeSwitcher(CalendarMode.PROFANE,{},size=48.dp)}) {
                            MindmapsScreen(repository,emptyList(),emptyList(),null,{back++},{_,_->},{},{_,_->},{})
                        }
                    }
                }
            }
        }
        try {
            await("mindmaps-create")
            compose.onNodeWithTag("workspace-title").assertTextEquals("Майндмепы")
            compose.onNodeWithTag("workspace-subtitle").assertTextEquals("Личные дела")
            compose.onNodeWithTag("affairs-page-header").assertDoesNotExist()
            listOf("mindmaps-back","mindmaps-actions").forEach {compose.onNodeWithTag(it).assert(hasAnyAncestor(hasTestTag("app-header")))}
            capture("catalog")
            compose.onNodeWithTag("mindmaps-search-open").performClick()
            compose.onNodeWithTag("mindmaps-search").performTextReplacement("Не существует")
            compose.onNodeWithTag("mindmap-open-${map.id}").assertDoesNotExist()
            capture("search-query")
            val field=compose.onNodeWithTag("mindmaps-search").fetchSemanticsNode().boundsInRoot
            val close=compose.onNodeWithTag("mindmaps-search-close").fetchSemanticsNode().boundsInRoot
            assertEquals("Search and close centers: $field / $close",field.center.y,close.center.y,1f)
            assertTrue(field.right <= close.left)
            compose.onNodeWithTag("mindmaps-search").performTextReplacement("")
            compose.onNodeWithTag("mindmaps-search-close").performClick()
            compose.onNodeWithTag("mindmaps-actions").performClick();compose.onNodeWithTag("mindmaps-archive").performClick()
            compose.onNodeWithTag("mindmap-open-${archived.id}").assertExists()
            compose.onNodeWithTag("mindmaps-back").performClick()
            assertEquals(0,back)
            compose.onNodeWithTag("mindmap-open-${map.id}").performClick();await("mindmap-canvas")
            compose.onNodeWithTag("workspace-title").assertTextEquals(map.title)
            val mode=compose.onNodeWithTag("mindmap-mode-toggle").fetchSemanticsNode().boundsInRoot
            val reset=compose.onNodeWithTag("mindmap-reset").fetchSemanticsNode().boundsInRoot
            val add=compose.onNodeWithTag("mindmap-add-node").fetchSemanticsNode().boundsInRoot
            val toolbarTags=listOf("mindmap-mode-toggle","mindmap-add-node","mindmap-undo",
                "mindmap-title-description","mindmap-history","mindmap-export-menu")
            val toolbarButtons=toolbarTags.map { compose.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot }
            toolbarButtons.forEach { assertEquals(mode.width,it.width,1f);assertEquals(mode.center.y,it.center.y,1f) }
            toolbarButtons.zipWithNext().forEach { (before,after)->assertTrue(before.left<after.left) }
            val toolbarViewport = compose.onNodeWithTag("mindmap-toolbar-viewport").fetchSemanticsNode().boundsInRoot
            if (toolbarButtons.last().right <= toolbarViewport.right + 1f) assertEquals("Toolbar group is exactly centered",
                toolbarViewport.center.x, (toolbarButtons.first().left + toolbarButtons.last().right) / 2f, 1f)
            val searchButton=compose.onNodeWithTag("mindmap-node-search-open").fetchSemanticsNode().boundsInRoot
            assertEquals(reset.center.y,searchButton.center.y,1f)
            assertEquals(reset.width,searchButton.width,1f)
            val canvasBounds=compose.onNodeWithTag("mindmap-canvas").fetchSemanticsNode().boundsInRoot
            assertTrue("Canvas controls must stay inside its horizontal bounds",reset.left>canvasBounds.left && searchButton.right<canvasBounds.right)
            assertTrue(reset.top>mode.bottom && reset.left<add.left)
            compose.onNodeWithContentDescription("Увеличить масштаб").assertDoesNotExist()
            capture("canvas")
            compose.onNodeWithTag("mindmap-canvas").performTouchInput {pinch(start0=Offset(width*.40f,height*.65f),start1=Offset(width*.60f,height*.65f),end0=Offset(width*.25f,height*.65f),end1=Offset(width*.75f,height*.65f),durationMillis=400)}
            compose.waitUntil(10000) {runBlocking {repository.view(map.id)?.optDouble("zoom",1.0) ?: 1.0}>1.3}
            val enlarged=runBlocking {repository.view(map.id)!!.getDouble("zoom")}
            capture("pinch")
            compose.onNodeWithTag("mindmap-canvas").performTouchInput {pinch(start0=Offset(width*.25f,height*.65f),start1=Offset(width*.75f,height*.65f),end0=Offset(width*.40f,height*.65f),end1=Offset(width*.60f,height*.65f),durationMillis=400)}
            compose.waitUntil(10000) {runBlocking {repository.view(map.id)?.optDouble("zoom",1.0) ?: 1.0}<enlarged-.2}
            compose.onNodeWithTag("mindmap-reset").performClick();compose.waitForIdle()
            assertEquals(1.0,runBlocking {repository.view(map.id)!!.getDouble("zoom")},.01)
            val root=map.nodes.first()
            // A long press still drags a thought instead of opening the editor.
            compose.onNodeWithTag("mindmap-node-${root.id}").performTouchInput {
                down(Offset(width*.35f,height*.65f));advanceEventTime(650)
                moveBy(Offset(30f,30f),delayMillis=32);moveBy(Offset(20f,20f),delayMillis=32);up()
            }
            compose.waitUntil(10000) {runBlocking {repository.view(map.id)?.optJSONObject("positions")?.has(root.id)==true}}
            compose.onNodeWithTag("mindmap-node-${root.id}").performClick();await("mindmap-node-text")
            compose.onNodeWithTag("mindmap-node-text").performTextReplacement("Цветная мысль")
            compose.onNodeWithText("Оформление").performScrollTo().performClick()
            compose.onNodeWithTag("mindmap-color-Заливка карточки").performScrollTo().performClick();await("mindmap-color-picker")
            compose.onNodeWithTag("mindmap-swatch-#bb704b").performScrollTo().performClick();capture("palette")
            compose.onNodeWithTag("mindmap-color-apply").performClick()
            compose.waitUntil(10000) {repository.records.value.first {it.document.id==map.id}.document.nodes.first().style?.optString("fill")=="#bb704b"}
            compose.onNodeWithText("Сохранить мысль").performClick();await("mindmap-canvas")
            compose.waitUntil(10000) {repository.records.value.first {it.document.id==map.id}.document.nodes.first().text=="Цветная мысль"}
            fun assertPaintedColor() {
                val pixels=compose.onNodeWithTag("mindmap-node-${root.id}").captureToImage().toPixelMap()
                // Sample the interior, away from antialiasing at the rounded corner.
                val pixel=pixels[pixels.width/2,pixels.height-10]
                assertEquals(0xbb/255f,pixel.red,.015f);assertEquals(0x70/255f,pixel.green,.015f);assertEquals(0x4b/255f,pixel.blue,.015f)
            }
            assertPaintedColor();capture("colored-canvas")
            compose.onNodeWithTag("mindmap-mode-toggle").assertContentDescriptionEquals("Показать структуру").performClick();assertPaintedColor();capture("colored-structure")
            compose.onNodeWithTag("mindmap-export-menu").performScrollTo().performClick()
            compose.onNodeWithText("Экспорт JSON").assertIsDisplayed();compose.onNodeWithText("Экспорт PDF").assertIsDisplayed();capture("export-menu")
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            compose.onNodeWithTag("mindmaps-back").performClick()
            compose.onNodeWithTag("workspace-title").assertTextEquals("Майндмепы")
            val reopened=MindmapRepository(db,"review5-map-fixture","review5-user",Gateway())
            runBlocking {reopened.loadCached()}
            assertEquals("#bb704b",reopened.records.value.first {it.document.id==map.id}.document.nodes.first().style!!.getString("fill"))
            assertFalse(runBlocking {db.dao().document("review5-map-fixture","mindmaps")!!.encrypted}.contains("Цветная мысль"))
        } finally {db.close()}
    }
}
