package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Equality for validated, bounded product JSON. Command canonicalization has
 * deliberately smaller limits and is not a large document codec. */
internal object E2eeProductJson{
    fun same(a:Any?,b:Any?):Boolean=when{
        a is JSONObject&&b is JSONObject->{val keys=a.keys().asSequence().toSet();keys==b.keys().asSequence().toSet()&&keys.all{same(a.get(it),b.get(it))}}
        a is JSONArray&&b is JSONArray->a.length()==b.length()&&(0 until a.length()).all{same(a.get(it),b.get(it))}
        a is Number&&b is Number->a.toDouble()==b.toDouble()
        else->a==b
    }
}
