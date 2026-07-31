import { useEffect, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { DeviceHubClient, DeviceHubSocket } from "../protocol/client";
import { TouchIdentityAllocator } from "../input/touchIdentities";
import { isAudioPacket, isVideoPacket } from "../protocol/packets";
import type { Device, DeviceApp, MultiTouchContact } from "../protocol/types";
import { DeviceHubMedia, DeviceHubVideoView } from "devicehub-media";

const NativeVideoView = DeviceHubVideoView as any;

type Props = {
  client: DeviceHubClient;
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

function contactsFromEvent(
  event: GestureResponderEvent,
  width: number,
  height: number,
  identities: TouchIdentityAllocator,
): MultiTouchContact[] {
  return event.nativeEvent.touches.flatMap((touch) => {
    const identity = identities.identityFor(touch.identifier);
    if (identity === null) return [];
    return [{
      identity,
      touching: true,
      x: clamp(touch.locationX / Math.max(width, 1)),
      y: clamp(touch.locationY / Math.max(height, 1)),
    }];
  });
}

function changedContact(
  event: GestureResponderEvent,
  width: number,
  height: number,
  identities: TouchIdentityAllocator,
): MultiTouchContact[] {
  return event.nativeEvent.changedTouches.flatMap((touch) => {
    const identity = identities.identityFor(touch.identifier);
    if (identity === null) return [];
    return [{
      identity,
      touching: false,
      x: clamp(touch.locationX / Math.max(width, 1)),
      y: clamp(touch.locationY / Math.max(height, 1)),
    }];
  });
}

export function ControlScreen({ client, socket, device, onBack }: Props) {
  const [connected, setConnected] = useState(socket.serverHello !== null);
  const [controlGranted, setControlGranted] = useState(socket.controlGranted);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [surface, setSurface] = useState({ width: 1, height: 1 });
  const [videoInfo, setVideoInfo] = useState("Waiting for video frames");
  const [audioInfo, setAudioInfo] = useState("Audio off");
  const [appsOpen, setAppsOpen] = useState(false);
  const [apps, setApps] = useState<DeviceApp[]>([]);
  const [appsBusy, setAppsBusy] = useState(false);
  const [appAction, setAppAction] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const nativeVideoRef = useRef<unknown>(null);
  const touchIdentities = useRef(new TouchIdentityAllocator());
  const appState = useRef(AppState.currentState);
  const lastVideoInfoAt = useRef(0);
  const lastAudioInfoAt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    let disposed = false;
    const resetNativeMedia = () => {
      if (nativeVideoRef.current) DeviceHubMedia?.resetVideo(nativeVideoRef.current);
      DeviceHubMedia?.reset();
    };
    const requestMedia = () => {
      socket.send({ type: "video_demand", active: true });
      socket.send({ type: "audio_demand", active: true });
    };
    const pauseMedia = () => {
      socket.send({ type: "video_demand", active: false });
      socket.send({ type: "audio_demand", active: false });
      resetNativeMedia();
    };
    const scheduleReconnect = () => {
      if (disposed || appState.current !== "active" || reconnectTimer.current) return;
      const delay = Math.min(8_000, 500 * 2 ** reconnectAttempt.current);
      reconnectAttempt.current = Math.min(reconnectAttempt.current + 1, 4);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        socket.reconnect();
      }, delay);
    };
    const onOpen = () => {
      // The transport can be open before the DeviceHub protocol handshake.
      // Media demand starts only after server_hello is accepted below.
      setConnectionError(null);
      lastVideoInfoAt.current = 0;
      lastAudioInfoAt.current = 0;
    };
    const onServerHello = () => {
      setConnected(true);
      setConnectionError(null);
      reconnectAttempt.current = 0;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (appState.current === "active") requestMedia();
    };
    const onClose = () => {
      if (disposed) return;
      resetNativeMedia();
      setConnected(false);
      scheduleReconnect();
    };
    const onError = (error: unknown) => {
      if (disposed) return;
      setConnectionError(error instanceof Error ? error.message : String(error));
    };
    const onLease = (granted: boolean) => setControlGranted(granted);
    const onMedia = (packet: import("../protocol/types").MediaPacket) => {
      if (isVideoPacket(packet)) {
        const now = Date.now();
        if (now - lastVideoInfoAt.current >= 250 || lastVideoInfoAt.current === 0) {
          lastVideoInfoAt.current = now;
          setVideoInfo(`${packet.width} x ${packet.height} · ${packet.keyframe ? "keyframe" : "frame"}`);
        }
        const view = nativeVideoRef.current;
        if (DeviceHubMedia && view) {
          DeviceHubMedia.pushVideoFrame(
            view,
            packet.data,
            Number(packet.timestamp) * 1_000,
            packet.keyframe,
            packet.width,
            packet.height,
          );
        }
      } else if (isAudioPacket(packet)) {
        const now = Date.now();
        if (now - lastAudioInfoAt.current >= 1_000 || lastAudioInfoAt.current === 0) {
          lastAudioInfoAt.current = now;
          setAudioInfo(`${packet.sampleRate} Hz · ${packet.channels} ch`);
        }
        DeviceHubMedia?.pushAudioPcm(packet.data, packet.sampleRate, packet.channels);
      }
    };
    const unsubscribe = socket.subscribe({
      onOpen,
      onClose,
      onError,
      onControlLease: onLease,
      onMedia,
      onServerHello,
    });
    setControlGranted(socket.controlGranted);
    if (socket.serverHello !== null && appState.current === "active") {
      setConnected(true);
      requestMedia();
    }
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appState.current;
      appState.current = nextState;
      if (nextState === "active" && previousState !== "active") {
        setConnected(false);
        setControlGranted(false);
        setConnectionError(null);
        resetNativeMedia();
        socket.reconnect(true);
      } else if (nextState !== "active" && previousState === "active") {
        pauseMedia();
      }
    });
    return () => {
      disposed = true;
      appStateSubscription.remove();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      unsubscribe();
      socket.send({ type: "video_demand", active: false });
      socket.send({ type: "audio_demand", active: false });
      resetNativeMedia();
      socket.close();
    };
  }, [socket]);

  const onSurfaceLayout = (event: LayoutChangeEvent) => {
    setSurface({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  };

  const sendTouches = (event: GestureResponderEvent) => {
    const contacts = contactsFromEvent(event, surface.width, surface.height, touchIdentities.current);
    socket.send({ type: "multi_touch", contacts });
  };

  const endTouches = (event: GestureResponderEvent) => {
    const ended = changedContact(event, surface.width, surface.height, touchIdentities.current);
    const remaining = contactsFromEvent(event, surface.width, surface.height, touchIdentities.current);
    for (const touch of event.nativeEvent.changedTouches) {
      touchIdentities.current.release(touch.identifier);
    }
    socket.send({ type: "multi_touch", contacts: [...remaining, ...ended] });
  };

  const loadApps = async () => {
    setAppsBusy(true);
    setAppsError(null);
    try {
      setApps(await client.listApps(device.id));
    } catch (error) {
      setAppsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppsBusy(false);
    }
  };

  const openApps = () => {
    setAppsOpen(true);
    void loadApps();
  };

  const toggleApp = async (app: DeviceApp) => {
    if (appAction) return;
    setAppAction(app.bundle_id);
    setAppsError(null);
    try {
      if (app.is_running) {
        await client.stopApp(device.id, app.bundle_id);
      } else {
        await client.launchApp(device.id, app.bundle_id);
      }
      await loadApps();
    } catch (error) {
      setAppsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppAction(null);
    }
  };

  const openPaste = () => {
    setPasteText("");
    setPasteError(null);
    setPasteOpen(true);
  };

  const submitPaste = async () => {
    if (!pasteText || pasteBusy) return;
    setPasteBusy(true);
    setPasteError(null);
    try {
      await client.pasteDeviceText(device.id, pasteText);
      setPasteOpen(false);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : String(error));
    } finally {
      setPasteBusy(false);
    }
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
      {!connected || connectionError ? (
        <View style={styles.connectionBanner}>
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionTitle}>{connected ? "Connection warning" : "Connecting to DeviceHub"}</Text>
            {connectionError ? <Text style={styles.connectionError}>{connectionError}</Text> : null}
          </View>
          {!connected ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setConnectionError(null);
                socket.reconnect(true);
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
          <Pressable accessibilityRole="button" disabled={!connected} onPress={openApps} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Apps</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "left" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Rotate left</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "right" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Rotate right</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={openPaste} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Paste text</Text>
          </Pressable>
        </View>
      </View>
      <Modal animationType="slide" onRequestClose={() => setAppsOpen(false)} visible={appsOpen}>
        <View style={styles.appsModal}>
          <View style={styles.appsHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>Apps</Text>
              <Text style={styles.appsSubtitle}>Launch or stop an installed app</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setAppsOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          {appsError ? <Text style={styles.appsError}>{appsError}</Text> : null}
          {appsBusy && apps.length === 0 ? (
            <View style={styles.appsLoading}><ActivityIndicator color="#2368c4" /></View>
          ) : (
            <FlatList
              contentContainerStyle={apps.length === 0 ? styles.appsEmptyList : styles.appsList}
              data={apps}
              keyExtractor={(app) => app.bundle_id}
              refreshing={appsBusy}
              onRefresh={() => void loadApps()}
              renderItem={({ item }) => {
                const busy = appAction === item.bundle_id;
                return (
                  <View style={styles.appRow}>
                    <View style={styles.appCopy}>
                      <Text numberOfLines={1} style={styles.appName}>{item.name || item.bundle_id}</Text>
                      <Text numberOfLines={1} style={styles.appBundle}>{item.bundle_id}</Text>
                      <Text style={[styles.appState, item.is_running && styles.appRunning]}>
                        {item.is_running ? "Running" : "Stopped"}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void toggleApp(item)}
                      style={({ pressed }) => [styles.appAction, pressed && styles.buttonPressed, busy && styles.disabled]}
                    >
                      {busy ? <ActivityIndicator color="#2368c4" /> : <Text style={styles.appActionText}>{item.is_running ? "Stop" : "Launch"}</Text>}
                    </Pressable>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.appsEmpty}>No user apps were returned by the device.</Text>}
            />
          )}
        </View>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setPasteOpen(false)} visible={pasteOpen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.pasteModal}
        >
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>Paste text</Text>
              <Text style={styles.appsSubtitle}>Send text to the active iPhone</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setPasteOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.pasteBody}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              maxLength={1024}
              onChangeText={setPasteText}
              placeholder="Text to paste on the device"
              placeholderTextColor="#8c96a5"
              style={styles.pasteInput}
              textAlignVertical="top"
              value={pasteText}
            />
            {pasteError ? <Text style={styles.appsError}>{pasteError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={!pasteText || pasteBusy}
              onPress={() => void submitPaste()}
              style={({ pressed }) => [styles.pasteButton, pressed && styles.buttonPressed, (!pasteText || pasteBusy) && styles.disabled]}
            >
              {pasteBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.pasteButtonText}>Send to device</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  connectionBanner: { alignItems: "center", backgroundColor: "#2a2020", borderBottomColor: "#523737", borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  connectionCopy: { flex: 1, minWidth: 0 },
  connectionTitle: { color: "#f4c7a4", fontSize: 12, fontWeight: "700" },
  connectionError: { color: "#e8b6a3", fontSize: 11, lineHeight: 16, marginTop: 2 },
  retryButton: { borderColor: "#b97455", borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  retryText: { color: "#f4c7a4", fontSize: 12, fontWeight: "700" },
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
  secondaryToolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingTop: 10 },
  secondaryButton: { paddingHorizontal: 10, paddingVertical: 8 },
  secondaryText: { color: "#8fc1ff", fontSize: 12, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  appsModal: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  appsHeader: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 14 },
  appsHeaderCopy: { flex: 1, minWidth: 0 },
  appsTitle: { color: "#152033", fontSize: 24, fontWeight: "800" },
  appsSubtitle: { color: "#778395", fontSize: 13, marginTop: 3 },
  closeButton: { paddingHorizontal: 8, paddingVertical: 8 },
  closeText: { color: "#2368c4", fontSize: 14, fontWeight: "700" },
  appsError: { color: "#bd2d3b", fontSize: 13, lineHeight: 19, paddingHorizontal: 18, paddingTop: 14 },
  appsLoading: { alignItems: "center", flex: 1, justifyContent: "center" },
  appsList: { padding: 14 },
  appsEmptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  appRow: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 12, borderWidth: 1, flexDirection: "row", marginBottom: 10, padding: 13 },
  appCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  appName: { color: "#152033", fontSize: 15, fontWeight: "700" },
  appBundle: { color: "#778395", fontSize: 11, marginTop: 3 },
  appState: { color: "#bd7621", fontSize: 12, marginTop: 5 },
  appRunning: { color: "#2b9a66" },
  appAction: { alignItems: "center", borderColor: "#b8cdea", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 38, minWidth: 72, paddingHorizontal: 10 },
  appActionText: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  appsEmpty: { color: "#778395", fontSize: 14, lineHeight: 21, textAlign: "center" },
  pasteModal: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  pasteHeader: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: 14, paddingHorizontal: 18 },
  pasteBody: { padding: 18 },
  pasteInput: { backgroundColor: "#ffffff", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, minHeight: 180, padding: 14 },
  pasteButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 10, justifyContent: "center", marginTop: 14, minHeight: 48 },
  pasteButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
});
