import Foundation
import ExpoModulesCore

private let deviceHubServiceType = "_devicehub._tcp."
private let missingLocalNetworkConfigurationCode = -72008

/// Bridges the headless server's authenticated Bonjour advertisement to JS.
/// The advertisement contains only endpoint metadata; the bearer token never
/// crosses the discovery protocol.
public final class DeviceHubDiscoveryModule: Module {
  private var browser: NetServiceBrowser?
  private var browserDelegate: BrowserDelegate?
  private var services: [String: NetService] = [:]

  public func definition() -> ModuleDefinition {
    Name("DeviceHubDiscovery")
    Events("onService", "onError", "onState")

    AsyncFunction("start") {
      self.start()
    }

    Function("stop") {
      self.stop()
    }

    OnDestroy {
      self.stop()
    }
  }

  private func start() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.stopOnMain()

      let delegate = BrowserDelegate(owner: self)
      let browser = NetServiceBrowser()
      browser.delegate = delegate
      browser.schedule(in: .main, forMode: .common)
      browser.searchForServices(ofType: deviceHubServiceType, inDomain: "local.")
      self.browserDelegate = delegate
      self.browser = browser
      self.sendEvent("onState", ["state": "scanning"])
    }
  }

  private func stop() {
    DispatchQueue.main.async { [weak self] in
      self?.stopOnMain()
    }
  }

  private func stopOnMain() {
    browser?.stop()
    browser?.remove(from: .main, forMode: .common)
    browser?.delegate = nil
    for service in services.values {
      service.stop()
      service.delegate = nil
    }
    services.removeAll()
    browser = nil
    browserDelegate = nil
    sendEvent("onState", ["state": "stopped"])
  }

  fileprivate func found(_ service: NetService) {
    let id = serviceID(service)
    services[id] = service
    service.delegate = browserDelegate
    service.schedule(in: .main, forMode: .common)
    service.resolve(withTimeout: 5)
  }

  fileprivate func removed(_ service: NetService) {
    let id = serviceID(service)
    services[id]?.stop()
    services.removeValue(forKey: id)
    sendEvent("onService", [
      "event": "removed",
      "id": id,
      "name": service.name,
    ])
  }

  fileprivate func resolved(_ service: NetService) {
    guard services[serviceID(service)] != nil,
          let host = service.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
          !host.isEmpty,
          service.port > 0 else {
      return
    }

    let txt = service.txtRecordData().map(NetService.dictionary(fromTXTRecord:)) ?? [:]
    let values = txt.reduce(into: [String: String]()) { result, item in
      guard let value = String(data: item.value, encoding: .utf8) else { return }
      result[item.key] = value
    }
    guard values["protocol"] == "1",
          values["transport"] == "http-ws",
          values["targets"]?.split(separator: ",").contains("ios") == true else {
      return
    }

    sendEvent("onService", [
      "event": "found",
      "id": serviceID(service),
      "name": service.name,
      "host": host,
      "port": service.port,
      "protocol": values["protocol"] ?? "",
      "targets": values["targets"] ?? "",
      "transport": values["transport"] ?? "",
    ])
  }

  fileprivate func failed(_ service: NetService, error: [String: NSNumber]) {
    sendEvent("onError", [
      "message": describe(error, fallback: "Unable to resolve DeviceHub service \(service.name)"),
    ])
  }

  fileprivate func browserFailed(_ error: [String: NSNumber]) {
    sendEvent("onError", [
      "message": describe(error, fallback: "DeviceHub network discovery failed"),
    ])
  }

  private func describe(_ error: [String: NSNumber], fallback: String) -> String {
    if error[NetService.errorCode]?.intValue == missingLocalNetworkConfigurationCode {
      return "DeviceHub local-network discovery is not configured in this iOS build. Rebuild after Expo prebuild and allow Local Network access in Settings."
    }
    let details = error.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: ", ")
    return details.isEmpty ? fallback : "\(fallback) (\(details))"
  }

  private func serviceID(_ service: NetService) -> String {
    "\(service.domain)|\(service.type)|\(service.name)"
  }
}

private final class BrowserDelegate: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  weak var owner: DeviceHubDiscoveryModule?

  init(owner: DeviceHubDiscoveryModule) {
    self.owner = owner
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    owner?.found(service)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    owner?.removed(service)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    owner?.browserFailed(errorDict)
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    owner?.resolved(sender)
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    owner?.failed(sender, error: errorDict)
  }
}
