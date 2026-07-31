import { EventEmitter, requireNativeModule } from "expo-modules-core";

export const DEVICEHUB_SERVICE_TYPE = "_devicehub._tcp.";

export type DeviceHubService = {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  targets: string;
  transport: string;
};

export type DeviceHubServiceEvent = {
  event: "found" | "removed";
  id: string;
  name: string;
  host?: string;
  port?: number;
  protocol?: string;
  targets?: string;
  transport?: string;
};

type DeviceHubDiscoveryEvents = {
  onService: (event: DeviceHubServiceEvent) => void;
  onError: (event: { message: string }) => void;
  onState: (event: { state: "scanning" | "stopped" }) => void;
};

type DeviceHubDiscoveryNativeModule = {
  start(): Promise<void>;
  stop(): void;
};

function loadNativeModule() {
  try {
    return requireNativeModule<DeviceHubDiscoveryNativeModule>("DeviceHubDiscovery");
  } catch {
    return null;
  }
}

const nativeModule = loadNativeModule();
const emitter = nativeModule
  ? new EventEmitter<DeviceHubDiscoveryEvents>(nativeModule as never)
  : null;

export const DeviceHubDiscovery = nativeModule;

export function addDeviceHubServiceListener(listener: (event: DeviceHubServiceEvent) => void) {
  return emitter?.addListener("onService", listener) ?? { remove() {} };
}

export function addDeviceHubDiscoveryErrorListener(listener: (event: { message: string }) => void) {
  return emitter?.addListener("onError", listener) ?? { remove() {} };
}

export function startDeviceHubDiscovery() {
  return nativeModule?.start() ?? Promise.resolve();
}

export function stopDeviceHubDiscovery() {
  nativeModule?.stop();
}

export function serviceOrigin(service: Pick<DeviceHubService, "host" | "port">) {
  const host = service.host.includes(":") && !service.host.startsWith("[")
    ? `[${service.host}]`
    : service.host;
  return `http://${host}:${service.port}`;
}
