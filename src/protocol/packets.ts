import type { AudioPacket, MediaPacket, VideoPacket } from "./types";

const VIDEO_MAGIC = [0x44, 0x48, 0x56, 0x32] as const;
const AUDIO_MAGIC = [0x44, 0x48, 0x41, 0x31] as const;
const VIDEO_HEADER_BYTES = 36;
const AUDIO_HEADER_BYTES = 12;

function hasMagic(bytes: Uint8Array, magic: readonly number[]) {
  return magic.every((value, index) => bytes[index] === value);
}

function asArrayBuffer(data: ArrayBuffer | Uint8Array) {
  if (data instanceof Uint8Array) {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? new Uint8Array(data).slice().buffer
      : new Uint8Array(data).slice().buffer;
  }
  return data;
}

/** Decode one binary WebSocket message from the server. */
export function parseMediaPacket(input: ArrayBuffer | Uint8Array): MediaPacket | null {
  const buffer = asArrayBuffer(input);
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= VIDEO_HEADER_BYTES && hasMagic(bytes, VIDEO_MAGIC)) {
    return parseVideoPacket(buffer);
  }
  if (bytes.length >= AUDIO_HEADER_BYTES && hasMagic(bytes, AUDIO_MAGIC)) {
    return parseAudioPacket(buffer);
  }
  return null;
}

function parseVideoPacket(buffer: ArrayBuffer): VideoPacket {
  const view = new DataView(buffer);
  const width = view.getUint16(32);
  const height = view.getUint16(34);
  if (width === 0 || height === 0) throw new Error("DeviceHub video packet has invalid dimensions");
  return {
    kind: "video",
    keyframe: view.getUint8(4) === 1,
    timestamp: view.getBigUint64(8),
    sequence: view.getBigUint64(16),
    generation: view.getBigUint64(24),
    width,
    height,
    data: new Uint8Array(buffer, VIDEO_HEADER_BYTES),
  };
}

function parseAudioPacket(buffer: ArrayBuffer): AudioPacket {
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(4);
  const channels = view.getUint16(8);
  const payloadBytes = buffer.byteLength - AUDIO_HEADER_BYTES;
  if (sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("DeviceHub audio packet has an invalid sample rate");
  }
  if (channels < 1 || channels > 8 || payloadBytes === 0 || payloadBytes % (channels * 2) !== 0) {
    throw new Error("DeviceHub audio packet has an invalid PCM payload");
  }
  const pcm = new Int16Array(payloadBytes / 2);
  const source = new DataView(buffer, AUDIO_HEADER_BYTES);
  for (let index = 0; index < pcm.length; index += 1) {
    pcm[index] = source.getInt16(index * 2, true);
  }
  return { kind: "audio", sampleRate, channels, data: pcm };
}

export function isVideoPacket(packet: MediaPacket): packet is VideoPacket {
  return packet.kind === "video";
}

export function isAudioPacket(packet: MediaPacket): packet is AudioPacket {
  return packet.kind === "audio";
}
