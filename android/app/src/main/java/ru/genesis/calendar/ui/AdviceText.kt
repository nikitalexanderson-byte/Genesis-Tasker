package ru.genesis.calendar.ui

import org.json.JSONObject

/** Display only; saved snapshots and users' editable diary text stay intact. */
internal fun compactAdviceBody(body: String): String = body.lines().filter { it.isNotBlank() }.joinToString("\n").trim()

/** Keep a user's edited note verbatim, even if it originated from an advice card. */
internal fun originalAdvicePreview(body: String, snapshot: JSONObject?): JSONObject? = snapshot?.takeIf { it.optString("body") == body }
