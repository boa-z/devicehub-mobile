import { useState } from "react";
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

type Props = {
  initialOrigin: string;
  initialToken: string;
  busy: boolean;
  error: string | null;
  onSubmit: (origin: string, token: string) => void;
};

export function ConnectionScreen({ initialOrigin, initialToken, busy, error, onSubmit }: Props) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [token, setToken] = useState(initialToken);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.kicker}>DEVICEHUB MOBILE</Text>
        <Text style={styles.title}>Connect to your iPhone</Text>
        <Text style={styles.subtitle}>
          Use the address and access token printed by the DeviceHub headless service.
        </Text>
        <View style={styles.form}>
          <Text style={styles.label}>Service address</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:8080"
            placeholderTextColor="#8c96a5"
            style={styles.input}
            value={origin}
            onChangeText={setOrigin}
          />
          <Text style={styles.label}>Access token</Text>
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
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Connect</Text>}
          </Pressable>
        </View>
        <Text style={styles.note}>The server and this phone must be reachable on the same network.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f4f6f8" },
  content: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 560, width: "100%", alignSelf: "center" },
  kicker: { color: "#3973c5", fontSize: 12, fontWeight: "700", letterSpacing: 1.6, marginBottom: 10 },
  title: { color: "#152033", fontSize: 30, fontWeight: "800", marginBottom: 10 },
  subtitle: { color: "#5e6978", fontSize: 16, lineHeight: 23, marginBottom: 28 },
  form: { backgroundColor: "#ffffff", borderColor: "#e0e5eb", borderRadius: 16, borderWidth: 1, padding: 20 },
  label: { color: "#425064", fontSize: 13, fontWeight: "700", marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: "#f7f9fb", borderColor: "#d9e0e8", borderRadius: 10, borderWidth: 1, color: "#152033", fontSize: 16, marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: "#bd2d3b", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  primaryButton: { alignItems: "center", backgroundColor: "#2368c4", borderRadius: 10, justifyContent: "center", minHeight: 48 },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.6 },
  note: { color: "#778395", fontSize: 13, lineHeight: 19, marginTop: 18, textAlign: "center" },
});
