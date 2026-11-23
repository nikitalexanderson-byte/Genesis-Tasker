package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class E2eeNativeUiPreferencesTest {
    private fun value()=JSONObject().put("format","genesis-native-ui-preferences-v1").put("ownerId","ui-owner")
        .put("values",JSONObject().put("weatherTemperatureUnit","fahrenheit")).put("pending",JSONObject().put("time","12h"))
    private fun reject(change:(JSONObject)->Unit){
        val input=value();change(input)
        try{E2eeNativeUiPreferences.validate(input,"ui-owner");fail("Invalid UI document accepted")}
        catch(expected:IllegalStateException){}catch(expected:org.json.JSONException){}
    }
    @Test fun validDocumentIsAnIndependentCopy(){
        val input=value();val checked=E2eeNativeUiPreferences.validate(input,"ui-owner")
        checked.getJSONObject("values").put("weatherTemperatureUnit","celsius")
        assertEquals("fahrenheit",input.getJSONObject("values").getString("weatherTemperatureUnit"))
    }
    @Test fun ownerAndFormatCannotBeSubstituted(){reject{it.put("ownerId","other-owner")};reject{it.put("format","other")}}
    @Test fun exactDocumentRejectsInjectedAuthority(){reject{it.put("entitlement",true)};reject{it.getJSONObject("pending").put("membership","grant")}}
    @Test fun oldPendingNamesAndNonStringsAreRejected(){reject{it.getJSONObject("values").put("pending:time","12h")};reject{it.getJSONObject("values").put("time",12)}}
    @Test fun keyAndValueLimitsAreBounded(){reject{it.getJSONObject("values").put("a".repeat(129),"x")};reject{it.getJSONObject("values").put("time","x".repeat(65537))}}
    @Test fun totalUtf8AndEntryLimitsAreBounded(){
        reject{val values=it.getJSONObject("values");repeat(1025){n->values.put("v$n","")}}
        reject{val values=it.getJSONObject("values");repeat(3){n->values.put("v$n","я".repeat(65536))}}
    }
}
