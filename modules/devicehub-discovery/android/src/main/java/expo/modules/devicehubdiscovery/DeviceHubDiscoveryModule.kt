package expo.modules.devicehubdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

private const val SERVICE_TYPE = "_devicehub._tcp."

/** Discovers authenticated DeviceHub service advertisements on the local LAN. */
class DeviceHubDiscoveryModule : Module() {
  private val lock = Any()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private val queuedIds = mutableSetOf<String>()
  private var nsdManager: NsdManager? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var resolving = false
  private var stopped = true

  override fun definition() = ModuleDefinition {
    Name("DeviceHubDiscovery")
    Events("onService", "onError", "onState")

    AsyncFunction("start") {
      start()
    }

    Function("stop") {
      stop()
    }

    OnDestroy {
      stop()
    }
  }

  private fun start() {
    stop()
    val context = appContext.reactContext ?: run {
      emitError("Android context is unavailable")
      return
    }
    val manager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: run {
      emitError("Android local network discovery is unavailable")
      return
    }
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {
        if (serviceType == SERVICE_TYPE) sendEvent("onState", mapOf("state" to "scanning"))
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (serviceInfo.serviceType.trimEnd('.') != SERVICE_TYPE.trimEnd('.')) return
        val id = serviceId(serviceInfo)
        synchronized(lock) {
          if (!queuedIds.add(id)) return
          pending.addLast(serviceInfo)
        }
        resolveNext()
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        val id = serviceId(serviceInfo)
        synchronized(lock) {
          queuedIds.remove(id)
          pending.removeIf { serviceId(it) == id }
        }
        sendEvent("onService", mapOf("event" to "removed", "id" to id, "name" to serviceInfo.serviceName))
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        emitError("DeviceHub network discovery failed (code $errorCode)")
        runCatching { manager.stopServiceDiscovery(this) }
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        emitError("DeviceHub network discovery could not stop (code $errorCode)")
      }

      override fun onDiscoveryStopped(serviceType: String) {
        if (serviceType == SERVICE_TYPE) sendEvent("onState", mapOf("state" to "stopped"))
      }
    }

    nsdManager = manager
    discoveryListener = listener
    stopped = false
    manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
  }

  private fun stop() {
    val manager = nsdManager
    val listener = discoveryListener
    stopped = true
    synchronized(lock) {
      pending.clear()
      queuedIds.clear()
      resolving = false
    }
    if (manager != null && listener != null) {
      runCatching { manager.stopServiceDiscovery(listener) }
    }
    nsdManager = null
    discoveryListener = null
    sendEvent("onState", mapOf("state" to "stopped"))
  }

  private fun resolveNext() {
    val manager = nsdManager ?: return
    val info: NsdServiceInfo
    synchronized(lock) {
      if (stopped || resolving || pending.isEmpty()) return
      info = pending.removeFirst()
      resolving = true
    }
    val resolveListener = object : NsdManager.ResolveListener {
      override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
        resolveFinished()
        val host = serviceInfo.host?.hostAddress
        val port = serviceInfo.port
        val attributes = serviceInfo.attributes
        val protocol = attributes["protocol"]?.toString(Charsets.UTF_8)
        val targets = attributes["targets"]?.toString(Charsets.UTF_8)
        val transport = attributes["transport"]?.toString(Charsets.UTF_8)
        if (host.isNullOrBlank() || port <= 0 || protocol != "1" || transport != "http-ws" || !targets.orEmpty().split(',').contains("ios")) {
          return
        }
        sendEvent("onService", mapOf(
          "event" to "found",
          "id" to serviceId(serviceInfo),
          "name" to serviceInfo.serviceName,
          "host" to host,
          "port" to port,
          "protocol" to protocol,
          "targets" to targets,
          "transport" to transport,
        ))
      }

      override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
        resolveFinished()
        emitError("Unable to resolve DeviceHub service ${serviceInfo.serviceName} (code $errorCode)")
      }
    }
    runCatching {
      manager.resolveService(info, resolveListener)
    }.onFailure { error ->
      resolveFinished()
      emitError("Unable to resolve DeviceHub service ${info.serviceName}: ${error.message ?: "request rejected"}")
    }
  }

  private fun resolveFinished() {
    synchronized(lock) {
      resolving = false
    }
    resolveNext()
  }

  private fun serviceId(serviceInfo: NsdServiceInfo): String {
    return "${serviceInfo.serviceType}|${serviceInfo.serviceName}"
  }

  private fun emitError(message: String) {
    sendEvent("onError", mapOf("message" to message))
  }
}
