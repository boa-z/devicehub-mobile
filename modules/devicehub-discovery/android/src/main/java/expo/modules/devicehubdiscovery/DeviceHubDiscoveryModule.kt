package expo.modules.devicehubdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

/**
 * Discovers DeviceHub headless listeners on the local network.
 *
 * The TXT record contains endpoint metadata only. Authentication remains on
 * the subsequent HTTP/WebSocket connection and is never sent through mDNS.
 * All mutable discovery state is confined to the main looper because Android
 * may invoke discovery and resolve callbacks from different binder threads.
 */
class DeviceHubDiscoveryModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var discoveryManager: NsdManager? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private val services = mutableMapOf<String, NsdServiceInfo>()
  private val pendingResolves = ArrayDeque<PendingResolve>()
  private val queuedServiceIds = mutableSetOf<String>()
  private var resolving = false
  private var generation = 0L
  @Volatile
  private var destroyed = false

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
      destroyed = true
      mainHandler.post { stopOnMain(emitState = false) }
    }
  }

  private fun start() {
    mainHandler.post {
      if (destroyed) return@post

      stopOnMain(emitState = false)
      val context = appContext.reactContext
      if (context == null) {
        emitErrorOnMain("Android network service discovery is unavailable because the app context is gone")
        return@post
      }
      val manager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
      if (manager == null) {
        emitErrorOnMain("Android network service discovery is unavailable")
        return@post
      }

      val currentGeneration = ++generation
      val listener = createDiscoveryListener(manager, currentGeneration)
      discoveryManager = manager
      discoveryListener = listener
      runCatching { manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
        .onFailure { error ->
          if (!isCurrentOnMain(currentGeneration)) return@onFailure
          clearDiscoveryOnMain(incrementGeneration = true)
          emitErrorOnMain(
            "Unable to start DeviceHub discovery: ${error.message ?: error::class.java.simpleName}",
          )
        }
    }
  }

  private fun createDiscoveryListener(
    manager: NsdManager,
    currentGeneration: Long,
  ): NsdManager.DiscoveryListener {
    return object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {
        postIfCurrent(currentGeneration) {
          sendEvent("onState", mapOf("state" to "scanning"))
        }
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        postIfCurrent(currentGeneration) {
          if (!isExpectedServiceType(serviceInfo.serviceType)) return@postIfCurrent
          enqueueResolveOnMain(serviceInfo, currentGeneration)
        }
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        postIfCurrent(currentGeneration) {
          val id = serviceId(serviceInfo)
          services.remove(id)
          pendingResolves.removeIf { it.id == id }
          queuedServiceIds.remove(id)
          sendEvent(
            "onService",
            mapOf("event" to "removed", "id" to id, "name" to serviceInfo.serviceName),
          )
          resolveNextOnMain()
        }
      }

      override fun onDiscoveryStopped(serviceType: String) {
        postIfCurrent(currentGeneration) {
          sendEvent("onState", mapOf("state" to "stopped"))
        }
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        postIfCurrent(currentGeneration) {
          runCatching { manager.stopServiceDiscovery(this) }
          clearDiscoveryOnMain(incrementGeneration = true)
          emitErrorOnMain("DeviceHub network discovery failed (error $errorCode)")
          sendEvent("onState", mapOf("state" to "stopped"))
        }
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        postIfCurrent(currentGeneration) {
          emitErrorOnMain("Unable to stop DeviceHub discovery (error $errorCode)")
        }
      }
    }
  }

  private fun enqueueResolveOnMain(serviceInfo: NsdServiceInfo, currentGeneration: Long) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (!isCurrentOnMain(currentGeneration)) return
    val id = serviceId(serviceInfo)
    if (!queuedServiceIds.add(id)) return
    services[id] = serviceInfo
    pendingResolves.addLast(PendingResolve(serviceInfo, id, currentGeneration))
    resolveNextOnMain()
  }

  private fun resolveNextOnMain() {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (resolving || pendingResolves.isEmpty() || destroyed) return
    val manager = discoveryManager ?: return
    val request = pendingResolves.removeFirst()
    if (!isCurrentOnMain(request.generation) || !services.containsKey(request.id)) {
      queuedServiceIds.remove(request.id)
      resolveNextOnMain()
      return
    }

    resolving = true
    runCatching {
      manager.resolveService(request.info, resolveListener(request))
    }.onFailure { error ->
      finishResolveOnMain(request)
      emitErrorOnMain(
        "Unable to resolve DeviceHub service ${request.info.serviceName}: ${error.message ?: error::class.java.simpleName}",
      )
      resolveNextOnMain()
    }
  }

  private fun resolveListener(request: PendingResolve): NsdManager.ResolveListener {
    return object : NsdManager.ResolveListener {
      override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
        postIfCurrent(request.generation) {
          finishResolveOnMain(request)
          if (services.containsKey(request.id) && serviceId(serviceInfo) == request.id) {
            publishResolvedOnMain(serviceInfo)
          }
          resolveNextOnMain()
        }
      }

      override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
        postIfCurrent(request.generation) {
          finishResolveOnMain(request)
          if (services.containsKey(request.id)) {
            emitErrorOnMain(
              "Unable to resolve DeviceHub service ${serviceInfo.serviceName} (error $errorCode)",
            )
          }
          resolveNextOnMain()
        }
      }
    }
  }

  private fun finishResolveOnMain(request: PendingResolve) {
    check(Looper.myLooper() == Looper.getMainLooper())
    resolving = false
    queuedServiceIds.remove(request.id)
  }

  private fun publishResolvedOnMain(serviceInfo: NsdServiceInfo) {
    check(Looper.myLooper() == Looper.getMainLooper())
    val attributes = serviceInfo.attributes.mapNotNull { (key, value) ->
      val text = value.toString(Charsets.UTF_8).trim()
      if (text.isEmpty()) null else key to text
    }.toMap()
    if (attributes["protocol"] != "1" || attributes["transport"] != "http-ws") return
    if (!attributes["targets"].orEmpty().split(',').any { it.trim() == "ios" }) return

    val host = serviceInfo.host?.hostAddress?.trim()?.trimEnd('.') ?: return
    if (host.isEmpty() || serviceInfo.port <= 0) return
    val id = serviceId(serviceInfo)
    sendEvent(
      "onService",
      mapOf(
        "event" to "found",
        "id" to id,
        "name" to serviceInfo.serviceName,
        "host" to host,
        "port" to serviceInfo.port,
        "protocol" to attributes["protocol"].orEmpty(),
        "targets" to attributes["targets"].orEmpty(),
        "transport" to attributes["transport"].orEmpty(),
      ),
    )
  }

  private fun stop() {
    mainHandler.post { stopOnMain(emitState = true) }
  }

  private fun stopOnMain(emitState: Boolean) {
    if (destroyed && emitState) return
    clearDiscoveryOnMain(incrementGeneration = true)
    if (emitState) sendEvent("onState", mapOf("state" to "stopped"))
  }

  private fun clearDiscoveryOnMain(incrementGeneration: Boolean) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (incrementGeneration) generation += 1
    val manager = discoveryManager
    val listener = discoveryListener
    if (manager != null && listener != null) {
      runCatching { manager.stopServiceDiscovery(listener) }
    }
    discoveryManager = null
    discoveryListener = null
    services.clear()
    pendingResolves.clear()
    queuedServiceIds.clear()
    resolving = false
  }

  private fun postIfCurrent(currentGeneration: Long, action: () -> Unit) {
    if (destroyed) return
    mainHandler.post {
      if (isCurrentOnMain(currentGeneration)) action()
    }
  }

  private fun isCurrentOnMain(currentGeneration: Long): Boolean {
    return !destroyed && currentGeneration == generation
  }

  private fun emitErrorOnMain(message: String) {
    if (!destroyed) sendEvent("onError", mapOf("message" to message))
  }

  private fun serviceId(serviceInfo: NsdServiceInfo): String {
    return "${normalizeServiceType(serviceInfo.serviceType)}|${serviceInfo.serviceName}"
  }

  private fun isExpectedServiceType(serviceType: String?): Boolean {
    return normalizeServiceType(serviceType) == normalizeServiceType(SERVICE_TYPE)
  }

  private fun normalizeServiceType(serviceType: String?): String {
    return serviceType.orEmpty().trim().trimEnd('.').lowercase()
  }

  private data class PendingResolve(
    val info: NsdServiceInfo,
    val id: String,
    val generation: Long,
  )

  companion object {
    private const val SERVICE_TYPE = "_devicehub._tcp."
  }
}
