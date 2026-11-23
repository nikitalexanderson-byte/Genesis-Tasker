package ru.genesis.calendar.ui

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import androidx.biometric.AuthenticationRequest
import androidx.biometric.AuthenticationResult
import androidx.biometric.AuthenticationResultLauncher
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import java.util.concurrent.atomic.AtomicReference

/** UI confirmation only. The caller must still claim its one-use, owner-bound
 * request and open the actual authentication-required Android Keystore key.
 * No PIN, biometric template or successful-unlock flag is persisted here. */
@Suppress("DEPRECATION")
internal class NativeDeviceAuthentication(
    private val context:Context,
    private val title:String,
    private val description:String,
    private val pinLabel:String,
    private val launchCredential:(Intent)->Unit,
    private val biometric:AuthenticationResultLauncher,
    private val completed:(Boolean)->Unit,
):AutoCloseable {
    private enum class Phase { NEW, BIOMETRIC, CREDENTIAL, FINISHED, CLOSED }
    private val phase=AtomicReference(Phase.NEW)
    val systemCredentialPending get()=phase.get()==Phase.CREDENTIAL

    fun start(){
        check(Looper.myLooper()==Looper.getMainLooper())
        check(context.getSystemService(KeyguardManager::class.java).isDeviceSecure){"E2EE_CREDENTIAL_UNAVAILABLE"}
        if(!phase.compareAndSet(Phase.NEW,Phase.BIOMETRIC))return
        try{
            if(BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)!=BiometricManager.BIOMETRIC_SUCCESS){useCredential();return}
            // No library-managed credential fallback: only our explicit PIN
            // transition may keep this owner-bound request across an Activity trip.
            biometric.launch(AuthenticationRequest.biometricRequest(title,AuthenticationRequest.Biometric.Fallback.CustomOption(pinLabel)){
                setMinStrength(AuthenticationRequest.Biometric.Strength.Class3())
                setContent(AuthenticationRequest.BodyContent.PlainText(description))
            })
        }catch(_:Exception){if(phase.get()==Phase.BIOMETRIC)useCredential()}
    }

    fun biometricReturned(result:AuthenticationResult){
        if(phase.get()!=Phase.BIOMETRIC)return
        when(result){
            is AuthenticationResult.Success->biometricAccepted()
            is AuthenticationResult.CustomFallbackSelected->useCredential()
            is AuthenticationResult.Error->{
                if(result.errorCode==BiometricPrompt.ERROR_CANCELED||result.errorCode==BiometricPrompt.ERROR_USER_CANCELED)cancel() else useCredential()
            }
        }
    }
    private fun biometricAccepted(){
        if(phase.compareAndSet(Phase.BIOMETRIC,Phase.FINISHED)){
            completed(true)
        }
    }
    fun useCredential(){
        while(true){
            val before=phase.get();if(before!=Phase.NEW&&before!=Phase.BIOMETRIC)return
            if(!phase.compareAndSet(before,Phase.CREDENTIAL))continue
            biometric.cancel()
            try{
                val manager=context.getSystemService(KeyguardManager::class.java)
                check(manager.isDeviceSecure){"E2EE_CREDENTIAL_UNAVAILABLE"}
                launchCredential(manager.createConfirmDeviceCredentialIntent(title,description)?:error("E2EE_CREDENTIAL_UNAVAILABLE"))
            }catch(_:Exception){credentialReturned(false)}
            return
        }
    }
    fun credentialReturned(accepted:Boolean){if(phase.compareAndSet(Phase.CREDENTIAL,Phase.FINISHED))completed(accepted)}
    fun cancel(){
        while(true){val before=phase.get();if(before==Phase.FINISHED||before==Phase.CLOSED)return
            if(!phase.compareAndSet(before,Phase.FINISHED))continue
            biometric.cancel();completed(false);return}
    }
    override fun close(){phase.set(Phase.CLOSED);biometric.cancel()}
}
