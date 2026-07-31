import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Device, DeviceStatus } from "../protocol/types";
import { DeviceHubClient } from "../protocol/client";

type Props = {
  client: DeviceHubClient;
  status: DeviceStatus;
  error: string | null;
  onError: (error: unknown) => void;
  onRefresh: () => Promise<void>;
  onSelect: (device: Device) => void;
  onDisconnect: () => void;
};

function phaseLabel(device: Device) {
  if (device.session_error) return device.session_error;
  if (device.session_phase === "connected") return "Connected";
  if (device.session_phase === "recovering") return "Recovering";
  if (device.session_phase === "connecting") return "Connecting";
  return device.session_status || "Not connected";
}

export function DeviceListScreen({ client, status, error, onError, onRefresh, onSelect, onDisconnect }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await client.refreshDevices();
      await onRefresh();
    } catch (refreshError) {
      onError(refreshError);
    } finally {
      setRefreshing(false);
    }
  };

  const connect = async (device: Device) => {
    setBusyId(device.id);
    try {
      await client.connectDevice(device.id);
      await onRefresh();
    } catch (connectError) {
      onError(connectError);
    } finally {
      setBusyId(null);
    }
  };

  const reconnect = async (device: Device) => {
    setBusyId(device.id);
    try {
      await client.reconnectDevice(device.id);
      await onRefresh();
    } catch (reconnectError) {
      onError(reconnectError);
    } finally {
      setBusyId(null);
    }
  };

  const pair = async (device: Device) => {
    setBusyId(device.id);
    try {
      await client.pairDevice(device.id);
      await onRefresh();
    } catch (pairError) {
      onError(pairError);
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (device: Device) => {
    setBusyId(device.id);
    try {
      await client.disconnectDevice(device.id);
      await onRefresh();
    } catch (disconnectError) {
      onError(disconnectError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>DEVICEHUB MOBILE</Text>
          <Text style={styles.title}>Choose an iPhone</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onDisconnect} style={styles.linkButton}>
          <Text style={styles.linkText}>Change server</Text>
        </Pressable>
      </View>
      <View style={styles.summary}>
        <View>
          <Text style={styles.summaryLabel}>Service</Text>
          <Text style={styles.summaryValue}>{client.connection.origin}</Text>
        </View>
        <View style={styles.summaryStatus}>
          <View style={styles.statusDot} />
          <Text style={styles.summaryValue}>{status.devices.length} device(s)</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={status.devices.length === 0 ? styles.emptyList : styles.list}
        data={status.devices}
        keyExtractor={(device) => device.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        renderItem={({ item }) => {
          const ready = item.session_phase === "connected" || item.session_phase === "recovering";
          const failed = item.session_phase === "failed";
          const trustRequired = item.connection === "USB" && item.pairing === "unpaired";
          const busy = busyId === item.id;
          return (
            <View style={styles.deviceCard}>
              <View style={styles.deviceIcon}><Text style={styles.deviceIconText}>i</Text></View>
              <View style={styles.deviceInfo}>
                <Text numberOfLines={1} style={styles.deviceName}>{item.name || "iPhone / iPad"}</Text>
                <Text numberOfLines={1} style={styles.deviceMeta}>{item.connection} · {item.udid}</Text>
                <Text style={[styles.devicePhase, ready && styles.devicePhaseReady]}>{phaseLabel(item)}</Text>
              </View>
              <View style={styles.deviceActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => ready ? onSelect(item) : void (trustRequired ? pair(item) : failed ? reconnect(item) : connect(item))}
                  style={({ pressed }) => [styles.deviceAction, pressed && styles.pressed, busy && styles.disabled]}
                >
                  {busy ? <ActivityIndicator color="#2368c4" /> : <Text style={styles.deviceActionText}>{ready ? "Open" : trustRequired ? "Trust" : failed ? "Retry" : "Connect"}</Text>}
                </Pressable>
                {ready ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void disconnect(item)}
                    style={({ pressed }) => [styles.deviceSecondaryAction, pressed && styles.pressed, busy && styles.disabled]}
                  >
                    <Text style={styles.deviceSecondaryText}>Disconnect</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No iPhone or iPad discovered</Text>
            <Text style={styles.emptyText}>Keep the device connected to the DeviceHub host, then pull to refresh.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#f4f6f8", flex: 1 },
  header: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 24 },
  kicker: { color: "#3973c5", fontSize: 11, fontWeight: "700", letterSpacing: 1.4, marginBottom: 7 },
  title: { color: "#152033", fontSize: 28, fontWeight: "800" },
  linkButton: { padding: 8 },
  linkText: { color: "#2368c4", fontSize: 14, fontWeight: "700" },
  summary: { alignItems: "center", backgroundColor: "#ffffff", borderBottomColor: "#e0e5eb", borderBottomWidth: 1, borderTopColor: "#e0e5eb", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 20, paddingHorizontal: 20, paddingVertical: 14 },
  summaryLabel: { color: "#778395", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  summaryValue: { color: "#3f4b5d", fontSize: 13, marginTop: 3 },
  summaryStatus: { alignItems: "center", flexDirection: "row", gap: 7 },
  statusDot: { backgroundColor: "#2b9a66", borderRadius: 5, height: 10, width: 10 },
  error: { color: "#bd2d3b", fontSize: 14, lineHeight: 20, paddingHorizontal: 20, paddingTop: 14 },
  list: { padding: 16 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  deviceCard: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#e0e5eb", borderRadius: 14, borderWidth: 1, flexDirection: "row", marginBottom: 12, padding: 14 },
  deviceIcon: { alignItems: "center", backgroundColor: "#e6f0ff", borderRadius: 22, height: 44, justifyContent: "center", marginRight: 12, width: 44 },
  deviceIconText: { color: "#2368c4", fontSize: 24, fontWeight: "800" },
  deviceInfo: { flex: 1, minWidth: 0 },
  deviceName: { color: "#152033", fontSize: 16, fontWeight: "700" },
  deviceMeta: { color: "#7a8594", fontSize: 11, marginTop: 3 },
  devicePhase: { color: "#bd7621", fontSize: 12, marginTop: 7 },
  devicePhaseReady: { color: "#2b9a66" },
  deviceActions: { alignItems: "stretch", gap: 6, marginLeft: 12 },
  deviceAction: { alignItems: "center", borderColor: "#b8cdea", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 38, minWidth: 72, paddingHorizontal: 12 },
  deviceActionText: { color: "#2368c4", fontSize: 14, fontWeight: "700" },
  deviceSecondaryAction: { alignItems: "center", justifyContent: "center", minHeight: 26, paddingHorizontal: 4 },
  deviceSecondaryText: { color: "#bd2d3b", fontSize: 11, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  empty: { alignItems: "center" },
  emptyTitle: { color: "#3f4b5d", fontSize: 17, fontWeight: "700", textAlign: "center" },
  emptyText: { color: "#778395", fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 320, textAlign: "center" },
});
