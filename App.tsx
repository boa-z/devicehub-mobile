import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { ControlScreen } from "./src/screens/ControlScreen";
import { DeviceListScreen } from "./src/screens/DeviceListScreen";
import { DeviceHubClient, DeviceHubHttpError, type DeviceHubSocket } from "./src/protocol/client";
import type { Device, DeviceStatus } from "./src/protocol/types";

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
      const nextClient = new DeviceHubClient(origin, token);
      const nextStatus = await nextClient.status();
      setClient(nextClient);
      setStatus(nextStatus);
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
        initialOrigin={DEFAULT_ORIGIN}
        initialToken=""
        onSubmit={(origin, token) => void connect(origin, token)}
      />
      <StatusBar style="dark" />
    </>
  );
}
