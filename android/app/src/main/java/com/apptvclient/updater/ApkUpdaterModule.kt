package com.apptvclient.updater

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Downloads a new AppTV APK and opens the Android package installer.
 * Used by the in-app update screen (src/services/apkUpdater.ts).
 */
class ApkUpdaterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getAppVersion(promise: Promise) {
    try {
      val info = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
      val versionCode =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
          else @Suppress("DEPRECATION") info.versionCode.toLong()
      val result = Arguments.createMap()
      result.putString("versionName", info.versionName ?: "")
      result.putDouble("versionCode", versionCode.toDouble())
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("VERSION_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun canInstallPackages(promise: Promise) {
    val allowed =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          reactContext.packageManager.canRequestPackageInstalls()
        } else {
          true
        }
    promise.resolve(allowed)
  }

  @ReactMethod
  fun openInstallPermissionSettings(promise: Promise) {
    val packageUri = Uri.parse("package:${reactContext.packageName}")
    // Some TV builds do not have the per-app screen, so fall back to broader settings screens
    val candidates =
        listOf(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, packageUri),
            Intent(Settings.ACTION_SECURITY_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
    for (intent in candidates) {
      try {
        reactContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(true)
        return
      } catch (_: ActivityNotFoundException) {
        // Try the next settings screen
      }
    }
    promise.reject("SETTINGS_ERROR", "Não foi possível abrir as configurações do Android.")
  }

  @ReactMethod
  fun downloadAndInstall(url: String, headers: ReadableMap?, promise: Promise) {
    thread(name = "ApkUpdaterDownload") {
      try {
        val directory = File(reactContext.cacheDir, UPDATES_DIRECTORY).apply { mkdirs() }
        val apkFile = File(directory, APK_FILE_NAME)
        if (apkFile.exists()) apkFile.delete()

        val connection = openConnection(url, headers)
        val total = connection.contentLengthLong
        try {
          connection.inputStream.use { input ->
            FileOutputStream(apkFile).use { output ->
              val buffer = ByteArray(BUFFER_SIZE)
              var received = 0L
              var lastEmit = 0L
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                received += read
                val now = System.currentTimeMillis()
                if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
                  emitProgress(received, total)
                  lastEmit = now
                }
              }
              emitProgress(received, total)
            }
          }
        } finally {
          connection.disconnect()
        }

        if (apkFile.length() == 0L) throw IOException("O arquivo baixado está vazio.")
        installApk(apkFile)
        promise.resolve(apkFile.absolutePath)
      } catch (error: Exception) {
        promise.reject("DOWNLOAD_ERROR", error.message ?: "Falha ao baixar a atualização.", error)
      }
    }
  }

  // Required by NativeEventEmitter on the JavaScript side
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  /** Follows redirects manually so request headers are only sent to the original host. */
  private fun openConnection(url: String, headers: ReadableMap?): HttpURLConnection {
    val originalHost = URL(url).host
    var current = URL(url)
    var redirects = 0
    while (true) {
      val connection = current.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      if (headers != null && current.host == originalHost) {
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
          val key = iterator.nextKey()
          headers.getString(key)?.let { value -> connection.setRequestProperty(key, value) }
        }
      }
      val status = connection.responseCode
      if (status in 300..399) {
        val location = connection.getHeaderField("Location")
        connection.disconnect()
        if (location.isNullOrEmpty()) throw IOException("Redirecionamento sem destino (HTTP $status).")
        redirects += 1
        if (redirects > MAX_REDIRECTS) throw IOException("Redirecionamentos demais.")
        current = URL(current, location)
        continue
      }
      if (status !in 200..299) {
        connection.disconnect()
        throw IOException("O servidor respondeu com HTTP $status.")
      }
      return connection
    }
  }

  private fun installApk(apkFile: File) {
    val uri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.updates", apkFile)
    val intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
  }

  private fun emitProgress(received: Long, total: Long) {
    val payload = Arguments.createMap()
    payload.putDouble("received", received.toDouble())
    payload.putDouble("total", total.toDouble())
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(PROGRESS_EVENT, payload)
  }

  companion object {
    const val NAME = "ApkUpdater"
    private const val PROGRESS_EVENT = "ApkUpdaterProgress"
    private const val UPDATES_DIRECTORY = "updates"
    private const val APK_FILE_NAME = "AppTV-update.apk"
    private const val BUFFER_SIZE = 64 * 1024
    private const val PROGRESS_INTERVAL_MS = 250L
    private const val CONNECT_TIMEOUT_MS = 20_000
    private const val READ_TIMEOUT_MS = 60_000
    private const val MAX_REDIRECTS = 5
  }
}
