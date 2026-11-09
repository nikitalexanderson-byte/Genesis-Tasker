package ru.genesis.calendar.auth

import org.json.JSONObject

/** Keep the user's touched settings on an explicit refresh; untouched fields follow the new revision. */
internal fun rebaseNotificationSettings(base:JSONObject,own:JSONObject,latest:JSONObject):JSONObject {
    fun merge(before:Any?,draft:Any?,remote:Any?):Any? {
        if(before==draft || before?.toString()==draft?.toString())return remote
        if(before !is JSONObject || draft !is JSONObject || remote !is JSONObject)return draft
        return JSONObject(remote.toString()).apply { draft.keys().forEach { key -> put(key,merge(before.opt(key),draft.opt(key),remote.opt(key))?:JSONObject.NULL) } }
    }
    return JSONObject((merge(base,own,latest) as JSONObject).toString())
}
