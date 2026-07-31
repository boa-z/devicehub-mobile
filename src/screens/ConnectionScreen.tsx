import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { serviceOrigin, type DeviceHubService } from "devicehub-discovery";
import { useI18n } from "../i18n";

type Props = {
  initialOrigin: string;
  initialToken: string;
  busy: boolean;
  error: string | null;
  scanning: boolean;
  services: DeviceHubService[];
  onRefreshDiscovery: () => void;
  onSelectService: (service: DeviceHubService) => void;
  onBack: () => void;
  onSubmit: (origin: string, token: string) => Promise<void>;
};

export function ConnectionScreen({
  initialOrigin,
  initialToken,
  busy,
  error,
  scanning,
  services,
  onRefreshDiscovery,
  onSelectService,
  onBack,
  onSubmit,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [origin, setOrigin] = useState(initialOrigin);
  const [token, setToken] = useState(initialToken);

  useEffect(() => setOrigin(initialOrigin), [initialOrigin]);
  useEffect(() => setToken(initialToken), [initialToken]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingBottom: insets.bottom, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.kicker}>{t("appName")}</Text>
            <Text style={styles.title}>{t("connectionTitle")}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
            <Text style={styles.backText}>‹ {t("back")}</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>{t("connectionSubtitle")}</Text>
        <View style={styles.form}>
          <View style={styles.discoveryHeader}>
            <View style={styles.discoveryTitleGroup}>
              <Text style={styles.label}>{t("nearbyServices")}</Text>
              <Text style={styles.discoveryHint}>
                {scanning ? t("scanningNetwork") : t("discoveryIdle")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onRefreshDiscovery}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("scan")}</Text>
            </Pressable>
          </View>
          {services.length > 0 ? (
            <View style={styles.serviceList}>
              {services.map((service) => (
                <Pressable
                  accessibilityRole="button"
                  key={service.id}
                  onPress={() => {
                    setOrigin(serviceOrigin(service));
                    onSelectService(service);
                  }}
                  style={({ pressed }) => [styles.serviceRow, pressed && styles.pressed]}
                >
                  <View style={styles.serviceCopy}>
                    <Text numberOfLines={1} style={styles.serviceName}>{service.name}</Text>
                    <Text numberOfLines={1} style={styles.serviceAddress}>{service.host}:{service.port}</Text>
                  </View>
                  <Text style={styles.serviceAction}>{t("use")}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyDiscovery}>
              {t("noServices")}
            </Text>
          )}
          <View style={styles.divider} />
          <Text style={styles.label}>{t("serviceAddressHint")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:8080/#access_token=..."
            placeholderTextColor="#8c96a5"
            style={styles.input}
            value={origin}
            onChangeText={setOrigin}
          />
          <Text style={styles.label}>{t("accessToken")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste the token from DeviceHub"
            placeholderTextColor="#8c96a5"
            secureTextEntry
            style={styles.input}
            value={token}
            onChangeText={setToken}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onSubmit(origin, token)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
          >
            {busy ? <><ActivityIndicator color="#ffffff" /><Text style={styles.busyText}>{t("connecting")}</Text></> : <Text style={styles.primaryText}>{t("connectButton")}</Text>}
          </Pressable>
        </View>
        <Text style={styles.note}>{t("localNetworkNote")}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f4f6f8" },
  content: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 560, width: "100%", alignSelf: "center" },
  headingRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  headingCopy: { flex: 1, paddingRight: 12 },
  backButton: { paddingHorizontal: 4, paddingVertical: 8 },
  backText: { color: "#2368c4", fontSize: 14, fontWeight: "700" },
  kicker: { color: "#3973c5", fontSize: 12, fontWeight: "700", letterSpacing: 1.6, marginBottom: 10 },
  title: { color: "#152033", fontSize: 30, fontWeight: "800", marginBottom: 10 },
  subtitle: { color: "#5e6978", fontSize: 16, lineHeight: 23, marginBottom: 28 },
  form: { backgroundColor: "#ffffff", borderColor: "#e0e5eb", borderRadius: 16, borderWidth: 1, padding: 20 },
  discoveryHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  discoveryTitleGroup: { flex: 1, paddingRight: 12 },
  discoveryHint: { color: "#778395", fontSize: 12, lineHeight: 17, marginTop: -4 },
  secondaryButton: { alignItems: "center", borderColor: "#c8d4e1", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 34, paddingHorizontal: 14 },
  secondaryText: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  serviceList: { gap: 8, marginBottom: 14 },
  serviceRow: { alignItems: "center", backgroundColor: "#f7f9fb", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, flexDirection: "row", minHeight: 52, paddingHorizontal: 12, paddingVertical: 8 },
  serviceCopy: { flex: 1, paddingRight: 10 },
  serviceName: { color: "#152033", fontSize: 14, fontWeight: "700" },
  serviceAddress: { color: "#778395", fontSize: 12, marginTop: 2 },
  serviceAction: { color: "#2368c4", fontSize: 13, fontWeight: "700" },
  emptyDiscovery: { color: "#778395", fontSize: 13, lineHeight: 18, marginBottom: 14 },
  divider: { backgroundColor: "#e5e9ef", height: 1, marginBottom: 14 },
  label: { color: "#425064", fontSize: 13, fontWeight: "700", marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: "#f7f9fb", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: "#bd2d3b", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  primaryButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 10, justifyContent: "center", minHeight: 48 },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  busyText: { color: "#ffffff", fontSize: 13, fontWeight: "700", marginTop: 4 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.6 },
  note: { color: "#778395", fontSize: 13, lineHeight: 19, marginTop: 18, textAlign: "center" },
});
