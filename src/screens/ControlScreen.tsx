import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { DeviceHubSocket } from "../protocol/client";
import { isAudioPacket, isVideoPacket } from "../protocol/packets";
import type { Device, MultiTouchContact } from "../protocol/types";
import { DeviceHubMedia, DeviceHubVideoView } from "devicehub-media";

const NativeVideoView = DeviceHubVideoView as any;

type Props = {
  socket: DeviceHubSocket;
  device: Device;
  onBack: () => void;
};

const HARDWARE_BUTTONS = [
  ["home", "Home"],
  ["lock", "Lock"],
  ["volume-up", "Vol +"],
  ["volume-down", "Vol -"],
  ["mute", "Mute"],
] as const;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function contactsFromEvent(event: GestureResponderEvent, width: number, height: number): MultiTouchContact[] {
  return event.nativeEvent.touches.map((touch) => ({
    identity: Math.abs(Number(touch.identifier)) % 255,
    touching: true,
    x: clamp(touch.locationX / Math.max(width, 1)),
    y: clamp(touch.locationY / Math.max(height, 1)),
  }));
}

function changedContact(event: GestureResponderEvent, width: number, height: number): MultiTouchContact[] {
  return event.nativeEvent.changedTouches.map((touch) => ({
    identity: Math.abs(Number(touch.identifier)) % 255,
    touching: false,
    x: clamp(touch.locationX / Math.max(width, 1)),
    y: clamp(touch.locationY / Math.max(height, 1)),
  }));
}

export function ControlScreen({ socket, device, onBack }: Props) {
  const [connected, setConnected] = useState(socket.readyState === 1);
  const [controlGranted, setControlGranted] = useState(socket.controlGranted);
  const [surface, setSurface] = useState({ width: 1, height: 1 });
  const [videoInfo, setVideoInfo] = useState("Waiting for video frames");
  const [audioInfo, setAudioInfo] = useState("Audio off");
  const nativeVideoRef = useRef<unknown>(null);

  useEffect(() => {
    const onOpen = () => {
      setConnected(true);
      socket.send({ type: "video_demand", active: true });
      socket.send({ type: "audio_demand", active: true });
    };
    const onClose = () => setConnected(false);
    const onLease = (granted: boolean) => setControlGranted(granted);
    const onMedia = (packet: import("../protocol/types").MediaPacket) => {
      if (isVideoPacket(packet)) {
        setVideoInfo(`${packet.width} x ${packet.height} · ${packet.keyframe ? "keyframe" : "frame"}`);
        const view = nativeVideoRef.current;
        if (DeviceHubMedia && view) {
          DeviceHubMedia.pushVideoFrame(view, packet.data, Number(packet.timestamp) * 1_000, packet.keyframe);
        }
      } else if (isAudioPacket(packet)) {
        setAudioInfo(`${packet.sampleRate} Hz · ${packet.channels} ch`);
        DeviceHubMedia?.pushAudioPcm(packet.data, packet.sampleRate, packet.channels);
      }
    };
    const unsubscribe = socket.subscribe({
      onOpen,
      onClose,
      onControlLease: onLease,
      onMedia,
    });
    setControlGranted(socket.controlGranted);
    if (socket.readyState === 1) {
      setConnected(true);
      socket.send({ type: "video_demand", active: true });
      socket.send({ type: "audio_demand", active: true });
    }
    return () => {
      unsubscribe();
      socket.send({ type: "video_demand", active: false });
      socket.send({ type: "audio_demand", active: false });
      DeviceHubMedia?.reset();
      socket.close();
    };
  }, [socket]);

  const onSurfaceLayout = (event: LayoutChangeEvent) => {
    setSurface({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  };

  const sendTouches = (event: GestureResponderEvent) => {
    const contacts = contactsFromEvent(event, surface.width, surface.height);
    socket.send({ type: "multi_touch", contacts });
  };

  const endTouches = (event: GestureResponderEvent) => {
    const ended = changedContact(event, surface.width, surface.height);
    const remaining = contactsFromEvent(event, surface.width, surface.height);
    socket.send({ type: "multi_touch", contacts: [...remaining, ...ended] });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹ Devices</Text>
        </Pressable>
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} style={styles.title}>{device.name || "iPhone / iPad"}</Text>
          <Text style={[styles.subtitle, connected ? styles.connected : styles.disconnected]}>
            {connected ? (controlGranted ? "Connected · control granted" : "Connected · view only") : "Disconnected"}
          </Text>
        </View>
        <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{device.connection}</Text></View>
      </View>
      <View style={styles.content}>
        <View style={styles.videoFrame} onLayout={onSurfaceLayout}>
          <View
            accessibilityLabel="iPhone touch surface"
            onTouchStart={sendTouches}
            onTouchMove={sendTouches}
            onTouchEnd={endTouches}
            onTouchCancel={endTouches}
            style={styles.touchSurface}
          >
            {NativeVideoView ? (
              <NativeVideoView
                contentMode="fit"
                ref={nativeVideoRef}
                style={styles.nativeVideo}
              />
            ) : (
              <>
                <Text style={styles.videoTitle}>iPhone screen</Text>
                <Text style={styles.videoDescription}>Install the DeviceHub development build to enable native HEVC rendering.</Text>
              </>
            )}
            <Text style={styles.videoTelemetry}>{videoInfo}</Text>
            <Text style={styles.videoTelemetry}>{audioInfo}</Text>
          </View>
        </View>
        <View style={styles.toolbar}>
          {HARDWARE_BUTTONS.map(([name, label]) => (
            <Pressable
              accessibilityRole="button"
              disabled={!controlGranted}
              key={name}
              onPress={() => socket.send({ type: "button", name })}
              style={({ pressed }) => [styles.hardwareButton, pressed && styles.buttonPressed, !controlGranted && styles.disabled]}
            >
              <Text style={styles.hardwareText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.secondaryToolbar}>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "left" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Rotate left</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "right" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Rotate right</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#111821", flex: 1 },
  header: { alignItems: "center", backgroundColor: "#1a2430", flexDirection: "row", paddingHorizontal: 14, paddingVertical: 12 },
  backButton: { paddingVertical: 8, width: 88 },
  backText: { color: "#8fc1ff", fontSize: 15, fontWeight: "700" },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { color: "#f1f5fa", fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 3 },
  connected: { color: "#66d39a" },
  disconnected: { color: "#f0a36a" },
  headerBadge: { backgroundColor: "#2a3747", borderRadius: 7, marginLeft: 8, paddingHorizontal: 8, paddingVertical: 5 },
  headerBadgeText: { color: "#bfccda", fontSize: 11, fontWeight: "700" },
  content: { flex: 1, padding: 16 },
  videoFrame: { alignSelf: "center", backgroundColor: "#080d12", borderColor: "#2b3a4b", borderRadius: 16, borderWidth: 1, flex: 1, maxHeight: 720, maxWidth: 520, overflow: "hidden", width: "100%" },
  touchSurface: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  nativeVideo: StyleSheet.absoluteFill,
  videoTitle: { color: "#f1f5fa", fontSize: 20, fontWeight: "700" },
  videoDescription: { color: "#8796a8", fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 280, textAlign: "center" },
  videoTelemetry: { color: "#6f8195", fontSize: 11, marginTop: 12 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingTop: 14 },
  hardwareButton: { alignItems: "center", backgroundColor: "#263548", borderColor: "#3b5068", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 42, minWidth: 68, paddingHorizontal: 10 },
  hardwareText: { color: "#e1e9f2", fontSize: 12, fontWeight: "700" },
  buttonPressed: { backgroundColor: "#385576" },
  secondaryToolbar: { flexDirection: "row", gap: 8, justifyContent: "center", paddingTop: 10 },
  secondaryButton: { paddingHorizontal: 10, paddingVertical: 8 },
  secondaryText: { color: "#8fc1ff", fontSize: 12, fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
