import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nProvider, useI18n } from "./src/i18n";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { ControlScreen } from "./src/screens/ControlScreen";
import { DeviceListScreen } from "./src/screens/DeviceListScreen";
import {
  addDeviceHubDiscoveryErrorListener,
  addDeviceHubServiceListener,
  DeviceHubDiscovery,
  startDeviceHubDiscovery,
  stopDeviceHubDiscovery,
  type DeviceHubService,
} from "devicehub-discovery";
import {
  DeviceHubClient,
  DeviceHubHttpError,
  parseConnectionInput,
  type DeviceHubSocket,
} from "./src/protocol/client";
import type { Device, DeviceStatus } from "./src/protocol/types";
import { loadSavedConnection, saveConnection, type SavedConnection } from "./src/storage/credentials";

function errorMessage(error: unknown) {
  if (error instanceof DeviceHubHttpError) return `${error.message} (${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

function AppContent() {
  const { t } = useI18n();
  const [client, setClient] = useState<DeviceHubClient | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [socket, setSocket] = useState<DeviceHubSocket | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [screen, setScreen] = useState<"home" | "connection" | "devices" | "control" | "settings">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedConnection, setSavedConnection] = useState<SavedConnection | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [discoveredServices, setDiscoveredServices] = useState<DeviceHubService[]>([]);
  const [discoveryScanning, setDiscoveryScanning] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSavedConnection().then((saved) => {
      if (!active) return;
      setSavedConnection(saved);
      setStorageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (screen !== "connection") return;
    setDiscoveredServices([]);
    setDiscoveryScanning(Boolean(DeviceHubDiscovery));
    if (!DeviceHubDiscovery) return;

    const serviceSubscription = addDeviceHubServiceListener((event) => {
      setDiscoveredServices((current) => {
        if (event.event === "removed") {
          return current.filter((service) => service.id !== event.id);
        }
        if (!event.host || !event.port) return current;
        const next: DeviceHubService = {
          id: event.id,
          name: event.name,
          host: event.host,
          port: event.port,
          protocol: event.protocol ?? "",
          targets: event.targets ?? "",
          transport: event.transport ?? "",
        };
        return [...current.filter((service) => service.id !== next.id), next]
          .sort((left, right) => left.name.localeCompare(right.name));
      });
    });
    const errorSubscription = addDeviceHubDiscoveryErrorListener((event) => {
      setError(event.message);
      setDiscoveryScanning(false);
    });
    void startDeviceHubDiscovery()
      .then(() => setDiscoveryScanning(true))
      .catch((discoveryError) => {
        setError(errorMessage(discoveryError));
        setDiscoveryScanning(false);
      });
    return () => {
      serviceSubscription.remove();
      errorSubscription.remove();
      stopDeviceHubDiscovery();
      setDiscoveryScanning(false);
    };
  }, [screen]);

  const loadStatus = async (activeClient = client): Promise<DeviceStatus | null> => {
    if (!activeClient) return null;
    try {
      const next = await activeClient.status();
      setStatus(next);
      setError(null);
      return next;
    } catch (loadError) {
      setError(errorMessage(loadError));
      return null;
    }
  };

  const connect = async (origin: string, token: string) => {
    setBusy(true);
    setError(null);
    try {
      const connection = parseConnectionInput(origin, token);
      const nextClient = new DeviceHubClient(
        connection.origin,
        connection.token,
        Platform.OS === "android" ? "android" : "ios",
      );
      const nextStatus = await nextClient.status();
      setClient(nextClient);
      setStatus(nextStatus);
      setSavedConnection(nextClient.connection);
      try {
        await saveConnection(nextClient.connection);
      } catch {
        // A restricted keychain should not block an already verified connection.
      }
      setScreen("devices");
    } catch (connectError) {
      setError(errorMessage(connectError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!client || screen !== "devices") return;
    const timer = setInterval(() => void loadStatus(client), 2_000);
    return () => clearInterval(timer);
  }, [client, screen]);

  const openDevice = (device: Device) => {
    if (!client) return;
    const nextSocket = client.openDevice(device.id, {
      onOpen: () => setError(null),
      onError: (socketError) => setError(errorMessage(socketError)),
      onClose: () => setError("The DeviceHub connection closed."),
    });
    setSocket(nextSocket);
    setSelectedDevice(device);
    setError(null);
    setScreen("control");
  };

  const leaveControl = () => {
    socket?.close();
    setSocket(null);
    setSelectedDevice(null);
    setScreen("devices");
    void loadStatus();
  };

  const disconnect = () => {
    socket?.close();
    setSocket(null);
    setSelectedDevice(null);
    setClient(null);
    setStatus(null);
    setError(null);
    setScreen("home");
  };

  const refreshDiscovery = () => {
    if (!DeviceHubDiscovery) return;
    stopDeviceHubDiscovery();
    setDiscoveredServices([]);
    setDiscoveryScanning(true);
    void startDeviceHubDiscovery().catch((discoveryError) => {
      setError(errorMessage(discoveryError));
      setDiscoveryScanning(false);
    });
  };

  if (!storageReady) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color="#2368c4" />
        <Text style={styles.loadingText}>{t("connecting")}</Text>
      </View>
    );
  }

  if (screen === "control" && client && socket && selectedDevice) {
    return (
      <>
        <ControlScreen client={client} socket={socket} device={selectedDevice} onBack={leaveControl} orientation={status?.orientation ?? "portrait"} />
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "devices" && client && status) {
    return (
      <>
        <DeviceListScreen
          client={client}
          error={error}
          onError={(deviceError) => setError(errorMessage(deviceError))}
          onDisconnect={disconnect}
          onRefresh={() => loadStatus(client)}
          onSelect={openDevice}
          status={status}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (screen === "settings") {
    return (
      <>
        <SettingsScreen
          onBack={() => setScreen("home")}
          onCleared={() => setSavedConnection(null)}
          onSaved={setSavedConnection}
          savedConnection={savedConnection}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (screen === "connection") {
    return (
      <>
        <ConnectionScreen
          busy={busy}
          error={error}
          initialOrigin={savedConnection?.origin ?? ""}
          initialToken={savedConnection?.token ?? ""}
          onBack={() => {
            setError(null);
            setScreen("home");
          }}
          onRefreshDiscovery={refreshDiscovery}
          onSelectService={() => {
            setError(null);
          }}
          onSubmit={connect}
          scanning={discoveryScanning}
          services={discoveredServices}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <>
      <HomeScreen
        connectedOrigin={client?.connection.origin ?? null}
        deviceCount={status?.devices.length ?? null}
        onConnect={() => {
          setError(null);
          setScreen("connection");
        }}
        onOpenDevices={() => setScreen("devices")}
        onSettings={() => {
          setError(null);
          setScreen("settings");
        }}
        savedConnection={savedConnection}
      />
      <StatusBar style="dark" />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingRoot: { alignItems: "center", backgroundColor: "#f4f6f8", flex: 1, justifyContent: "center" },
  loadingText: { color: "#778395", fontSize: 13, marginTop: 12 },
});
