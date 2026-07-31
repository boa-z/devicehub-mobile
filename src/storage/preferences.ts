import * as SecureStore from "expo-secure-store";

const LANGUAGE_KEY = "devicehub.mobile.language.v1";

export type Language = "en" | "zh";

export async function loadSavedLanguage(): Promise<Language> {
  try {
    const value = await SecureStore.getItemAsync(LANGUAGE_KEY);
    return value === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export async function saveLanguage(language: Language) {
  await SecureStore.setItemAsync(LANGUAGE_KEY, language, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
