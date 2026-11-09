package ru.genesis.calendar.auth

import android.util.JsonReader
import android.util.JsonToken
import android.util.MalformedJsonException
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** Reads a possibly heavily escaped envelope without a second whole-response byte/string copy. */
internal object DataExportStream {
    fun read(input: InputStream, format: String): JSONObject {
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        try {
            JsonReader(DataExportReader(InputStreamReader(DataExportInput(input), decoder))).use { reader ->
                reader.isLenient = false
                val result = JSONObject(); val keys = mutableSetOf<String>()
                reader.beginObject()
                while (reader.hasNext()) {
                    val key = reader.nextName()
                    valid(keys.add(key) && keys.size <= 32)
                    when (key) {
                        "format", "content", "csrf" -> result.put(key, string(reader))
                        "projectCount", "taskCount" -> {
                            valid(reader.peek() == JsonToken.NUMBER)
                            val value = reader.nextString()
                            valid(value.matches(Regex("0|[1-9][0-9]{0,9}")))
                            result.put(key, value.toLong())
                        }
                        "notices" -> result.put(key, notices(reader))
                        else -> reader.skipValue()
                    }
                }
                reader.endObject(); valid(reader.peek() == JsonToken.END_DOCUMENT)
                val checked = DataExportProtocol.snapshot(format, result)
                if (result.has("csrf")) checked.put("csrf", result.getString("csrf"))
                return checked
            }
        } catch (_: MalformedJsonException) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
        catch (_: CharacterCodingException) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
        catch (_: IllegalStateException) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
        catch (_: NumberFormatException) { throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
    }
    private fun valid(value: Boolean) { if (!value) throw AuthFailure(AuthFailure.Kind.PROTOCOL) }
    private fun string(reader: JsonReader): String { valid(reader.peek() == JsonToken.STRING); return reader.nextString() }
    private fun notices(reader: JsonReader): JSONArray {
        val result = JSONArray(); reader.beginArray()
        while (reader.hasNext()) {
            valid(result.length() < 4096)
            val item = JSONObject(); val keys = mutableSetOf<String>(); reader.beginObject()
            while (reader.hasNext()) {
                val key = reader.nextName(); valid(keys.add(key) && keys.size <= 16)
                if (key in setOf("code", "field")) item.put(key, string(reader)) else reader.skipValue()
            }
            reader.endObject(); result.put(item)
        }
        reader.endArray(); return result
    }
}
