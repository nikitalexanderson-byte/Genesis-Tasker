package ru.genesis.calendar.ui

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import androidx.core.hardware.fingerprint.FingerprintManagerCompat as FingerprintManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
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
    private val fingerprintUi:(visible:Boolean,retry:Boolean)->Unit,
    private val completed:(Boolean)->Unit,
):AutoCloseable {
    private enum class Phase { NEW, BIOMETRIC, CREDENTIAL, FINISHED, CLOSED }
    private val phase=AtomicReference(Phase.NEW)
    private val cancellation=AtomicReference<CancellationSignal?>(null)
    val systemCredentialPending get()=phase.get()==Phase.CREDENTIAL

    fun start(){
        check(Looper.myLooper()==Looper.getMainLooper())
        check(context.getSystemService(KeyguardManager::class.java).isDeviceSecure){"E2EE_CREDENTIAL_UNAVAILABLE"}
        if(!phase.compareAndSet(Phase.NEW,Phase.BIOMETRIC))return
        val signal=CancellationSignal();cancellation.set(signal)
        try{
            if(Build.VERSION.SDK_INT>=30){
                BiometricPrompt.Builder(context).setTitle(title).setDescription(description)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButton(pinLabel,context.mainExecutor){_,_->useCredential()}
                    .build().authenticate(signal,context.mainExecutor,object:BiometricPrompt.AuthenticationCallback(){
                        override fun onAuthenticationSucceeded(result:BiometricPrompt.AuthenticationResult){biometricAccepted()}
                        override fun onAuthenticationError(code:Int,message:CharSequence){
                            if(phase.get()!=Phase.BIOMETRIC)return
                            if(code==BiometricPrompt.BIOMETRIC_ERROR_CANCELED||code==BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED)cancel() else useCredential()
                        }
                    })
            }else{
                // Pre-30 BiometricPrompt cannot constrain every modality to
                // STRONG. Use the platform fingerprint service, then the system
                // credential activity; never admit a weak face result.
                val fingerprint=FingerprintManager.from(context)
                if(!fingerprint.isHardwareDetected||!fingerprint.hasEnrolledFingerprints()){useCredential();return}
                fingerprintUi(true,false)
                fingerprint.authenticate(null,0,signal,object:FingerprintManager.AuthenticationCallback(){
                    override fun onAuthenticationSucceeded(result:FingerprintManager.AuthenticationResult){biometricAccepted()}
                    override fun onAuthenticationFailed(){if(phase.get()==Phase.BIOMETRIC)fingerprintUi(true,true)}
                    override fun onAuthenticationError(code:Int,message:CharSequence){
                        if(phase.get()!=Phase.BIOMETRIC)return
                        if(code==BiometricPrompt.BIOMETRIC_ERROR_CANCELED)cancel() else useCredential()
                    }
                },Handler(Looper.getMainLooper()))
            }
        }catch(_:Exception){if(phase.get()==Phase.BIOMETRIC)useCredential()}
    }
    private fun biometricAccepted(){
        if(phase.compareAndSet(Phase.BIOMETRIC,Phase.FINISHED)){
            cancellation.getAndSet(null)?.cancel();fingerprintUi(false,false);completed(true)
        }
    }
    fun useCredential(){
        while(true){
            val before=phase.get();if(before!=Phase.NEW&&before!=Phase.BIOMETRIC)return
            if(!phase.compareAndSet(before,Phase.CREDENTIAL))continue
            cancellation.getAndSet(null)?.cancel();fingerprintUi(false,false)
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
            cancellation.getAndSet(null)?.cancel();fingerprintUi(false,false);completed(false);return}
    }
    override fun close(){phase.set(Phase.CLOSED);cancellation.getAndSet(null)?.cancel()}
}
