import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useI18n } from "../i18n";
import { DeviceHubClient } from "../protocol/client";
import type {
  AppDocumentEntry,
  AppDocumentList,
  AppStorageScope,
  Device,
  DeviceApp,
  DeviceFileEntry,
  DeviceFileList,
} from "../protocol/types";

type Props = {
  client: DeviceHubClient;
  device: Device;
  visible: boolean;
  onClose: () => void;
  app?: DeviceApp | null;
};

type StorageEntry = DeviceFileEntry | AppDocumentEntry;
type StorageList = DeviceFileList | AppDocumentList;

type Prompt = {
  mode: "rename" | "directory";
  path: string;
  value: string;
} | null;

const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

function normalizePath(path: string) {
  const normalized = `/${path}`.replace(/\/+/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "") || "/";
}

function parentPath(path: string) {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "/" : normalized.slice(0, separator);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GB`;
}

function validName(value: string) {
  const name = value.trim();
  return Boolean(name)
    && name !== "."
    && name !== ".."
    && !name.includes("/")
    && !name.includes("\\")
    && !Array.from(name).some((character) => character.charCodeAt(0) < 32);
}

export function DeviceFilesScreen({ client, device, visible, onClose, app = null }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState("/");
  const [listing, setListing] = useState<StorageList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [scope, setScope] = useState<AppStorageScope>("documents");

  const scopeAvailable = (candidate: AppStorageScope) => {
    if (!app) return candidate === "documents";
    if (candidate === "documents") return app.documents_available;
    return app.is_developer_app;
  };

  const load = useCallback(async (nextPath = path, nextScope = scope) => {
    setLoading(true);
    setError(null);
    try {
      const normalizedPath = normalizePath(nextPath);
      setListing(app
        ? await client.listAppDocuments(device.id, app.bundle_id, nextScope, normalizedPath)
        : await client.listDeviceFiles(device.id, normalizedPath));
    } catch (loadError) {
      setListing(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [app, client, device.id, path, scope]);

  useEffect(() => {
    if (!visible) return;
    const initialScope: AppStorageScope = scopeAvailable("documents") ? "documents" : "container";
    setPath("/");
    setScope(initialScope);
    void load("/", initialScope);
  }, [visible, client, device.id, app?.bundle_id]);

  const entries = useMemo(() => {
    if (!listing) return [];
    return [...listing.entries].sort((left, right) => {
      if (left.kind === "directory" && right.kind !== "directory") return -1;
      if (left.kind !== "directory" && right.kind === "directory") return 1;
      return left.name.localeCompare(right.name);
    });
  }, [listing]);

  const navigate = (entry: StorageEntry) => {
    if (entry.kind !== "directory") return;
    const nextPath = normalizePath(entry.path);
    setPath(nextPath);
    void load(nextPath);
  };

  const goParent = () => {
    const nextPath = parentPath(path);
    setPath(nextPath);
    void load(nextPath);
  };

  const changeScope = (nextScope: AppStorageScope) => {
    if (!app || nextScope === scope) return;
    setScope(nextScope);
    setPath("/");
    void load("/", nextScope);
  };

  const openRename = (entry: StorageEntry) => {
    setPrompt({ mode: "rename", path: entry.path, value: entry.name });
  };

  const openDirectory = () => {
    setPrompt({ mode: "directory", path, value: "" });
  };

  const submitPrompt = async () => {
    if (!prompt || !validName(prompt.value)) {
      setError(t("fileNameInvalid"));
      return;
    }
    setMutationBusy(true);
    setError(null);
    try {
      if (prompt.mode === "rename") {
        if (app) {
          await client.renameAppDocument(device.id, app.bundle_id, scope, prompt.path, prompt.value.trim());
        } else {
          await client.renameDeviceFile(device.id, prompt.path, prompt.value.trim());
        }
      } else {
        if (app) {
          await client.createAppDirectory(device.id, app.bundle_id, scope, normalizePath(prompt.path), prompt.value.trim());
        } else {
          await client.createDeviceDirectory(device.id, normalizePath(prompt.path), prompt.value.trim());
        }
      }
      setPrompt(null);
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setMutationBusy(false);
    }
  };

  const remove = (entry: StorageEntry) => {
    Alert.alert(t("deleteFileTitle"), t("deleteFilePrompt", { name: entry.name }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteAction"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setMutationBusy(true);
            setError(null);
            try {
              if (app) {
                await client.deleteAppDocument(device.id, app.bundle_id, scope, entry.path, entry.kind === "directory");
              } else {
                await client.deleteDeviceFile(device.id, entry.path);
              }
              await load();
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
            } finally {
              setMutationBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const importFile = async () => {
    if (mutationBusy || loading) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "*/*",
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.size !== undefined && asset.size > MAX_TRANSFER_BYTES) {
      setError(t("fileTooLarge"));
      return;
    }
    setMutationBusy(true);
    setError(null);
    try {
      const source = app
        ? client.deviceAppImportSource(device.id, app.bundle_id, scope, normalizePath(path), asset.name)
        : client.deviceFileImportSource(device.id, normalizePath(path), asset.name);
      const response = await FileSystem.uploadAsync(source.uri, asset.uri, {
        headers: {
          ...source.headers,
          "content-type": asset.mimeType || "application/octet-stream",
        },
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(response.body || `HTTP ${response.status}`);
      }
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setMutationBusy(false);
    }
  };

  const exportFile = async (entry: StorageEntry) => {
    if (entry.kind !== "file" || mutationBusy || loading) return;
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
      setError(t("fileTransferUnavailable"));
      return;
    }
    if (!(await Sharing.isAvailableAsync())) {
      setError(t("fileTransferUnavailable"));
      return;
    }
    setMutationBusy(true);
    setError(null);
    const safeName = entry.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "device-file";
    const destination = `${cacheDirectory}devicehub-${Date.now()}-${safeName}`;
    try {
      const source = app
        ? client.deviceAppExportSource(device.id, app.bundle_id, scope, entry.path, entry.name)
        : client.deviceFileExportSource(device.id, entry.path, entry.name);
      const result = await FileSystem.downloadAsync(source.uri, destination, { headers: source.headers });
      if (result.status < 200 || result.status >= 300) {
        const body = await FileSystem.readAsStringAsync(result.uri).catch(() => "");
        throw new Error(body || `HTTP ${result.status}`);
      }
      await Sharing.shareAsync(result.uri, {
        dialogTitle: t("exportFile"),
        mimeType: "application/octet-stream",
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
      setMutationBusy(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={[styles.root, { paddingBottom: insets.bottom, paddingTop: 18 + insets.top }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{t("close")}</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{app ? t("appDocuments") : t("deviceFiles")}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{app ? app.name || app.bundle_id : device.name || device.udid}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={loading || mutationBusy} onPress={() => void load()} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{t("refresh")}</Text>
          </Pressable>
        </View>
        {app ? (
          <View style={styles.scopeToolbar}>
            <Text style={styles.scopeLabel}>{t("storageScope")}</Text>
            {(["documents", "container"] as const).map((option) => (
              <Pressable
                accessibilityRole="button"
                disabled={!scopeAvailable(option) || loading || mutationBusy}
                key={option}
                onPress={() => changeScope(option)}
                style={[styles.scopeButton, scope === option && styles.scopeButtonActive, !scopeAvailable(option) && styles.disabled]}
              >
                <Text style={[styles.scopeButtonText, scope === option && styles.scopeButtonTextActive]}>
                  {option === "documents" ? t("documents") : t("container")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.toolbar}>
          <View style={styles.pathCopy}>
            <Text style={styles.pathLabel}>{t("currentPath")}</Text>
            <Text numberOfLines={1} style={styles.path}>{listing?.path || path}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={path === "/" || loading || mutationBusy} onPress={goParent} style={[styles.toolbarButton, (path === "/" || loading || mutationBusy) && styles.disabled]}>
            <Text style={styles.toolbarText}>{t("parent")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={loading || mutationBusy} onPress={openDirectory} style={[styles.toolbarButton, (loading || mutationBusy) && styles.disabled]}>
            <Text style={styles.toolbarText}>{t("newFolder")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={loading || mutationBusy} onPress={() => void importFile()} style={[styles.toolbarButton, (loading || mutationBusy) && styles.disabled]}>
            <Text style={styles.toolbarText}>{t("importFile")}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {listing?.truncated ? <Text style={styles.warning}>{t("truncated")}</Text> : null}
        {loading && !listing ? (
          <View style={styles.loading}><ActivityIndicator color="#2368c4" /><Text style={styles.loadingText}>{t("loadingFiles")}</Text></View>
        ) : (
          <FlatList
            contentContainerStyle={entries.length === 0 ? styles.emptyList : styles.list}
            data={entries}
            keyExtractor={(entry) => entry.path}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable accessibilityRole={item.kind === "directory" ? "button" : undefined} disabled={item.kind !== "directory" || mutationBusy} onPress={() => navigate(item)} style={styles.rowMain}>
                  <Text style={styles.icon}>{item.kind === "directory" ? "▣" : "□"}</Text>
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                    <Text numberOfLines={1} style={styles.meta}>{item.kind === "directory" ? t("directory") : formatBytes(item.size_bytes)} · {item.modified}</Text>
                  </View>
                </Pressable>
                <View style={styles.rowActions}>
                  <Pressable accessibilityRole="button" disabled={mutationBusy} onPress={() => openRename(item)} style={styles.rowButton}>
                    <Text style={styles.rowButtonText}>{t("rename")}</Text>
                  </Pressable>
                  {item.kind === "file" ? (
                    <Pressable accessibilityRole="button" disabled={mutationBusy} onPress={() => void exportFile(item)} style={styles.rowButton}>
                      <Text style={styles.rowButtonText}>{t("exportFile")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" disabled={mutationBusy} onPress={() => remove(item)} style={styles.rowButton}>
                    <Text style={styles.deleteText}>{t("delete")}</Text>
                  </Pressable>
                </View>
              </View>
            )}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t("noFiles")}</Text></View>}
          />
        )}
        <Modal animationType="fade" onRequestClose={() => setPrompt(null)} transparent visible={prompt !== null}>
          <View style={styles.promptBackdrop}>
            <View style={styles.promptCard}>
              <Text style={styles.promptTitle}>{prompt?.mode === "rename" ? t("renameFileTitle") : t("createFolderTitle")}</Text>
              <Text style={styles.promptLabel}>{t("entryName")}</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setPrompt((current) => current ? { ...current, value } : current)}
                placeholder={t("entryName")}
                placeholderTextColor="#8c96a5"
                style={styles.promptInput}
                value={prompt?.value ?? ""}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.promptActions}>
                <Pressable accessibilityRole="button" onPress={() => setPrompt(null)} style={styles.promptCancel}>
                  <Text style={styles.promptCancelText}>{t("cancel")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={mutationBusy} onPress={() => void submitPrompt()} style={[styles.promptSubmit, mutationBusy && styles.disabled]}>
                  {mutationBusy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.promptSubmitText}>{t("submit")}</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#f4f6f8", flex: 1, paddingTop: 18 },
  header: { alignItems: "center", borderBottomColor: "#dce2e9", borderBottomWidth: 1, flexDirection: "row", paddingBottom: 14, paddingHorizontal: 12 },
  headerButton: { minWidth: 64, paddingHorizontal: 7, paddingVertical: 8 },
  headerButtonText: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: "#152033", fontSize: 21, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "#778395", fontSize: 11, marginTop: 3, textAlign: "center" },
  scopeToolbar: { alignItems: "center", backgroundColor: "#ffffff", borderBottomColor: "#e0e5eb", borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  scopeLabel: { color: "#778395", fontSize: 11, fontWeight: "700", marginRight: 2 },
  scopeButton: { borderColor: "#d9e0e8", borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  scopeButtonActive: { backgroundColor: "#e6f0ff", borderColor: "#8eb5ec" },
  scopeButtonText: { color: "#536273", fontSize: 12, fontWeight: "700" },
  scopeButtonTextActive: { color: "#2368c4" },
  toolbar: { alignItems: "center", backgroundColor: "#ffffff", borderBottomColor: "#e0e5eb", borderBottomWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  pathCopy: { flex: 1, minWidth: 0 },
  pathLabel: { color: "#778395", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  path: { color: "#3f4b5d", fontSize: 13, marginTop: 2 },
  toolbarButton: { borderColor: "#b8cdea", borderRadius: 8, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 8 },
  toolbarText: { color: "#2368c4", fontSize: 12, fontWeight: "700" },
  error: { color: "#bd2d3b", fontSize: 13, lineHeight: 18, paddingHorizontal: 14, paddingTop: 10 },
  warning: { color: "#bd7621", fontSize: 12, paddingHorizontal: 14, paddingTop: 8 },
  list: { padding: 12 },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: 24 },
  row: { alignItems: "center", backgroundColor: "#ffffff", borderColor: "#dce2e9", borderRadius: 11, borderWidth: 1, flexDirection: "row", marginBottom: 8, padding: 11 },
  rowMain: { alignItems: "center", flex: 1, flexDirection: "row", minWidth: 0 },
  icon: { color: "#2368c4", fontSize: 19, marginRight: 10, width: 22 },
  rowCopy: { flex: 1, minWidth: 0 },
  name: { color: "#152033", fontSize: 14, fontWeight: "700" },
  meta: { color: "#778395", fontSize: 11, marginTop: 3 },
  rowActions: { alignItems: "center", flexDirection: "row", gap: 5, marginLeft: 6 },
  rowButton: { paddingHorizontal: 4, paddingVertical: 7 },
  rowButtonText: { color: "#2368c4", fontSize: 11, fontWeight: "700" },
  deleteText: { color: "#bd2d3b", fontSize: 11, fontWeight: "700" },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  loadingText: { color: "#778395", fontSize: 13, marginTop: 10 },
  empty: { alignItems: "center" },
  emptyText: { color: "#778395", fontSize: 14 },
  promptBackdrop: { alignItems: "center", backgroundColor: "rgba(15,24,34,0.45)", flex: 1, justifyContent: "center", padding: 24 },
  promptCard: { backgroundColor: "#ffffff", borderRadius: 14, maxWidth: 440, padding: 18, width: "100%" },
  promptTitle: { color: "#152033", fontSize: 18, fontWeight: "800", marginBottom: 16 },
  promptLabel: { color: "#425064", fontSize: 13, fontWeight: "700", marginBottom: 7 },
  promptInput: { backgroundColor: "#f7f9fb", borderColor: "#d9e0e8", borderRadius: 9, borderWidth: 1, color: "#152033", fontSize: 16, paddingHorizontal: 12, paddingVertical: 11 },
  promptActions: { flexDirection: "row", gap: 9, justifyContent: "flex-end", marginTop: 16 },
  promptCancel: { borderColor: "#d9e0e8", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 14 },
  promptCancelText: { color: "#536273", fontSize: 13, fontWeight: "700" },
  promptSubmit: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 9, justifyContent: "center", minHeight: 42, minWidth: 78, paddingHorizontal: 14 },
  promptSubmitText: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
