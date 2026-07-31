import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import type {
  AppConsoleLine,
  AppConsoleSnapshot,
  ClipboardEvent,
  Device,
  DeviceApp,
  DeviceDetails,
  DeviceEvent,
  CompanionDevice,
  HomeScreenLayout,
  LocationStatus,
  MultiTouchContact,
  StreamMetrics,
} from "../protocol/types";
import { DeviceHubMedia, DeviceHubVideoView } from "devicehub-media";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n";
import { DeviceFilesScreen } from "./DeviceFilesScreen";

const NativeVideoView = DeviceHubVideoView as any;

type Props = {
  client: DeviceHubClient;
  socket: DeviceHubSocket;
  device: Device;
  onBack: () => void;
};

const HARDWARE_BUTTONS = ["home", "lock", "volume-up", "volume-down", "mute"] as const;

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GB`;
}

function formatOptional(value: unknown) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
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
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [connected, setConnected] = useState(socket.serverHello !== null);
  const [controlGranted, setControlGranted] = useState(socket.controlGranted);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [surface, setSurface] = useState({ width: 1, height: 1 });
  const [videoInfo, setVideoInfo] = useState(() => t("waitingVideoFrames"));
  const [audioInfo, setAudioInfo] = useState(() => t("audioOff"));
  const [streamMetrics, setStreamMetrics] = useState<StreamMetrics | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [apps, setApps] = useState<DeviceApp[]>([]);
  const [appsBusy, setAppsBusy] = useState(false);
  const [appAction, setAppAction] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [appIconErrors, setAppIconErrors] = useState<Record<string, boolean>>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationStatus | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [companions, setCompanions] = useState<CompanionDevice[]>([]);
  const [homeScreen, setHomeScreen] = useState<HomeScreenLayout | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [screenshotSource, setScreenshotSource] = useState<ReturnType<DeviceHubClient["deviceScreenshotSource"]> | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [consoleBundleId, setConsoleBundleId] = useState<string | null>(null);
  const [consoleSnapshot, setConsoleSnapshot] = useState<AppConsoleSnapshot | null>(null);
  const [consoleLines, setConsoleLines] = useState<AppConsoleLine[]>([]);
  const consoleCursor = useRef<number | undefined>(undefined);
  const consoleBundleRef = useRef<string | null>(null);
  const appIconSources = useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, client.appIconSource(device.id, app.bundle_id)])),
    [apps, client, device.id],
  );
  const nativeVideoRef = useRef<unknown>(null);
  const touchIdentities = useRef(new TouchIdentityAllocator());
  const appState = useRef(AppState.currentState);
  const lastVideoInfoAt = useRef(0);
  const lastAudioInfoAt = useRef(0);
  const lastMetricsAt = useRef(0);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);

  const loadApps = useCallback(async () => {
    setAppsBusy(true);
    setAppsError(null);
    try {
      setApps(await client.listApps(device.id));
    } catch (error) {
      setAppsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppsBusy(false);
    }
  }, [client, device.id]);

  const showActivity = (message: string) => {
    setActivityMessage(message);
    if (activityTimer.current) clearTimeout(activityTimer.current);
    activityTimer.current = setTimeout(() => {
      activityTimer.current = null;
      setActivityMessage(null);
    }, 6_000);
  };

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
      lastMetricsAt.current = 0;
      setStreamMetrics(null);
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
      setStreamMetrics(null);
      scheduleReconnect();
    };
    const onError = (error: unknown) => {
      if (disposed) return;
      setConnectionError(error instanceof Error ? error.message : String(error));
    };
    const onLease = (granted: boolean) => setControlGranted(granted);
    const onClipboard = (event: ClipboardEvent) => {
      const direction = event.from_device ? "Device" : "Host";
      const preview = event.preview ? ` · ${event.preview}` : "";
      showActivity(`${direction} clipboard ${event.kind}${preview}`);
    };
    const onDeviceEvent = (event: DeviceEvent) => {
      const label = event.kind.replace(/_/g, " ");
      showActivity(`Device event: ${label}`);
      if (event.kind === "app_installed" || event.kind === "app_uninstalled") {
        void loadApps();
      }
    };
    const onStreamMetrics = (metrics: StreamMetrics) => {
      const now = Date.now();
      if (now - lastMetricsAt.current < 1_000 && lastMetricsAt.current !== 0) return;
      lastMetricsAt.current = now;
      setStreamMetrics(metrics);
    };
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
      onClipboard,
      onDeviceEvent,
      onStreamMetrics,
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
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = null;
      setActivityMessage(null);
      unsubscribe();
      socket.send({ type: "video_demand", active: false });
      socket.send({ type: "audio_demand", active: false });
      resetNativeMedia();
      const activeConsoleBundle = consoleBundleRef.current;
      if (activeConsoleBundle) {
        void client.stopAppConsole(device.id).catch(() => undefined);
        consoleBundleRef.current = null;
      }
      socket.close();
    };
  }, [loadApps, socket]);

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

  const openApps = () => {
    setAppIconErrors({});
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

  const mergeConsoleSnapshot = (next: AppConsoleSnapshot) => {
    setConsoleSnapshot(next);
    setConsoleLines((current) => {
      if (next.reset || consoleCursor.current === undefined) return next.lines;
      const merged = [...current, ...next.lines];
      return merged.length > 1_000 ? merged.slice(-1_000) : merged;
    });
    consoleCursor.current = Math.max(0, next.next_sequence - 1);
  };

  const openConsole = async (app: DeviceApp) => {
    if (consoleBusy || !connected) return;
    setConsoleOpen(true);
    setConsoleBundleId(app.bundle_id);
    consoleBundleRef.current = app.bundle_id;
    setConsoleBusy(true);
    setConsoleError(null);
    setConsoleSnapshot(null);
    setConsoleLines([]);
    consoleCursor.current = undefined;
    try {
      mergeConsoleSnapshot(await client.startAppConsole(device.id, app.bundle_id));
    } catch (error) {
      setConsoleError(error instanceof Error ? error.message : String(error));
    } finally {
      setConsoleBusy(false);
    }
  };

  const closeConsole = () => {
    setConsoleOpen(false);
    const activeBundleId = consoleBundleRef.current;
    if (!activeBundleId) return;
    void client.stopAppConsole(device.id).catch(() => undefined);
    consoleBundleRef.current = null;
    setConsoleBundleId(null);
  };

  useEffect(() => {
    if (!consoleOpen || !consoleBundleId || consoleBusy) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await client.appConsoleSnapshot(device.id, consoleCursor.current);
        if (!cancelled) mergeConsoleSnapshot(next);
      } catch (error) {
        if (!cancelled) setConsoleError(error instanceof Error ? error.message : String(error));
      }
    };
    const timer = setInterval(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, consoleBundleId, consoleBusy, consoleOpen, device.id]);

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

  const confirmPowerAction = (action: "restart" | "shutdown") => {
    if (!connected || !controlGranted) return;
    const isShutdown = action === "shutdown";
    Alert.alert(
      isShutdown ? t("shutDownDevice") : t("restartDevice"),
      isShutdown
        ? t("shutDownWarning")
        : t("restartWarning"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: isShutdown ? t("shutDown") : t("restart"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (isShutdown) {
                  await client.shutdownDevice(device.id);
                } else {
                  await client.restartDevice(device.id);
                }
              } catch (error) {
                Alert.alert(t("deviceActionFailed"), error instanceof Error ? error.message : String(error));
              }
            })();
          },
        },
      ],
    );
  };

  const openLocation = () => {
    setLocationError(null);
    setLocationOpen(true);
    void (async () => {
      try {
        const next = await client.location(device.id);
        setLocationStatus(next);
        setLatitude(next.latitude === null ? "" : String(next.latitude));
        setLongitude(next.longitude === null ? "" : String(next.longitude));
      } catch (error) {
        setLocationError(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const applyLocation = async () => {
    if (!latitude.trim() || !longitude.trim()) {
      setLocationError("Enter both latitude and longitude.");
      return;
    }
    const nextLatitude = Number(latitude);
    const nextLongitude = Number(longitude);
    if (!Number.isFinite(nextLatitude) || nextLatitude < -90 || nextLatitude > 90) {
      setLocationError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(nextLongitude) || nextLongitude < -180 || nextLongitude > 180) {
      setLocationError("Longitude must be between -180 and 180.");
      return;
    }
    setLocationBusy(true);
    setLocationError(null);
    try {
      await client.setLocation(device.id, nextLatitude, nextLongitude);
      setLocationStatus(await client.location(device.id));
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : String(error));
    } finally {
      setLocationBusy(false);
    }
  };

  const clearLocation = async () => {
    setLocationBusy(true);
    setLocationError(null);
    try {
      await client.clearLocation(device.id);
      setLocationStatus(await client.location(device.id));
      setLatitude("");
      setLongitude("");
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : String(error));
    } finally {
      setLocationBusy(false);
    }
  };

  const loadDetails = async () => {
    setDetailsBusy(true);
    setDetailsError(null);
    try {
      setDetails(await client.deviceDetails(device.id));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailsBusy(false);
    }
  };

  const openDetails = () => {
    setDetailsOpen(true);
    setCompanions([]);
    setHomeScreen(null);
    void loadDetails();
    void Promise.allSettled([
      client.deviceCompanions(device.id),
      client.homeScreenLayout(device.id),
    ]).then(([companionsResult, homeScreenResult]) => {
      if (companionsResult.status === "fulfilled") setCompanions(companionsResult.value);
      if (homeScreenResult.status === "fulfilled") setHomeScreen(homeScreenResult.value);
    });
  };

  const openScreenshot = () => {
    setScreenshotError(null);
    setScreenshotBusy(true);
    setScreenshotSource(client.deviceScreenshotSource(device.id));
    setScreenshotOpen(true);
  };

  const openRename = () => {
    setRenameValue(details?.name || device.name || "");
    setRenameError(null);
    setRenameOpen(true);
  };

  const rename = async () => {
    const name = renameValue.trim();
    if (!name) {
      setRenameError(t("nameRequired"));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await client.renameDevice(device.id, name);
      setDetails((current) => current ? { ...current, name: result.name } : current);
      setRenameOpen(false);
      showActivity(`${t("rename")}: ${result.name}`);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: 12 + insets.top }]}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹ {t("devicesBack")}</Text>
        </Pressable>
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} style={styles.title}>{device.name || "iPhone / iPad"}</Text>
          <Text style={[styles.subtitle, connected ? styles.connected : styles.disconnected]}>
            {connected ? (controlGranted ? t("controlGranted") : t("viewOnly")) : t("disconnected")}
          </Text>
        </View>
        <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{device.connection}</Text></View>
      </View>
      {!connected || connectionError ? (
        <View style={styles.connectionBanner}>
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionTitle}>{connected ? t("connectionWarning") : t("connectingToDevice")}</Text>
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
              <Text style={styles.retryText}>{t("retryConnection")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {activityMessage ? (
        <View style={styles.activityBanner}>
          <Text numberOfLines={2} style={styles.activityText}>{activityMessage}</Text>
        </View>
      ) : null}
      <View style={styles.content}>
        <View style={styles.videoFrame} onLayout={onSurfaceLayout}>
          <View
            accessibilityLabel={t("iPhoneTouchSurface")}
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
                <Text style={styles.videoTitle}>{t("iPhoneScreen")}</Text>
                <Text style={styles.videoDescription}>{t("nativeVideoHint")}</Text>
              </>
            )}
            <Text style={styles.videoTelemetry}>{videoInfo}</Text>
            <Text style={styles.videoTelemetry}>{audioInfo}</Text>
          </View>
        </View>
        <View style={styles.streamPanel}>
          <Text numberOfLines={1} style={styles.streamText}>
            {streamMetrics
              ? `Stream ${streamMetrics.source_fps.toFixed(1)} -> ${streamMetrics.decoded_fps.toFixed(1)} -> ${streamMetrics.sent_fps.toFixed(1)} fps · ${streamMetrics.megabits_per_second.toFixed(1)} Mbps`
              : t("streamMetricsPending")}
          </Text>
        </View>
        <View style={styles.toolbar}>
          {HARDWARE_BUTTONS.map((name) => (
            <Pressable
              accessibilityRole="button"
              disabled={!controlGranted}
              key={name}
              onPress={() => socket.send({ type: "button", name })}
              style={({ pressed }) => [styles.hardwareButton, pressed && styles.buttonPressed, !controlGranted && styles.disabled]}
            >
              <Text style={styles.hardwareText}>{name === "home" ? t("homeButton") : name === "lock" ? t("lockButton") : name === "volume-up" ? t("volumeUp") : name === "volume-down" ? t("volumeDown") : t("muteButton")}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.secondaryToolbar}>
          <Pressable accessibilityRole="button" disabled={!connected} onPress={openApps} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("apps")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!connected} onPress={() => setFilesOpen(true)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("files")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "left" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("rotateLeft")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => socket.send({ type: "rotate", direction: "right" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("rotateRight")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={openPaste} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("pasteText")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => confirmPowerAction("restart")} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("restart")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={() => confirmPowerAction("shutdown")} style={styles.secondaryButton}>
            <Text style={styles.secondaryDangerText}>{t("shutDown")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!controlGranted} onPress={openLocation} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("location")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!connected} onPress={openDetails} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("deviceInfo")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!connected} onPress={openScreenshot} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("screenshot")}</Text>
          </Pressable>
        </View>
      </View>
      <Modal animationType="slide" onRequestClose={() => setAppsOpen(false)} visible={appsOpen}>
        <View style={[styles.appsModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
          <View style={styles.appsHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("apps")}</Text>
              <Text style={styles.appsSubtitle}>{t("launchOrStopApp")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setAppsOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("close")}</Text>
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
                    {appIconErrors[item.bundle_id] ? (
                      <View style={styles.appIconFallback}><Text style={styles.appIconFallbackText}>{(item.name || item.bundle_id).slice(0, 1).toUpperCase()}</Text></View>
                    ) : (
                      <Image
                        accessibilityLabel={`${item.name || item.bundle_id} icon`}
                        onError={() => setAppIconErrors((current) => ({ ...current, [item.bundle_id]: true }))}
                        source={appIconSources.get(item.bundle_id)}
                        style={styles.appIcon}
                      />
                    )}
                    <View style={styles.appCopy}>
                      <Text numberOfLines={1} style={styles.appName}>{item.name || item.bundle_id}</Text>
                      <Text numberOfLines={1} style={styles.appBundle}>{item.bundle_id}</Text>
                      <Text style={[styles.appState, item.is_running && styles.appRunning]}>
                        {item.is_running ? t("running") : t("stopped")}
                      </Text>
                    </View>
                    <View style={styles.appActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void toggleApp(item)}
                        style={({ pressed }) => [styles.appAction, pressed && styles.buttonPressed, busy && styles.disabled]}
                      >
                        {busy ? <ActivityIndicator color="#2368c4" /> : <Text style={styles.appActionText}>{item.is_running ? t("stopped") : t("launch")}</Text>}
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={appsBusy || consoleBusy}
                        onPress={() => void openConsole(item)}
                        style={({ pressed }) => [styles.appConsoleAction, pressed && styles.buttonPressed, (appsBusy || consoleBusy) && styles.disabled]}
                      >
                        <Text style={styles.appConsoleText}>{t("appConsole")}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.appsEmpty}>{t("noUserApps")}</Text>}
            />
          )}
        </View>
      </Modal>
      <Modal animationType="slide" onRequestClose={closeConsole} visible={consoleOpen}>
        <View style={[styles.consoleModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("appConsoleTitle")}</Text>
              <Text numberOfLines={1} style={styles.appsSubtitle}>{consoleBundleId ?? t("application")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={closeConsole} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("close")}</Text>
            </Pressable>
          </View>
          {consoleError ? <Text style={styles.appsError}>{consoleError}</Text> : null}
          {consoleBusy ? (
            <View style={styles.appsLoading}><ActivityIndicator color="#2368c4" /></View>
          ) : (
            <ScrollView contentContainerStyle={styles.consoleBody}>
              <Text style={styles.consoleStatus}>{consoleSnapshot?.phase ?? "stopped"} · {consoleSnapshot?.total_lines ?? 0} lines</Text>
              {consoleLines.length === 0 ? (
                <Text style={styles.appsEmpty}>{t("noConsoleOutput")}</Text>
              ) : (
                <View style={styles.consoleLines}>
                  {consoleLines.map((line) => <Text key={line.sequence} selectable style={styles.consoleLine}>{line.text}</Text>)}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setPasteOpen(false)} visible={pasteOpen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.pasteModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}
        >
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("pasteTitle")}</Text>
              <Text style={styles.appsSubtitle}>{t("pasteSubtitle")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setPasteOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("cancel")}</Text>
            </Pressable>
          </View>
          <View style={styles.pasteBody}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              maxLength={1024}
              onChangeText={setPasteText}
              placeholder={t("textToPaste")}
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
              {pasteBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.pasteButtonText}>{t("sendToDevice")}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setLocationOpen(false)} visible={locationOpen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.pasteModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}
        >
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("locationTitle")}</Text>
              <Text style={styles.appsSubtitle}>{t("locationSubtitle")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setLocationOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("close")}</Text>
            </Pressable>
          </View>
          <View style={styles.pasteBody}>
            <Text style={styles.locationStatusText}>
              {locationStatus?.active
                ? `Active · ${locationStatus.backend ?? "unknown backend"}`
                : locationStatus?.available
                  ? t("ready")
                  : t("unavailable")}
            </Text>
            {locationStatus?.error ? <Text style={styles.appsError}>{locationStatus.error}</Text> : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              onChangeText={setLatitude}
              placeholder={t("latitudePlaceholder")}
              placeholderTextColor="#8c96a5"
              style={styles.locationInput}
              value={latitude}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              onChangeText={setLongitude}
              placeholder={t("longitudePlaceholder")}
              placeholderTextColor="#8c96a5"
              style={styles.locationInput}
              value={longitude}
            />
            {locationError ? <Text style={styles.appsError}>{locationError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={locationBusy}
              onPress={() => void applyLocation()}
              style={({ pressed }) => [styles.pasteButton, pressed && styles.buttonPressed, locationBusy && styles.disabled]}
            >
              {locationBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.pasteButtonText}>{t("applyLocation")}</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={locationBusy || !locationStatus?.active}
              onPress={() => void clearLocation()}
              style={({ pressed }) => [styles.locationClearButton, pressed && styles.buttonPressed, (locationBusy || !locationStatus?.active) && styles.disabled]}
            >
              <Text style={styles.locationClearText}>{t("clearSimulation")}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setDetailsOpen(false)} visible={detailsOpen}>
        <View style={[styles.pasteModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("deviceInformation")}</Text>
              <Text style={styles.appsSubtitle}>{device.name || "iPhone / iPad"}</Text>
            </View>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={openRename} style={styles.closeButton}>
                <Text style={styles.closeText}>{t("rename")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setDetailsOpen(false)} style={styles.closeButton}>
                <Text style={styles.closeText}>{t("close")}</Text>
              </Pressable>
            </View>
          </View>
          {detailsBusy && !details ? (
            <View style={styles.appsLoading}><ActivityIndicator color="#2368c4" /></View>
          ) : detailsError ? (
            <View style={styles.detailErrorBlock}>
              <Text style={styles.appsError}>{detailsError}</Text>
              <Pressable accessibilityRole="button" onPress={() => void loadDetails()} style={styles.detailRetryButton}>
                <Text style={styles.secondaryText}>{t("retry")}</Text>
              </Pressable>
            </View>
          ) : details ? (
            <ScrollView contentContainerStyle={styles.detailsList}>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("identity")}</Text>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("model")}</Text><Text style={styles.detailValue}>{formatOptional(details.product_type)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("system")}</Text><Text style={styles.detailValue}>{formatOptional(details.product_version)}{details.build_version ? ` (${details.build_version})` : ""}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("modelNumber")}</Text><Text style={styles.detailValue}>{formatOptional(details.model_number)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("serial")}</Text><Text style={styles.detailValue}>{formatOptional(details.serial_number)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("udid")}</Text><Text selectable style={styles.detailValue}>{formatOptional(details.udid)}</Text></View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("storage")}</Text>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("dataAvailable")}</Text><Text style={styles.detailValue}>{formatBytes(details.storage?.data_available_bytes)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("dataCapacity")}</Text><Text style={styles.detailValue}>{formatBytes(details.storage?.data_capacity_bytes)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("systemAvailable")}</Text><Text style={styles.detailValue}>{formatBytes(details.storage?.system_available_bytes)}</Text></View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("battery")}</Text>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("level")}</Text><Text style={styles.detailValue}>{details.battery?.level_percent == null ? "-" : `${details.battery.level_percent}%`}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("temperature")}</Text><Text style={styles.detailValue}>{details.battery?.temperature_celsius == null ? "-" : `${details.battery.temperature_celsius.toFixed(1)} °C`}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("charging")}</Text><Text style={styles.detailValue}>{details.battery?.is_charging == null ? "-" : details.battery.is_charging ? t("yes") : t("no")}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("health")}</Text><Text style={styles.detailValue}>{details.battery?.health_percent == null ? "-" : `${details.battery.health_percent.toFixed(1)}%`}</Text></View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("regionalSettings")}</Text>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("languageSection")}</Text><Text style={styles.detailValue}>{formatOptional(details.regional_settings?.language)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("locale")}</Text><Text style={styles.detailValue}>{formatOptional(details.regional_settings?.locale)}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("timeZone")}</Text><Text style={styles.detailValue}>{formatOptional(details.regional_settings?.time_zone)}</Text></View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("homeScreenLayout")}</Text>
                {homeScreen ? (
                  <>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("pages")}</Text><Text style={styles.detailValue}>{homeScreen.page_count}</Text></View>
                    <View style={styles.detailRow}><Text style={styles.detailLabel}>{t("appLocations")}</Text><Text style={styles.detailValue}>{homeScreen.apps.length}</Text></View>
                    {homeScreen.truncated ? <Text style={styles.detailHint}>{t("truncated")}</Text> : null}
                  </>
                ) : <Text style={styles.detailHint}>{t("noUserApps")}</Text>}
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>{t("companions")}</Text>
                {companions.length === 0 ? <Text style={styles.detailHint}>{t("noCompanions")}</Text> : companions.map((companion) => (
                  <View key={companion.identifier} style={styles.companionRow}>
                    <Text numberOfLines={1} style={styles.companionName}>{companion.name || companion.identifier}</Text>
                    <Text numberOfLines={1} style={styles.companionMeta}>{[companion.product_type, companion.product_version].filter(Boolean).join(" · ") || companion.identifier}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setRenameOpen(false)} visible={renameOpen}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.pasteModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("renameDeviceTitle")}</Text>
              <Text style={styles.appsSubtitle}>{t("renameHint")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setRenameOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("cancel")}</Text>
            </Pressable>
          </View>
          <View style={styles.pasteBody}>
            <Text style={styles.label}>{t("deviceName")}</Text>
            <TextInput
              autoCorrect={false}
              onChangeText={setRenameValue}
              placeholder={t("deviceName")}
              placeholderTextColor="#8c96a5"
              style={styles.pasteInputSingleLine}
              value={renameValue}
            />
            {renameError ? <Text style={styles.appsError}>{renameError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={renameBusy}
              onPress={() => void rename()}
              style={({ pressed }) => [styles.pasteButton, pressed && styles.buttonPressed, renameBusy && styles.disabled]}
            >
              {renameBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.pasteButtonText}>{t("renameAction")}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => setScreenshotOpen(false)} visible={screenshotOpen}>
        <View style={[styles.pasteModal, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
          <View style={styles.pasteHeader}>
            <View style={styles.appsHeaderCopy}>
              <Text style={styles.appsTitle}>{t("screenshotTitle")}</Text>
              <Text style={styles.appsSubtitle}>{t("screenshotHint")}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setScreenshotOpen(false)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t("close")}</Text>
            </Pressable>
          </View>
          <View style={styles.screenshotBody}>
            {screenshotSource && !screenshotError ? (
              <Image
                accessibilityLabel={t("screenshotTitle")}
                onError={() => {
                  setScreenshotBusy(false);
                  setScreenshotError(t("screenshotFailed"));
                }}
                onLoad={() => setScreenshotBusy(false)}
                resizeMode="contain"
                source={screenshotSource}
                style={styles.screenshotImage}
              />
            ) : null}
            {screenshotBusy ? <View style={styles.screenshotLoading}><ActivityIndicator color="#2368c4" /><Text style={styles.screenshotLoadingText}>{t("screenshotLoading")}</Text></View> : null}
            {screenshotError ? <Text style={styles.appsError}>{screenshotError}</Text> : null}
          </View>
        </View>
      </Modal>
      <DeviceFilesScreen
        client={client}
        device={device}
        onClose={() => setFilesOpen(false)}
        visible={filesOpen}
      />
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
  activityBanner: { backgroundColor: "#1b2c3e", borderBottomColor: "#314b64", borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  activityText: { color: "#c5d9ed", fontSize: 12, lineHeight: 17 },
  content: { flex: 1, padding: 16 },
  videoFrame: { alignSelf: "center", backgroundColor: "#080d12", borderColor: "#2b3a4b", borderRadius: 16, borderWidth: 1, flex: 1, maxHeight: 720, maxWidth: 520, overflow: "hidden", width: "100%" },
  touchSurface: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  nativeVideo: StyleSheet.absoluteFill,
  videoTitle: { color: "#f1f5fa", fontSize: 20, fontWeight: "700" },
  videoDescription: { color: "#8796a8", fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 280, textAlign: "center" },
  videoTelemetry: { color: "#6f8195", fontSize: 11, marginTop: 12 },
  streamPanel: { alignItems: "center", minHeight: 26, justifyContent: "center", paddingTop: 6 },
  streamText: { color: "#70849a", fontSize: 11 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingTop: 14 },
  hardwareButton: { alignItems: "center", backgroundColor: "#263548", borderColor: "#3b5068", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 42, minWidth: 68, paddingHorizontal: 10 },
  hardwareText: { color: "#e1e9f2", fontSize: 12, fontWeight: "700" },
  buttonPressed: { backgroundColor: "#385576" },
  secondaryToolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingTop: 10 },
  secondaryButton: { paddingHorizontal: 10, paddingVertical: 8 },
  secondaryText: { color: "#8fc1ff", fontSize: 12, fontWeight: "600" },
  secondaryDangerText: { color: "#f0a36a", fontSize: 12, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  appsModal: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  appsHeader: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 14 },
  appsHeaderCopy: { flex: 1, minWidth: 0 },
  appsTitle: { color: "#152033", fontSize: 24, fontWeight: "800" },
  appsSubtitle: { color: "#778395", fontSize: 13, marginTop: 3 },
  modalActions: { alignItems: "center", flexDirection: "row" },
  closeButton: { paddingHorizontal: 8, paddingVertical: 8 },
  closeText: { color: "#2368c4", fontSize: 14, fontWeight: "700" },
  appsError: { color: "#bd2d3b", fontSize: 13, lineHeight: 19, paddingHorizontal: 18, paddingTop: 14 },
  appsLoading: { alignItems: "center", flex: 1, justifyContent: "center" },
  appsList: { padding: 14 },
  appsEmptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  appRow: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 12, borderWidth: 1, flexDirection: "row", marginBottom: 10, padding: 13 },
  appIcon: { backgroundColor: "#eef2f5", borderRadius: 10, height: 44, marginRight: 12, width: 44 },
  appIconFallback: { alignItems: "center", backgroundColor: "#e6f0ff", borderRadius: 10, height: 44, justifyContent: "center", marginRight: 12, width: 44 },
  appIconFallbackText: { color: "#2368c4", fontSize: 19, fontWeight: "800" },
  appCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  appName: { color: "#152033", fontSize: 15, fontWeight: "700" },
  appBundle: { color: "#778395", fontSize: 11, marginTop: 3 },
  appState: { color: "#bd7621", fontSize: 12, marginTop: 5 },
  appRunning: { color: "#2b9a66" },
  appAction: { alignItems: "center", borderColor: "#b8cdea", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 38, minWidth: 72, paddingHorizontal: 10 },
  appActionText: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  appActions: { alignItems: "stretch", gap: 5 },
  appConsoleAction: { alignItems: "center", justifyContent: "center", minHeight: 26, paddingHorizontal: 5 },
  appConsoleText: { color: "#778395", fontSize: 11, fontWeight: "600" },
  appsEmpty: { color: "#778395", fontSize: 14, lineHeight: 21, textAlign: "center" },
  pasteModal: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  pasteHeader: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: 14, paddingHorizontal: 18 },
  pasteBody: { padding: 18 },
  label: { color: "#425064", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  pasteInputSingleLine: { backgroundColor: "#ffffff", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, padding: 14 },
  screenshotBody: { alignItems: "center", flex: 1, justifyContent: "center", padding: 18 },
  screenshotImage: { height: "100%", maxWidth: "100%", width: "100%" },
  screenshotLoading: { alignItems: "center", backgroundColor: "rgba(244,246,248,0.9)", justifyContent: "center", padding: 16, position: "absolute" },
  screenshotLoadingText: { color: "#536273", fontSize: 13, marginTop: 10 },
  pasteInput: { backgroundColor: "#ffffff", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, minHeight: 180, padding: 14 },
  pasteButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 10, justifyContent: "center", marginTop: 14, minHeight: 48 },
  pasteButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  locationStatusText: { color: "#3f4b5d", fontSize: 13, fontWeight: "700", marginBottom: 14 },
  locationInput: { backgroundColor: "#ffffff", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, marginBottom: 12, padding: 14 },
  locationClearButton: { alignItems: "center", justifyContent: "center", marginTop: 8, minHeight: 42 },
  locationClearText: { color: "#bd2d3b", fontSize: 14, fontWeight: "700" },
  detailsList: { padding: 18 },
  detailSection: { backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 12, borderWidth: 1, marginBottom: 12, padding: 14 },
  detailSectionTitle: { color: "#152033", fontSize: 15, fontWeight: "800", marginBottom: 8 },
  detailRow: { alignItems: "flex-start", borderTopColor: "#eef1f4", borderTopWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 9 },
  detailLabel: { color: "#778395", fontSize: 12, width: 112 },
  detailValue: { color: "#3f4b5d", flex: 1, fontSize: 13, textAlign: "right" },
  detailHint: { color: "#778395", fontSize: 12, lineHeight: 18 },
  companionRow: { borderTopColor: "#eef1f4", borderTopWidth: 1, paddingVertical: 8 },
  companionName: { color: "#3f4b5d", fontSize: 13, fontWeight: "700" },
  companionMeta: { color: "#778395", fontSize: 11, marginTop: 3 },
  detailErrorBlock: { padding: 18 },
  detailRetryButton: { alignSelf: "flex-start", borderColor: "#b8cdea", borderRadius: 9, borderWidth: 1, marginTop: 12, paddingHorizontal: 14, paddingVertical: 9 },
  consoleModal: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  consoleBody: { flexGrow: 1, padding: 14 },
  consoleStatus: { color: "#536273", fontSize: 12, marginBottom: 10 },
  consoleLines: { backgroundColor: "#080d12", borderColor: "#273542", borderRadius: 8, borderWidth: 1, padding: 10 },
  consoleLine: { color: "#d5e1ec", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, lineHeight: 17 },
});
