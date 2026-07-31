import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n";
import { DeviceHubClient } from "../protocol/client";
import type {
  DeviceLogEntry,
  DeviceLogBatch,
  DevicePerformanceView,
  RunningProcess,
  RunningProcessList,
  ServiceHealth,
} from "../protocol/types";

type Props = {
  client: DeviceHubClient;
  device: { id: string; name: string; udid: string };
  visible: boolean;
  onClose: () => void;
};

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const absolute = Math.abs(value);
  if (absolute < 1_024) return `${value.toFixed(0)} B`;
  if (absolute < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KB`;
  if (absolute < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GB`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${formatBytes(value)}/s`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatFps(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)} FPS`;
}

function formatProcessName(process: RunningProcess) {
  return process.app_name ? `${process.app_name} · ${process.name}` : process.name;
}

function logLabel(entry: DeviceLogEntry) {
  const metadata = [entry.level, entry.process, entry.subsystem].filter(Boolean).join(" · ");
  return metadata ? `${metadata}\n${entry.message}` : entry.message;
}

function serviceTone(service: ServiceHealth) {
  if (service.phase === "ready") return styles.serviceReady;
  if (service.phase === "recovering" || service.phase === "connecting") return styles.serviceRecovering;
  return styles.serviceUnavailable;
}

export function PerformanceScreen({ client, device, visible, onClose }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [performance, setPerformance] = useState<DevicePerformanceView | null>(null);
  const [processes, setProcesses] = useState<RunningProcessList | null>(null);
  const [logs, setLogs] = useState<DeviceLogEntry[]>([]);
  const [logBatch, setLogBatch] = useState<DeviceLogBatch | null>(null);
  const [sampling, setSampling] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"sampling" | "logs" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logCursor = useRef<number | undefined>(undefined);
  const samplingOwned = useRef(false);
  const logsOwned = useRef(false);
  const logsStreamingRef = useRef(false);
  const performanceRequest = useRef(false);
  const logRequest = useRef(false);

  const loadPerformance = useCallback(async (includeProcesses: boolean) => {
    if (performanceRequest.current) return;
    performanceRequest.current = true;
    try {
      const next = await client.performance(device.id);
      setPerformance(next);
      setSampling(next.sampling);
      if (includeProcesses || next.sampling) {
        setProcesses(await client.runningProcesses(device.id));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      performanceRequest.current = false;
    }
  }, [client, device.id]);

  const loadLogs = useCallback(async (reset = false) => {
    if (logRequest.current) return;
    logRequest.current = true;
    try {
      const batch = await client.deviceLogs(device.id, reset ? undefined : logCursor.current, 100);
      setLogBatch(batch);
      setLogs((current) => {
        if (reset || batch.cursor_lagged || logCursor.current === undefined) return batch.entries;
        const merged = [...current, ...batch.entries];
        return merged.length > 500 ? merged.slice(-500) : merged;
      });
      if (batch.latest_sequence !== null) logCursor.current = batch.latest_sequence;
      setLogsStreaming(batch.streaming);
      logsStreamingRef.current = batch.streaming;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      logRequest.current = false;
    }
  }, [client, device.id]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    logCursor.current = undefined;
    setPerformance(null);
    setProcesses(null);
    setLogs([]);
    setLogBatch(null);
    setSampling(false);
    setLogsStreaming(false);
    logsStreamingRef.current = false;
    setError(null);
    setLoading(true);
    void Promise.all([loadPerformance(false), loadLogs(true)]).finally(() => {
      if (!disposed) setLoading(false);
    });
    const timer = setInterval(() => {
      if (disposed) return;
      void loadPerformance(samplingOwned.current);
      if (logsOwned.current || logsStreamingRef.current) void loadLogs();
    }, 2_000);
    return () => {
      disposed = true;
      clearInterval(timer);
      if (samplingOwned.current) {
        samplingOwned.current = false;
        void client.stopPerformanceSampling(device.id).catch(() => undefined);
      }
      if (logsOwned.current) {
        logsOwned.current = false;
        void client.stopDeviceLogs(device.id).catch(() => undefined);
      }
    };
  }, [client, device.id, loadLogs, loadPerformance, visible]);

  const toggleSampling = async () => {
    if (action) return;
    setAction("sampling");
    setError(null);
    try {
      if (sampling) {
        await client.stopPerformanceSampling(device.id);
        samplingOwned.current = false;
        setSampling(false);
      } else {
        await client.startPerformanceSampling(device.id);
        samplingOwned.current = true;
        setSampling(true);
      }
      await loadPerformance(true);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setAction(null);
    }
  };

  const toggleLogs = async () => {
    if (action) return;
    setAction("logs");
    setError(null);
    try {
      if (logsStreaming) {
        await client.stopDeviceLogs(device.id);
        logsOwned.current = false;
        setLogsStreaming(false);
        logsStreamingRef.current = false;
      } else {
        await client.startDeviceLogs(device.id);
        logsOwned.current = true;
        setLogsStreaming(true);
        logsStreamingRef.current = true;
      }
      await loadLogs();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setAction(null);
    }
  };

  const clearLogs = () => {
    if (action) return;
    Alert.alert(t("clearDeviceLogs"), t("clearDeviceLogsPrompt"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("clearDeviceLogs"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setAction("clear");
            setError(null);
            try {
              await client.clearDeviceLogs(device.id);
              logCursor.current = undefined;
              setLogs([]);
              setLogBatch(null);
            } catch (clearError) {
              setError(clearError instanceof Error ? clearError.message : String(clearError));
            } finally {
              setAction(null);
            }
          })();
        },
      },
    ]);
  };

  const sample = performance?.sample;
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={[styles.root, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{t("performanceTitle")}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{device.name || device.udid}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => { setLoading(true); void Promise.all([loadPerformance(true), loadLogs()]).finally(() => setLoading(false)); }} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>{t("refresh")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>{t("close")}</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>{t("performanceHint")}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && !performance ? <View style={styles.loading}><ActivityIndicator color="#2368c4" /></View> : null}
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" disabled={action !== null} onPress={() => void toggleSampling()} style={[styles.primaryButton, action !== null && styles.disabled]}>
              {action === "sampling" ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{sampling ? t("stopSampling") : t("startSampling")}</Text>}
            </Pressable>
            <View style={[styles.statusPill, sampling ? styles.statusActive : styles.statusInactive]}>
              <Text style={styles.statusPillText}>{sampling ? t("samplingActive") : t("samplingInactive")}</Text>
            </View>
          </View>
          <View style={styles.metricsGrid}>
            <Metric label={t("systemCpu")} value={formatPercent(sample?.system_cpu_percent)} />
            <Metric label={t("physicalMemory")} value={formatBytes(sample?.physical_memory_bytes)} />
            <Metric label={t("graphicsFps")} value={formatFps(sample?.graphics_fps)} />
            <Metric label={t("networkRate")} value={`${formatRate(sample?.network_rx_bytes_per_second)} ↓\n${formatRate(sample?.network_tx_bytes_per_second)} ↑`} />
            <Metric label={t("processCount")} value={sample?.process_count == null ? "-" : String(sample.process_count)} />
            <Metric label={t("gpuInUse")} value={formatBytes(sample?.gpu_in_use_bytes)} />
          </View>
          <SectionTitle title={t("topProcesses")} />
          <View style={styles.card}>
            {processes?.processes.length ? processes.processes.slice(0, 12).map((process) => (
              <View key={`${process.pid}-${process.name}`} style={styles.processRow}>
                <View style={styles.processCopy}>
                  <Text numberOfLines={1} style={styles.processName}>{formatProcessName(process)}</Text>
                  <Text style={styles.processMeta}>PID {process.pid}{process.is_application ? " · app" : ""}</Text>
                </View>
              </View>
            )) : <Text style={styles.emptyText}>{t("noProcesses")}</Text>}
            {processes?.truncated ? <Text style={styles.caption}>{t("truncated")}</Text> : null}
          </View>
          <SectionTitle title={t("serviceHealth")} />
          <View style={styles.card}>
            {performance?.services.length ? performance.services.map((service) => (
              <View key={service.name} style={styles.serviceRow}>
                <View style={styles.processCopy}>
                  <Text numberOfLines={1} style={styles.processName}>{service.name}</Text>
                  <Text numberOfLines={2} style={styles.processMeta}>{service.last_error || `${service.phase} · ${service.restarts} restarts`}</Text>
                </View>
                <View style={[styles.serviceBadge, serviceTone(service)]}><Text style={styles.serviceBadgeText}>{service.phase}</Text></View>
              </View>
            )) : <Text style={styles.emptyText}>{t("noServiceHealth")}</Text>}
          </View>
          <View style={styles.logsHeading}>
            <SectionTitle title={t("deviceLogs")} />
            <View style={styles.logActions}>
              <Pressable accessibilityRole="button" disabled={action !== null} onPress={() => void toggleLogs()} style={styles.smallButton}>
                {action === "logs" ? <ActivityIndicator color="#2368c4" /> : <Text style={styles.smallButtonText}>{logsStreaming ? t("stopDeviceLogs") : t("startDeviceLogs")}</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" disabled={action !== null || logs.length === 0} onPress={clearLogs} style={[styles.smallButton, (action !== null || logs.length === 0) && styles.disabled]}>
                <Text style={styles.smallButtonDanger}>{t("clearDeviceLogs")}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.caption}>{t("logSource")}: {logBatch?.source ?? "-"} · {logsStreaming ? t("logStreaming") : t("logNotStreaming")}</Text>
            {logs.length ? logs.slice(-200).map((entry) => <Text key={entry.sequence} selectable style={styles.logLine}>{logLabel(entry)}</Text>) : <Text style={styles.emptyText}>{t("noDeviceLogs")}</Text>}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#f4f6f8", flex: 1 },
  header: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", paddingBottom: 14, paddingHorizontal: 14 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 4 },
  headerButton: { paddingHorizontal: 7, paddingVertical: 8 },
  headerButtonText: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  title: { color: "#152033", fontSize: 21, fontWeight: "800" },
  subtitle: { color: "#778395", fontSize: 11, marginTop: 3 },
  content: { padding: 14, paddingBottom: 28 },
  hint: { color: "#778395", fontSize: 12, lineHeight: 18 },
  error: { color: "#bd2d3b", fontSize: 13, lineHeight: 19, marginTop: 9 },
  loading: { alignItems: "center", minHeight: 72, justifyContent: "center" },
  actionRow: { alignItems: "center", flexDirection: "row", gap: 9, marginTop: 14 },
  primaryButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 9, justifyContent: "center", minHeight: 42, paddingHorizontal: 13 },
  primaryText: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
  statusPill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  statusActive: { backgroundColor: "#dff3e8" },
  statusInactive: { backgroundColor: "#e5eaf0" },
  statusPillText: { color: "#3f4b5d", fontSize: 11, fontWeight: "700" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  metric: { backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 10, borderWidth: 1, minHeight: 76, padding: 10, width: "31%" },
  metricLabel: { color: "#778395", fontSize: 10, fontWeight: "700" },
  metricValue: { color: "#152033", fontSize: 14, fontWeight: "800", marginTop: 8 },
  sectionTitle: { color: "#3f4b5d", fontSize: 13, fontWeight: "800", marginBottom: 8, marginTop: 17, textTransform: "uppercase" },
  card: { backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 11, borderWidth: 1, padding: 11 },
  processRow: { borderBottomColor: "#eef1f4", borderBottomWidth: 1, paddingVertical: 8 },
  processCopy: { flex: 1, minWidth: 0 },
  processName: { color: "#26364a", fontSize: 13, fontWeight: "700" },
  processMeta: { color: "#778395", fontSize: 11, marginTop: 3 },
  caption: { color: "#778395", fontSize: 11, lineHeight: 17 },
  emptyText: { color: "#778395", fontSize: 13, lineHeight: 19 },
  serviceRow: { alignItems: "center", borderBottomColor: "#eef1f4", borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 8 },
  serviceBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  serviceBadgeText: { color: "#3f4b5d", fontSize: 10, fontWeight: "700" },
  serviceReady: { backgroundColor: "#dff3e8" },
  serviceRecovering: { backgroundColor: "#fff0d9" },
  serviceUnavailable: { backgroundColor: "#fbe1e4" },
  logsHeading: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
  logActions: { alignItems: "center", flexDirection: "row", gap: 2 },
  smallButton: { justifyContent: "center", minHeight: 30, paddingHorizontal: 5, paddingVertical: 5 },
  smallButtonText: { color: "#2368c4", fontSize: 11, fontWeight: "700" },
  smallButtonDanger: { color: "#bd2d3b", fontSize: 11, fontWeight: "700" },
  logLine: { borderTopColor: "#eef1f4", borderTopWidth: 1, color: "#3f4b5d", fontFamily: "monospace", fontSize: 10, lineHeight: 15, paddingVertical: 7 },
  disabled: { opacity: 0.45 },
});
