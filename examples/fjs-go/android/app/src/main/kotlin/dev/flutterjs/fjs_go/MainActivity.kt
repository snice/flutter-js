package dev.flutterjs.fjs_go

import android.content.Context
import android.net.wifi.WifiManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/// Holds a WifiMulticastLock while Dart is listening for `fjs dev` beacons.
///
/// Android filters LAN broadcast/multicast by default to save power, so a
/// socket bound to the discovery port hears nothing until this lock is
/// taken — nearby servers vanish and the QR path is the only way in.
class MainActivity : FlutterActivity() {
    private val channelName = "fjs_go/wifi"
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "acquireMulticastLock" -> {
                        acquireLock()
                        result.success(null)
                    }
                    "releaseMulticastLock" -> {
                        releaseLock()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onDestroy() {
        releaseLock()
        super.onDestroy()
    }

    private fun acquireLock() {
        if (multicastLock?.isHeld == true) return
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return
        multicastLock = wifi.createMulticastLock("fjs_go_discovery").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseLock() {
        multicastLock?.let { lock ->
            if (lock.isHeld) lock.release()
        }
        multicastLock = null
    }
}
