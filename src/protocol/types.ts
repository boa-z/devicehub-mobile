/** Wire models shared by the mobile client and the DeviceHub server. */

export type Orientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

export type SessionPhase =
  | "discovered"
  | "connecting"
  | "connected"
  | "recovering"
  | "disconnecting"
  | "disconnected"
  | "failed";

export type Device = {
  id: string;
  udid: string;
  name: string;
  connection: string;
  pairing: "paired" | "unpaired" | "not_applicable";
  session_status: string | null;
  session_phase: SessionPhase | null;
  session_updated_at_ms: number | null;
  session_error: string | null;
  resources: {
    video: boolean;
    audio: boolean;
    performance: boolean;
    device_logs: boolean;
  } | null;
};

export type DeviceApp = {
  bundle_id: string;
  name: string;
  version: string | null;
  bundle_version: string | null;
  is_removable: boolean;
  is_first_party: boolean;
  is_developer_app: boolean;
  is_app_clip: boolean;
  signing_kind: "system" | "development" | "test_flight" | "app_store" | "distribution" | "unknown";
  minimum_os_version: string | null;
  debuggable: boolean | null;
  documents_available: boolean;
  static_disk_usage_bytes: number | null;
  dynamic_disk_usage_bytes: number | null;
  total_disk_usage_bytes: number | null;
  is_running: boolean | null;
};

export type AppConsolePhase = "stopped" | "starting" | "running" | "exited" | "failed";

export type AppConsoleLine = {
  sequence: number;
  text: string;
};

export type AppConsoleSnapshot = {
  phase: AppConsolePhase;
  bundle_id: string | null;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  total_bytes: number;
  total_lines: number;
  dropped_lines: number;
  next_sequence: number;
  reset: boolean;
  lines: AppConsoleLine[];
  last_error: string | null;
};

export type PairDeviceResult = {
  outcome: "paired" | "denied" | "locked" | "timed_out" | "failed";
  error: string | null;
};

export type ForgetDeviceResult = {
  outcome: "forgotten" | "host_record_removed" | "device_forgotten_host_cleanup_failed" | "failed";
  error: string | null;
};

export type DeviceStorage = {
  data_capacity_bytes: number | null;
  data_available_bytes: number | null;
  system_capacity_bytes: number | null;
  system_available_bytes: number | null;
};

export type DeviceBattery = {
  level_percent: number | null;
  temperature_celsius: number | null;
  is_charging: boolean | null;
  external_connected: boolean | null;
  fully_charged: boolean | null;
  cycle_count: number | null;
  voltage_mv: number | null;
  instant_amperage_ma: number | null;
  design_capacity_mah: number | null;
  full_charge_capacity_mah: number | null;
  health_percent: number | null;
  time_remaining_minutes: number | null;
  adapter_watts: number | null;
  adapter_name: string | null;
};

export type DeviceRegionalSettings = {
  language: string | null;
  locale: string | null;
  time_zone: string | null;
  uses_24_hour_clock: boolean | null;
};

export type DeviceDetails = {
  udid: string;
  name: string;
  product_type: string;
  product_version: string;
  build_version: string | null;
  device_class: string | null;
  cpu_architecture: string | null;
  model_number: string | null;
  hardware_model: string | null;
  device_color: string | null;
  enclosure_color: string | null;
  serial_number: string | null;
  ecid: string | null;
  total_disk_capacity: number | null;
  storage: DeviceStorage | null;
  activation_state: string | null;
  developer_mode_enabled: boolean | null;
  developer_image_mounted: boolean | null;
  regional_settings: DeviceRegionalSettings | null;
  battery: DeviceBattery | null;
};

export type LocationStatus = {
  available: boolean;
  active: boolean;
  backend: "dvt" | "legacy" | null;
  latitude: number | null;
  longitude: number | null;
  error: string | null;
};

export type DeviceStatus = {
  status: string;
  phase: SessionPhase;
  updated_at_ms: number;
  active_udid: string | null;
  active_device_id: string | null;
  error: string | null;
  orientation: Orientation;
  devices: Device[];
  location: LocationStatus;
};

export type MultiTouchContact = {
  identity: number;
  touching: boolean;
  x: number;
  y: number;
};

export type DeviceHubCommand =
  | {
      type: "client_hello";
      protocol_version: number;
      platform: "ios" | "android";
      client_version: string;
      capabilities: string[];
    }
  | { type: "multi_touch"; contacts: MultiTouchContact[] }
  | { type: "button"; name: string }
  | { type: "button_down"; name: string }
  | { type: "button_up"; name: string }
  | { type: "rotate"; direction: "left" | "right" }
  | { type: "video_demand"; active: boolean }
  | { type: "audio_demand"; active: boolean }
  | { type: "browser_video_keyframe" }
  | { type: "frame_presented"; sequence: string };

export type ServerMessage =
  | { type: "server_hello"; payload: ServerHello }
  | { type: "control_lease"; payload: { granted: boolean } }
  | { type: "status"; payload: DeviceStatus }
  | { type: "clipboard"; payload: unknown }
  | { type: "device_event"; payload: unknown }
  | { type: "stream_metrics"; payload: unknown }
  | { type: string; payload?: unknown };

export type ServerHello = {
  protocol_version: number;
  target_platforms: string[];
  video: { codec: string; packet: string };
  audio: { codec: string; packet: string };
  input: string[];
  control_lease: boolean;
};

export type VideoPacket = {
  kind: "video";
  keyframe: boolean;
  timestamp: bigint;
  sequence: bigint;
  generation: bigint;
  width: number;
  height: number;
  data: Uint8Array;
};

export type AudioPacket = {
  kind: "audio";
  sampleRate: number;
  channels: number;
  /** Little-endian signed PCM16 bytes, kept as bytes for native bridge parity. */
  data: Uint8Array;
};

export type MediaPacket = VideoPacket | AudioPacket;
