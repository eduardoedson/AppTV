package com.apptvclient

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.apptvclient.audio.AudioNormalizationPlugin
import com.apptvclient.updater.ApkUpdaterPackage
import com.brentvatne.react.ReactNativeVideoManager

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // In-app updates: downloads the new APK and opens the installer
          add(ApkUpdaterPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // One registration covers every react-native-video player in the app,
    // including library playback and the continuous live-TV schedule.
    ReactNativeVideoManager.getInstance().registerPlugin(AudioNormalizationPlugin())
    loadReactNative(this)
  }
}
