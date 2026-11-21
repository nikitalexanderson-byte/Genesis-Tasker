package ru.genesis.calendar.security

import java.security.MessageDigest

/** Content-only access to a completed local migration. A fresh device is
 * explicit; a missing/corrupt part in an existing journal is never empty data. */
internal object E2eeMigrationProductHistory{
    class Result(val availability:String,val content:E2eeMigrationContent?){override fun toString()="E2eeMigrationProductHistory.Result([redacted])"}
    fun read(device:E2eeScopeDevice,directory:E2eeDirectory.Verified,inventory:E2eePrivatePaths,domain:String,id:String):Result{
        device.requireOpen();E2eeKeys.technical(id);check(directory.state=="active"){"E2EE_MIGRATION_UNVERIFIED"}
        val paths=inventory.required(directory.kind);val allowed=paths.flatMap{it.domains}.toSet();check(domain in allowed){"E2EE_LOCAL_CONTENT_FORBIDDEN"}
        val stateId="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(directory.scopeId.toByteArray(Charsets.UTF_8)))
        val row=device.vault.read("local-snapshot",stateId)?:return Result("not-on-this-device",null)
        try{
            val state=E2eeFileManifestJson.readMigrationHistory(row.bytes);val protocol=E2eeCommands.integer(state.get("protocol"))
            check(protocol in setOf(3L,4L,5L)&&state.get("phase")=="active"&&state.getBoolean("planned")){"E2EE_MIGRATION_UNVERIFIED"}
            val target=E2eeSourceStage.Target(directory.ownerId,directory.scopeId,directory.kind)
            E2eeMigrationStage.validate(state.getJSONObject("source"),device.vault,target,paths.map{it.id})
            val lease=state.getJSONObject("lease");check(E2eeCommands.integer(lease.get("generation"))==directory.generation){"E2EE_SCOPE_BINDING_MISMATCH"}
            if(protocol in setOf(4L,5L)){
                val pin=if(protocol==5L)state.getJSONObject("adopted")else state
                E2eeMigrationOwnership.validate(state.getJSONObject("ownership"),E2eeMigrationOwnership.Expected(state.getString("migrationId"),target,device.vault.localIdentity(),
                    state.getString("sourceHash"),lease,pin.getString("checkpointHash"),E2eeCommands.integer(pin.get("directoryRevision"),1)))
            }
            val attempt=if(protocol==5L)state.getJSONObject("adopted").getJSONObject("reference").getString("attemptId")else state.getString("migrationId")
            val entry=E2eeMigrationLocal.validate(state.getJSONArray("local"),attempt,allowed).firstOrNull{it.domain==domain&&it.objectId==id}
            val content=entry?.let{E2eeMigrationLocal.open(device.vault,it)};device.requireOpen();return Result("present",content)
        }finally{row.bytes.fill(0)}
    }
}
