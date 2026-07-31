import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { ControlScreen } from "./src/screens/ControlScreen";
import { DeviceListScreen } from "./src/screens/DeviceListScreen";
import {
  DeviceHubClient,
  DeviceHubHttpError,
  parseConnectionInput,
  type DeviceHubSocket,
} from "./src/protocol/client";
import type { Device, DeviceStatus } from "./src/protocol/types";
import { clearSavedConnection, loadSavedConnection, saveConnection } from "./src/storage/credentials";

const DEFAULT_ORIGIN = "http://127.0.0.1:8080";

function errorMessage(error: unknown) {
  if (error instanceof DeviceHubHttpError) return `${error.message} (${error.status})`;
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [client, setClient] = useState<DeviceHubClient | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [socket, setSocket] = useState<DeviceHubSocket | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [screen, setScreen] = useState<"connection" | "devices" | "control">("connection");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialOrigin, setInitialOrigin] = useState(DEFAULT_ORIGIN);
  const [initialToken, setInitialToken] = useState("");

  useEffect(() => {
    void loadSavedConnection().then((saved) => {
      if (!saved) return;
      setInitialOrigin(saved.origin);
      setInitialToken(saved.token);
    });
  }, []);

  const loadStatus = async (activeClient = client) => {
    if (!activeClient) return;
    try {
      const next = await activeClient.status();
      setStatus(next);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
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
    void clearSavedConnection();
    setScreen("connection");
  };

  if (screen === "control" && socket && selectedDevice) {
    return (
      <>
        <ControlScreen socket={socket} device={selectedDevice} onBack={leaveControl} />
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

  return (
    <>
      <ConnectionScreen
        busy={busy}
        error={error}
        initialOrigin={initialOrigin}
        initialToken={initialToken}
        onSubmit={(origin, token) => void connect(origin, token)}
      />
      <StatusBar style="dark" />
    </>
  );
}
