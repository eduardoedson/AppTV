package com.apptvclient.audio

import android.media.audiofx.AudioEffect
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.brentvatne.exoplayer.RNVExoplayerPlugin
import java.util.concurrent.ConcurrentHashMap

/**
 * Applies the same real-time dynamics processing to every video player created
 * by react-native-video. The media files are never modified.
 */
class AudioNormalizationPlugin : RNVExoplayerPlugin {
  private data class PlayerEffects(
    val player: ExoPlayer,
    val listener: Player.Listener,
    var sessionId: Int = C.AUDIO_SESSION_ID_UNSET,
    var effect: AudioEffect? = null,
  )

  private val effects = ConcurrentHashMap<String, PlayerEffects>()

  override fun onInstanceCreated(id: String, player: ExoPlayer) {
    val listener = object : Player.Listener {
      override fun onAudioSessionIdChanged(audioSessionId: Int) {
        attachToSession(id, audioSessionId)
      }
    }

    effects[id] = PlayerEffects(player, listener)
    player.addListener(listener)

    if (player.audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
      attachToSession(id, player.audioSessionId)
    }
  }

  override fun onInstanceRemoved(id: String, player: ExoPlayer) {
    effects.remove(id)?.let { state ->
      state.player.removeListener(state.listener)
      releaseEffect(state)
    }
  }

  private fun attachToSession(id: String, sessionId: Int) {
    if (sessionId == C.AUDIO_SESSION_ID_UNSET) return
    val state = effects[id] ?: return
    if (state.sessionId == sessionId && state.effect != null) return

    releaseEffect(state)
    state.sessionId = sessionId

    state.effect = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        createDynamicsProcessor(sessionId)
      } else {
        createLegacyEnhancer(sessionId)
      }
    } catch (error: RuntimeException) {
      Log.w(TAG, "Audio normalization is unavailable for session $sessionId", error)
      null
    }
  }

  private fun releaseEffect(state: PlayerEffects) {
    try {
      state.effect?.enabled = false
      state.effect?.release()
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not release audio normalization", error)
    } finally {
      state.effect = null
      state.sessionId = C.AUDIO_SESSION_ID_UNSET
    }
  }

  private fun createLegacyEnhancer(sessionId: Int): AudioEffect =
    LoudnessEnhancer(sessionId).apply {
      // LoudnessEnhancer includes peak protection on Android. This fallback is
      // used on API 24-27, where DynamicsProcessing does not exist yet.
      setTargetGain(LEGACY_GAIN_MILLIBELS)
      enabled = true
    }

  private fun createDynamicsProcessor(sessionId: Int): AudioEffect {
    val compressor = DynamicsProcessing.Mbc(true, true, 1).apply {
      setBand(
        0,
        DynamicsProcessing.MbcBand(
          true,
          20_000f,
          10f,
          250f,
          4f,
          -22f,
          6f,
          -80f,
          1f,
          0f,
          8f,
        ),
      )
    }
    val limiter = DynamicsProcessing.Limiter(
      true,
      true,
      0,
      1f,
      100f,
      10f,
      -1f,
      0f,
    )
    val config = DynamicsProcessing.Config.Builder(
      DynamicsProcessing.VARIANT_FAVOR_TIME_RESOLUTION,
      CHANNEL_COUNT,
      false,
      0,
      true,
      1,
      false,
      0,
      true,
    )
      .setMbcAllChannelsTo(compressor)
      .setLimiterAllChannelsTo(limiter)
      .build()

    return DynamicsProcessing(0, sessionId, config).apply { enabled = true }
  }

  private companion object {
    const val TAG = "AppTVAudio"
    const val CHANNEL_COUNT = 2
    const val LEGACY_GAIN_MILLIBELS = 600
  }
}
