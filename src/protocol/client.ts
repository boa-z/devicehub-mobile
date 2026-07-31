import { parseMediaPacket } from "./packets";
import type {
  DeviceHubCommand,
  DeviceStatus,
  MediaPacket,
  ServerMessage,
  ServerHello,
  DeviceApp,
  DeviceDetails,
  ForgetDeviceResult,
  LocationStatus,
  PairDeviceResult,
} from "./types";

export type DeviceHubConnection = {
  origin: string;
  token: string;
};

export type MobilePlatform = "ios" | "android";

export type SocketCallbacks = {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: unknown) => void;
  onMessage?: (message: ServerMessage) => void;
  onMedia?: (packet: MediaPacket) => void;
  onControlLease?: (granted: boolean) => void;
  onServerHello?: (hello: ServerHello) => void;
};

const REQUEST_TIMEOUT_MS = 8_000;
const DEVICE_COMMAND_TIMEOUT_MS = 12_000;
const DEVICE_DETAILS_TIMEOUT_MS = 15_000;
const PAIRING_REQUEST_TIMEOUT_MS = 100_000;
const FORGET_REQUEST_TIMEOUT_MS = 50_000;
const SOCKET_HANDSHAKE_TIMEOUT_MS = 8_000;
const MOBILE_PROTOCOL_VERSION = 1;

export class DeviceHubHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DeviceHubHttpError";
    this.status = status;
  }
}

export class DeviceHubRequestTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`DeviceHub request timed out after ${timeoutMs / 1_000} seconds: ${path}`);
    this.name = "DeviceHubRequestTimeoutError";
  }
}

export class DeviceHubSocketHandshakeTimeoutError extends Error {
  constructor(deviceId: string) {
    super(
      `DeviceHub WebSocket handshake timed out after ${SOCKET_HANDSHAKE_TIMEOUT_MS / 1_000} seconds: ${deviceId}`,
    );
    this.name = "DeviceHubSocketHandshakeTimeoutError";
  }
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Server address is required");
  const origin = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server address must use http or https");
  }
  return parsed.origin;
}

/** Accept either a bare host or the URL printed by the headless server. */
export function parseConnectionInput(originInput: string, tokenInput: string): DeviceHubConnection {
  const trimmedOrigin = originInput.trim();
  const candidate = /^https?:\/\//i.test(trimmedOrigin)
    ? trimmedOrigin
    : `http://${trimmedOrigin}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server address must use http or https");
  }
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const fragmentParams = new URLSearchParams(hash);
  const queryToken = new URLSearchParams(parsed.search).get("access_token");
  const token = tokenInput.trim() || fragmentParams.get("access_token")?.trim() || queryToken?.trim() || "";
  if (!token) throw new Error("Access token is required (paste the full headless URL or enter the token)");
  return { origin: parsed.origin, token };
}

function websocketOrigin(origin: string) {
  return origin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

async function readError(response: Response) {
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 240);
  return detail || `${response.status} ${response.statusText}`;
}

export class DeviceHubClient {
  readonly connection: DeviceHubConnection;
  readonly platform: MobilePlatform;

  constructor(origin: string, token: string, platform: MobilePlatform = "ios") {
    const normalizedToken = token.trim();
    if (!normalizedToken) throw new Error("Access token is required");
    this.connection = { origin: normalizeOrigin(origin), token: normalizedToken };
    this.platform = platform;
  }

  async status(signal?: AbortSignal) {
    return this.request<DeviceStatus>("/api/status", { signal });
  }

  async refreshDevices() {
    await this.request<void>("/api/devices/refresh", { method: "PUT" });
  }

  async connectDevice(deviceId: string) {
    await this.request<void>(`/api/devices/${encodeURIComponent(deviceId)}/connect`, { method: "PUT" });
  }

  async disconnectDevice(deviceId: string) {
    await this.request<void>(`/api/devices/${encodeURIComponent(deviceId)}/connect`, { method: "DELETE" });
  }

  async reconnectDevice(deviceId: string) {
    await this.request<void>(`/api/devices/${encodeURIComponent(deviceId)}/reconnect`, { method: "PUT" });
  }

  async pairDevice(deviceId: string) {
    const result = await this.request<PairDeviceResult>(
      `/api/devices/${encodeURIComponent(deviceId)}/pair`,
      { method: "PUT" },
      PAIRING_REQUEST_TIMEOUT_MS,
    );
    if (result.outcome !== "paired") {
      throw new Error(result.error || `Device trust request ${result.outcome}`);
    }
    return result;
  }

  async forgetDevice(deviceId: string) {
    return this.request<ForgetDeviceResult>(
      `/api/devices/${encodeURIComponent(deviceId)}/pair`,
      { method: "DELETE" },
      FORGET_REQUEST_TIMEOUT_MS,
    );
  }

  async listApps(deviceId: string, options: { includeSystem?: boolean; includeAppClips?: boolean } = {}) {
    const query = new URLSearchParams();
    if (options.includeSystem) query.set("include_system", "true");
    if (options.includeAppClips) query.set("include_app_clips", "true");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.deviceRequest<DeviceApp[]>(deviceId, `/api/device/apps${suffix}`);
  }

  async launchApp(deviceId: string, bundleId: string) {
    await this.deviceRequest<void>(
      deviceId,
      `/api/device/apps/${encodeURIComponent(bundleId)}/launch`,
      { method: "PUT" },
    );
  }

  async stopApp(deviceId: string, bundleId: string) {
    await this.deviceRequest<void>(
      deviceId,
      `/api/device/apps/${encodeURIComponent(bundleId)}/stop`,
      { method: "PUT" },
    );
  }

  appIconSource(deviceId: string, bundleId: string) {
    return {
      uri: `${this.connection.origin}/api/device/apps/${encodeURIComponent(bundleId)}/icon`,
      headers: {
        authorization: `Bearer ${this.connection.token}`,
        "x-devicehub-device": deviceId,
      },
    };
  }

  async pasteDeviceText(deviceId: string, text: string) {
    await this.deviceRequest<void>(deviceId, "/api/device/text/paste", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  async lockDevice(deviceId: string) {
    await this.deviceRequest<void>(deviceId, "/api/device/lock", {
      method: "PUT",
    }, DEVICE_COMMAND_TIMEOUT_MS);
  }

  async restartDevice(deviceId: string) {
    await this.deviceRequest<void>(deviceId, "/api/device/restart", {
      method: "PUT",
    }, DEVICE_COMMAND_TIMEOUT_MS);
  }

  async shutdownDevice(deviceId: string) {
    await this.deviceRequest<void>(deviceId, "/api/device/shutdown", {
      method: "PUT",
    }, DEVICE_COMMAND_TIMEOUT_MS);
  }

  async location(deviceId: string) {
    return this.deviceRequest<LocationStatus>(deviceId, "/api/device/location");
  }

  async deviceDetails(deviceId: string) {
    return this.deviceRequest<DeviceDetails>(deviceId, "/api/device/details", {}, DEVICE_DETAILS_TIMEOUT_MS);
  }

  async setLocation(deviceId: string, latitude: number, longitude: number) {
    await this.deviceRequest<void>(deviceId, "/api/device/location", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude, longitude }),
    }, DEVICE_COMMAND_TIMEOUT_MS);
  }

  async clearLocation(deviceId: string) {
    await this.deviceRequest<void>(deviceId, "/api/device/location", {
      method: "DELETE",
    }, DEVICE_COMMAND_TIMEOUT_MS);
  }

  openDevice(deviceId: string, callbacks: SocketCallbacks = {}) {
    return new DeviceHubSocket(this.connection, deviceId, this.platform, callbacks);
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.connection.token}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = init.signal;
    const abortFromUpstream = () => controller.abort();
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    try {
      const { signal: _ignoredSignal, ...requestInit } = init;
      const response = await fetch(`${this.connection.origin}${path}`, {
        ...requestInit,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new DeviceHubHttpError(response.status, await readError(response));
      if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (controller.signal.aborted) {
        if (upstreamSignal?.aborted) throw error;
        throw new DeviceHubRequestTimeoutError(path, timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }

  private async deviceRequest<T>(
    deviceId: string,
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    const headers = new Headers(init.headers);
    headers.set("x-devicehub-device", deviceId);
    return this.request<T>(path, { ...init, headers }, timeoutMs);
  }
}

export class DeviceHubSocket {
  private socket: WebSocket | null = null;
  private closed = false;
  private leaseGranted = false;
  private readonly callbacks: SocketCallbacks;
  private readonly listeners = new Set<SocketCallbacks>();
  private readonly connection: DeviceHubConnection;
  private readonly deviceId: string;
  private readonly platform: MobilePlatform;
  private negotiatedHello: ServerHello | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeComplete = false;

  constructor(
    connection: DeviceHubConnection,
    deviceId: string,
    platform: MobilePlatform,
    callbacks: SocketCallbacks = {},
  ) {
    this.connection = connection;
    this.deviceId = deviceId;
    this.platform = platform;
    this.callbacks = callbacks;
    this.open();
  }

  private open() {
    this.clearHandshakeTimer();
    this.handshakeComplete = false;
    const query = new URLSearchParams({ device_id: this.deviceId });
    const socket = new WebSocket(
      `${websocketOrigin(this.connection.origin)}/api/ws?${query.toString()}`,
      ["devicehub-mask", this.connection.token],
    );
    this.socket = socket;
    this.handshakeTimer = setTimeout(() => {
      if (this.socket !== socket || this.closed || this.handshakeComplete) return;
      this.clearHandshakeTimer();
      this.dispatch((listener) =>
        listener.onError?.(new DeviceHubSocketHandshakeTimeoutError(this.deviceId)),
      );
      socket.close();
    }, SOCKET_HANDSHAKE_TIMEOUT_MS);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (this.socket !== socket || this.closed) return;
      this.leaseGranted = false;
      this.send({
        type: "client_hello",
        protocol_version: 1,
        platform: this.platform,
        client_version: "0.1.0",
        capabilities: ["native_hevc", "native_pcm", "multi_touch", "hardware_buttons"],
      });
      this.dispatch((listener) => listener.onOpen?.());
    };
    socket.onerror = (event) => {
      if (this.socket === socket) this.dispatch((listener) => listener.onError?.(event));
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearHandshakeTimer();
      this.handshakeComplete = false;
      this.socket = null;
      this.leaseGranted = false;
      this.dispatch((listener) => listener.onClose?.(event));
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) void this.handleMessage(socket, event.data);
    };
  }

  subscribe(callbacks: SocketCallbacks) {
    this.listeners.add(callbacks);
    return () => this.listeners.delete(callbacks);
  }

  get readyState() {
    return this.socket?.readyState ?? 3;
  }

  get controlGranted() {
    return this.leaseGranted;
  }

  send(command: DeviceHubCommand) {
    if (this.closed || !this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }

  reconnect(force = false) {
    if (this.closed) return false;
    if (this.socket && !force) return false;
    if (force && this.socket) {
      const previous = this.socket;
      this.clearHandshakeTimer();
      this.socket = null;
      previous.close();
    }
    this.leaseGranted = false;
    this.negotiatedHello = null;
    this.handshakeComplete = false;
    this.open();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearHandshakeTimer();
    this.handshakeComplete = false;
    this.socket?.close();
    this.socket = null;
  }

  private async handleMessage(source: WebSocket, data: unknown) {
    let protocolError = false;
    try {
      if (this.socket !== source || this.closed) return;
      if (typeof data === "string") {
        const message = JSON.parse(data) as ServerMessage;
        this.dispatch((listener) => listener.onMessage?.(message));
        if (message.type === "server_hello") {
          protocolError = true;
          const hello = parseServerHello(message.payload);
          this.handshakeComplete = true;
          this.clearHandshakeTimer();
          this.negotiatedHello = hello;
          this.dispatch((listener) => listener.onServerHello?.(hello));
        }
        if (message.type === "control_lease") {
          const granted = (message.payload as { granted?: unknown }).granted;
          if (typeof granted === "boolean") {
            this.leaseGranted = granted;
            this.dispatch((listener) => listener.onControlLease?.(granted));
          }
        }
        return;
      }
      const buffer = data instanceof ArrayBuffer
        ? data
        : data instanceof Uint8Array
          ? data
          : data && typeof (data as Blob).arrayBuffer === "function"
            ? await (data as Blob).arrayBuffer()
            : null;
      if (this.socket !== source || this.closed) return;
      if (!buffer) return;
      const packet = parseMediaPacket(buffer);
      if (packet) this.dispatch((listener) => listener.onMedia?.(packet));
    } catch (error) {
      if (protocolError) {
        this.clearHandshakeTimer();
        source.close();
      }
      this.dispatch((listener) => listener.onError?.(error));
    }
  }

  private clearHandshakeTimer() {
    if (this.handshakeTimer === null) return;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private dispatch(callback: (listener: SocketCallbacks) => void) {
    callback(this.callbacks);
    for (const listener of this.listeners) callback(listener);
  }

  get serverHello() {
    return this.negotiatedHello;
  }
}

function parseServerHello(payload: unknown): ServerHello {
  if (!payload || typeof payload !== "object") throw new Error("DeviceHub server returned an invalid handshake");
  const value = payload as Partial<ServerHello>;
  if (value.protocol_version !== MOBILE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported DeviceHub protocol version: ${String(value.protocol_version)}`);
  }
  if (!Array.isArray(value.target_platforms) || !value.target_platforms.includes("ios")) {
    throw new Error("DeviceHub server does not advertise iPhone/iPad targets");
  }
  if (value.video?.codec !== "hevc" || value.video?.packet !== "DHV2") {
    throw new Error("DeviceHub server does not advertise the HEVC video stream");
  }
  if (value.audio?.codec !== "pcm_s16le" || value.audio?.packet !== "DHA1") {
    throw new Error("DeviceHub server does not advertise the PCM audio stream");
  }
  return value as ServerHello;
}
