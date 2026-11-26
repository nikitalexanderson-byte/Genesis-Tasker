package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.security.NativeMigrationMemory

/** Owner/repository lifetime is explicit. The old registration never captures
 * the next account's render during disposal. No plaintext is written to disk. */
@Composable
internal fun RememberMigrationInput(owner:String?,kind:String,lifetime:Any?=null,read:()->NativeMigrationMemory.Capture){
    val cell=androidx.compose.runtime.remember(owner,kind,lifetime){arrayOf(read)};cell[0]=read
    DisposableEffect(owner,kind,lifetime){val release=owner?.let{NativeMigrationMemory.register(it,kind){cell[0]()}};onDispose{release?.invoke()}}
}

/** Never infer a UID from the hashed local scope or attach another account's UI. */
@Composable
internal fun rememberLegacyMigrationOwner(scope:String):String?{
    val context=LocalContext.current
    val auth=remember(context){AuthController.get(context)}
    val identity by auth.state.collectAsStateWithLifecycle()
    if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope))return null
    return identity.user?.takeIf{!it.privateVault&&CloudAccountSnapshot.scopeFor(it.uid)==scope}?.uid
}

/** Unsubmitted forms are recovery history, never commands to replay after migration. */
@Composable
internal fun RememberMigrationForm(owner:String?,lifetime:Any?,form:String,settled:()->Boolean,read:()->JSONObject){
    RememberMigrationInput(owner,"local-work",lifetime){
        NativeMigrationMemory.Capture(null,read().put("form",form).put("execution","history-only"),settled())
    }
}
