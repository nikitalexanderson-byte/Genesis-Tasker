package ru.genesis.calendar.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import java.io.OutputStream
import org.json.JSONObject
import ru.genesis.calendar.data.MindmapDocument

/** Bounded vector overview; the appendix keeps every title and note readable. */
internal fun writeMindmapPdf(output:OutputStream,map:MindmapDocument,titles:Map<String,String>,view:JSONObject,outlineTitle:String) {
    val pdf=PdfDocument();var number=0
    val ink=TextPaint(Paint.ANTI_ALIAS_FLAG).apply {color=Color.rgb(19,36,38);textSize=12f}
    fun page()=pdf.startPage(PdfDocument.PageInfo.Builder(1191,842,++number).create())
    fun text(canvas:Canvas,value:String,x:Float,y:Float,width:Int,size:Float=12f):Int {
        ink.textSize=size
        val layout=StaticLayout.Builder.obtain(value,0,value.length,ink,width).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).build()
        canvas.save();canvas.translate(x,y);layout.draw(canvas);canvas.restore();return layout.height
    }
    fun color(value:String?,fallback:Int)=runCatching {if(value!=null&&Regex("#[a-fA-F0-9]{6}").matches(value))Color.parseColor(value) else fallback}.getOrDefault(fallback)
    try {
        val first=page();text(first.canvas,map.title,36f,24f,1119,22f)
        val points=map.rows().mapIndexed {index,pair->val saved=view.optJSONObject("positions")?.optJSONObject(pair.first.id);pair.first.id to (saved?.optDouble("x",24.0+pair.second*260)?.toFloat() ?: (24+pair.second*260).toFloat()) to (saved?.optDouble("y",24.0+index*112)?.toFloat() ?: (24+index*112).toFloat())}.associate {it.first.first to (it.first.second to it.second)}
        val scale=minOf(1119f/((points.values.maxOfOrNull {it.first} ?: 0f)+260),730f/((points.values.maxOfOrNull {it.second} ?: 0f)+100))
        val canvas=first.canvas;canvas.save();canvas.translate(36f,76f);canvas.scale(scale,scale)
        val stroke=Paint(Paint.ANTI_ALIAS_FLAG).apply {style=Paint.Style.STROKE;strokeWidth=2f;color=color(map.appearance?.optString("lineColor"),Color.rgb(140,103,43))}
        map.nodes.forEach {node->val p=node.parentId?.let(points::get);val q=points[node.id];if(p!=null&&q!=null){val path=Path();path.moveTo(p.first+220,p.second+42);path.cubicTo(p.first+260,p.second+42,q.first-40,q.second+42,q.first,q.second+42);canvas.drawPath(path,stroke)} }
        map.links.forEach {link->val a=points.getValue(link.from);val b=points.getValue(link.to);stroke.color=color(link.color,color(map.appearance?.optString("lineColor"),Color.rgb(140,103,43)));stroke.pathEffect=android.graphics.DashPathEffect(floatArrayOf(5f,5f),0f);canvas.drawLine(a.first+110,a.second+84,b.first+110,b.second,stroke)}
        stroke.pathEffect=null
        map.nodes.forEach {node->val p=points.getValue(node.id);val fill=color(node.style?.optString("fill"),Color.rgb(255,253,248));val rect=android.graphics.RectF(p.first,p.second,p.first+220,p.second+84);canvas.drawRoundRect(rect,12f,12f,Paint().apply {this.color=fill});stroke.color=color(node.style?.optString("border"),Color.rgb(37,91,89));canvas.drawRoundRect(rect,12f,12f,stroke);ink.color=if(androidx.core.graphics.ColorUtils.calculateLuminance(fill)>.179)Color.BLACK else Color.WHITE;canvas.save();canvas.clipRect(rect);text(canvas,titles[node.id].orEmpty().take(120),p.first+12,p.second+12,196,14f);canvas.restore()}
        canvas.restore();pdf.finishPage(first);ink.color=Color.rgb(19,36,38)
        var current=page();var y=24f;y+=text(current.canvas,outlineTitle,36f,y,1119,20f)+16
        fun paragraph(value:String,indent:Int,size:Float=12f) {
            ink.textSize=size;val x=36f+indent.coerceAtMost(4)*12;val width=(1155-x).toInt()
            val layout=StaticLayout.Builder.obtain(value,0,value.length,ink,width).setIncludePad(false).build()
            for(i in 0 until layout.lineCount) {
                val height=layout.getLineBottom(i)-layout.getLineTop(i)
                if(y+height>806){pdf.finishPage(current);current=page();y=36f}
                current.canvas.save();current.canvas.clipRect(x,y,x+width,y+height);current.canvas.translate(x,y-layout.getLineTop(i));layout.draw(current.canvas);current.canvas.restore();y+=height
            }
            y+=8
        }
        map.rows().forEach { (node,depth)->paragraph(titles[node.id].orEmpty(),depth,14f);if(node.note.isNotBlank())paragraph(node.note,depth);node.refId?.let {paragraph(it+(node.occurrenceDate?.let {date->" · $date"} ?: ""),depth,10f)};y+=8 }
        map.links.forEach {link->paragraph("${titles[link.from]} — ${link.label} — ${titles[link.to]}",0)}
        pdf.finishPage(current);pdf.writeTo(output)
    } finally {pdf.close()}
}
