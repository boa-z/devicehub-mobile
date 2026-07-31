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
  data: Int16Array;
};

export type MediaPacket = VideoPacket | AudioPacket;
