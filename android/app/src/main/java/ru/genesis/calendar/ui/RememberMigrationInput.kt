package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import ru.genesis.calendar.security.NativeMigrationMemory

/** Owner/repository lifetime is explicit. The old registration never captures
 * the next account's render during disposal. No plaintext is written to disk. */
@Composable
internal fun RememberMigrationInput(owner:String?,kind:String,lifetime:Any?=null,read:()->NativeMigrationMemory.Capture){
    val cell=androidx.compose.runtime.remember(owner,kind,lifetime){arrayOf(read)};cell[0]=read
    DisposableEffect(owner,kind,lifetime){val release=owner?.let{NativeMigrationMemory.register(it,kind){cell[0]()}};onDispose{release?.invoke()}}
}
