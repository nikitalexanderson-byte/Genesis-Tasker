package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.auth.AuthController

internal data class DonationAction(val preparing: Boolean, val open: () -> Unit)

/** A user click creates the account-bound checkout; a failed request leaves the current UI open. */
@Composable internal fun rememberDonationAction(controller: AuthController, onOpened: () -> Unit = {}): DonationAction {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val openError = genesisTranslate("Не удалось открыть ссылку в браузере.")
    var preparing by remember(controller) { mutableStateOf(false) }
    val currentOnOpened by rememberUpdatedState(onOpened)
    return DonationAction(preparing) {
        if (!preparing) {
            preparing = true
            scope.launch {
                try {
                    val url = controller.donationUrl()
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    currentOnOpened()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { Toast.makeText(context, openError, Toast.LENGTH_SHORT).show() }
                finally { preparing = false }
            }
        }
    }
}
