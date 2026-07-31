import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SavedConnection } from "../storage/credentials";
import { useI18n } from "../i18n";

type Props = {
  savedConnection: SavedConnection | null;
  connectedOrigin: string | null;
  deviceCount: number | null;
  onConnect: () => void;
  onOpenDevices: () => void;
  onSettings: () => void;
};

export function HomeScreen({
  savedConnection,
  connectedOrigin,
  deviceCount,
  onConnect,
  onOpenDevices,
  onSettings,
}: Props) {
  const { t } = useI18n();
  const connected = connectedOrigin !== null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{t("appName")}</Text>
          <Text style={styles.title}>{t("home")}</Text>
        </View>
        <Pressable
          accessibilityLabel={t("settings")}
          accessibilityRole="button"
          onPress={onSettings}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
        >
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.heroTitle}>{t("homeTitle")}</Text>
        <Text style={styles.heroSubtitle}>{t("homeSubtitle")}</Text>

        <View style={styles.connectionCard}>
          <View style={styles.cardHeading}>
            <View style={[styles.statusDot, connected ? styles.statusConnected : styles.statusIdle]} />
            <Text style={styles.cardTitle}>{connected ? t("connectionReady") : t("savedConnection")}</Text>
          </View>
          {connected ? (
            <>
              <Text style={styles.origin} numberOfLines={1}>{connectedOrigin}</Text>
              <Text style={styles.deviceCount}>
                {t("deviceCount", { count: deviceCount ?? 0 })}
              </Text>
            </>
          ) : savedConnection ? (
            <>
              <Text style={styles.origin} numberOfLines={1}>{savedConnection.origin}</Text>
              <Text style={styles.tokenHint}>{t("tokenStored")}</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>{t("noSavedConnection")}</Text>
          )}
          <View style={styles.actions}>
            {connected ? (
              <Pressable
                accessibilityRole="button"
                onPress={onOpenDevices}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{t("openDevices")}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={onConnect}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{savedConnection ? t("connect") : t("configureConnection")}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={onSettings}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>{connected ? t("changeConnection") : t("settings")}</Text>
            </Pressable>
          </View>
        </View>

        {!connected ? <Text style={styles.note}>{t("connectionNotActive")}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#f4f6f8", flex: 1 },
  header: { alignItems: "center", backgroundColor: "#ffffff", borderBottomColor: "#e0e5eb", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 22, paddingTop: 22, paddingBottom: 16 },
  kicker: { color: "#3973c5", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginBottom: 5 },
  title: { color: "#152033", fontSize: 25, fontWeight: "800" },
  settingsButton: { alignItems: "center", borderColor: "#d9e0e8", borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  settingsIcon: { color: "#3f4b5d", fontSize: 22 },
  content: { alignSelf: "center", maxWidth: 560, padding: 24, width: "100%" },
  heroTitle: { color: "#152033", fontSize: 30, fontWeight: "800", lineHeight: 36, marginTop: 18 },
  heroSubtitle: { color: "#5e6978", fontSize: 16, lineHeight: 23, marginTop: 10 },
  connectionCard: { backgroundColor: "#ffffff", borderColor: "#e0e5eb", borderRadius: 16, borderWidth: 1, marginTop: 28, padding: 20 },
  cardHeading: { alignItems: "center", flexDirection: "row" },
  statusDot: { borderRadius: 5, height: 10, marginRight: 9, width: 10 },
  statusConnected: { backgroundColor: "#2b9a66" },
  statusIdle: { backgroundColor: "#9aa5b4" },
  cardTitle: { color: "#26364a", fontSize: 15, fontWeight: "800" },
  origin: { color: "#3f4b5d", fontSize: 15, marginTop: 15 },
  deviceCount: { color: "#778395", fontSize: 13, marginTop: 6 },
  tokenHint: { color: "#778395", fontSize: 13, marginTop: 7 },
  emptyText: { color: "#778395", fontSize: 14, marginTop: 14 },
  actions: { flexDirection: "row", gap: 10, marginTop: 22 },
  primaryButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 10, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 12 },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "800", textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: "#b8cdea", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  secondaryText: { color: "#2368c4", fontSize: 14, fontWeight: "700", textAlign: "center" },
  note: { color: "#778395", fontSize: 13, lineHeight: 19, marginTop: 18, textAlign: "center" },
  pressed: { opacity: 0.78 },
});
