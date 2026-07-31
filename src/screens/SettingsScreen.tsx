import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_BUILD, APP_COMMIT, APP_VERSION, APP_VERSION_LABEL } from "../runtime/version";
import { useI18n, type Language } from "../i18n";
import { parseConnectionInput } from "../protocol/client";
import type { SavedConnection } from "../storage/credentials";
import { clearSavedConnection, saveConnection } from "../storage/credentials";

type Props = {
  savedConnection: SavedConnection | null;
  onBack: () => void;
  onSaved: (connection: SavedConnection) => void;
  onCleared: () => void;
};

export function SettingsScreen({ savedConnection, onBack, onSaved, onCleared }: Props) {
  const { language, setLanguage, t } = useI18n();
  const insets = useSafeAreaInsets();
  const [origin, setOrigin] = useState(savedConnection?.origin ?? "");
  const [token, setToken] = useState(savedConnection?.token ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(savedConnection?.origin ?? "");
    setToken(savedConnection?.token ?? "");
  }, [savedConnection]);

  const save = async () => {
    setMessage(null);
    setError(null);
    if (!origin.trim() || !token.trim()) {
      setError(t("invalidConnection"));
      return;
    }
    setBusy(true);
    try {
      const connection = parseConnectionInput(origin, token);
      await saveConnection(connection);
      setOrigin(connection.origin);
      setToken(connection.token);
      onSaved(connection);
      setMessage(t("configurationSaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    Alert.alert(t("clearConfiguration"), t("clearConfigurationPrompt"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("clearConfigurationAction"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setMessage(null);
            setError(null);
            try {
              await clearSavedConnection();
              setOrigin("");
              setToken("");
              onCleared();
              setMessage(t("configurationCleared"));
            } catch (clearError) {
              setError(clearError instanceof Error ? clearError.message : String(clearError));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const chooseLanguage = (next: Language) => setLanguage(next);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.root, { paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: 14 + insets.top }]}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹ {t("back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("settingsTitle")}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>{t("connectionSection")}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>{t("serverAddress")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setOrigin}
            placeholder="http://192.168.1.10:8080"
            placeholderTextColor="#8c96a5"
            style={styles.input}
            value={origin}
          />
          <Text style={styles.label}>{t("accessToken")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setToken}
            placeholder="Paste the token from DeviceHub"
            placeholderTextColor="#8c96a5"
            secureTextEntry
            style={styles.input}
            value={token}
          />
          <Text style={styles.hint}>{t("settingsSavedHint")}</Text>
          <Text style={styles.hint}>{t("settingsConnectionHint")}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void save()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.primaryText}>{busy ? t("save") : t("saveConfiguration")}</Text>
          </Pressable>
          {savedConnection ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={clear}
              style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Text style={styles.dangerText}>{t("clearConfiguration")}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{t("languageSection")}</Text>
        <View style={styles.segmented}>
          {(["en", "zh"] as const).map((option) => (
            <Pressable
              accessibilityRole="button"
              key={option}
              onPress={() => chooseLanguage(option)}
              style={[styles.segment, language === option && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, language === option && styles.segmentTextActive]}>
                {option === "en" ? t("languageEnglish") : t("languageChinese")}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t("aboutSection")}</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>{t("appVersion")}</Text><Text style={styles.infoValue}>{APP_VERSION}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>{t("buildNumber")}</Text><Text style={styles.infoValue}>{APP_BUILD}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>{t("commit")}</Text><Text style={styles.infoValue}>{APP_COMMIT}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>{t("protocolClient")}</Text><Text style={styles.infoValue}>{APP_VERSION_LABEL}</Text></View>
          <Text style={styles.aboutText}>{t("mobileClientDescription")}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#f4f6f8", flex: 1 },
  header: { alignItems: "center", backgroundColor: "#ffffff", borderBottomColor: "#e0e5eb", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  backButton: { minWidth: 78, paddingVertical: 8 },
  backText: { color: "#2368c4", fontSize: 15, fontWeight: "700" },
  title: { color: "#152033", fontSize: 19, fontWeight: "800" },
  headerSpacer: { minWidth: 78 },
  content: { alignSelf: "center", maxWidth: 560, padding: 20, paddingBottom: 40, width: "100%" },
  sectionTitle: { color: "#3f4b5d", fontSize: 13, fontWeight: "800", marginBottom: 9, marginTop: 18, textTransform: "uppercase" },
  card: { backgroundColor: "#ffffff", borderColor: "#e0e5eb", borderRadius: 14, borderWidth: 1, padding: 17 },
  label: { color: "#425064", fontSize: 13, fontWeight: "700", marginBottom: 7, marginTop: 4 },
  input: { backgroundColor: "#f7f9fb", borderColor: "#d9e0e8", borderRadius: 9, borderWidth: 1, color: "#152033", fontSize: 16, marginBottom: 13, paddingHorizontal: 13, paddingVertical: 11 },
  hint: { color: "#778395", fontSize: 12, lineHeight: 17, marginTop: 3 },
  error: { color: "#bd2d3b", fontSize: 14, lineHeight: 19, marginTop: 12 },
  success: { color: "#2b9a66", fontSize: 14, lineHeight: 19, marginTop: 12 },
  primaryButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 9, justifyContent: "center", marginTop: 17, minHeight: 46 },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  dangerButton: { alignItems: "center", justifyContent: "center", marginTop: 11, minHeight: 40 },
  dangerText: { color: "#bd2d3b", fontSize: 13, fontWeight: "700" },
  segmented: { backgroundColor: "#e6ebf1", borderRadius: 10, flexDirection: "row", padding: 3 },
  segment: { alignItems: "center", borderRadius: 8, flex: 1, justifyContent: "center", minHeight: 42 },
  segmentActive: { backgroundColor: "#ffffff", shadowColor: "#1b2838", shadowOpacity: 0.08, shadowRadius: 3 },
  segmentText: { color: "#687587", fontSize: 14, fontWeight: "700" },
  segmentTextActive: { color: "#2368c4" },
  infoRow: { alignItems: "center", borderBottomColor: "#eef1f4", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  infoLabel: { color: "#778395", fontSize: 14 },
  infoValue: { color: "#26364a", fontSize: 14, fontWeight: "700" },
  aboutText: { color: "#778395", fontSize: 13, marginTop: 14 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});
