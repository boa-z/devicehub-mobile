import { parseMediaPacket } from "./packets";
import type {
  DeviceHubCommand,
  DeviceStatus,
  MediaPacket,
  ServerMessage,
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
};

export class DeviceHubHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DeviceHubHttpError";
    this.status = status;
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
  return parsed.toString().replace(/\/$/, "");
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

  openDevice(deviceId: string, callbacks: SocketCallbacks = {}) {
    return new DeviceHubSocket(this.connection, deviceId, this.platform, callbacks);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.connection.token}`);
    const response = await fetch(`${this.connection.origin}${path}`, { ...init, headers });
    if (!response.ok) throw new DeviceHubHttpError(response.status, await readError(response));
    if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
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
    const query = new URLSearchParams({ device_id: this.deviceId });
    const socket = new WebSocket(
      `${websocketOrigin(this.connection.origin)}/api/ws?${query.toString()}`,
      ["devicehub-mask", this.connection.token],
    );
    this.socket = socket;
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

  reconnect() {
    if (this.closed || this.socket) return false;
    this.open();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  private async handleMessage(source: WebSocket, data: unknown) {
    try {
      if (this.socket !== source || this.closed) return;
      if (typeof data === "string") {
        const message = JSON.parse(data) as ServerMessage;
        this.dispatch((listener) => listener.onMessage?.(message));
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
      this.dispatch((listener) => listener.onError?.(error));
    }
  }

  private dispatch(callback: (listener: SocketCallbacks) => void) {
    callback(this.callbacks);
    for (const listener of this.listeners) callback(listener);
  }
}
