package ru.genesis.calendar.ui

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import ru.genesis.calendar.data.habitFeedbackKinds
import ru.genesis.calendar.data.habitSoundScheme

/** Short bundled cues. Audio failures never turn a successful completion into an error. */
internal class HabitFeedbackPlayer(private val context: Context) : AutoCloseable {
    private var player: MediaPlayer? = null
    fun play(scheme: String, kind: String) {
        close()
        runCatching {
            val audio = context.getSystemService(AudioManager::class.java)
            val notifications = context.getSystemService(NotificationManager::class.java)
            if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL ||
                notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) return
            val event = kind.takeIf { it in habitFeedbackKinds } ?: "completion"
            val next = MediaPlayer()
            player = next
            next.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            context.assets.openFd("originals/feedback-audio/${habitSoundScheme(scheme)}-$event.wav").use {
                next.setDataSource(it.fileDescriptor, it.startOffset, it.length)
            }
            next.setVolume(.8f, .8f)
            next.setOnPreparedListener { if (player === it) it.start() }
            next.setOnCompletionListener { if (player === it) close() }
            next.setOnErrorListener { _, _, _ -> close(); true }
            next.prepareAsync()
        }.onFailure { close() }
    }
    override fun close() {
        val previous = player
        player = null
        runCatching { previous?.release() }
    }
}
