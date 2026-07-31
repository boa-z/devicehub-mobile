import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "devicehub.mobile.connection.v1";
const MAX_ORIGIN_LENGTH = 512;
const MAX_TOKEN_LENGTH = 512;

export type SavedConnection = {
  origin: string;
  token: string;
};

function validConnection(value: unknown): value is SavedConnection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { origin?: unknown; token?: unknown };
  return typeof candidate.origin === "string"
    && candidate.origin.trim().length > 0
    && candidate.origin.length <= MAX_ORIGIN_LENGTH
    && typeof candidate.token === "string"
    && candidate.token.trim().length > 0
    && candidate.token.length <= MAX_TOKEN_LENGTH;
}

export async function loadSavedConnection(): Promise<SavedConnection | null> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    return validConnection(parsed)
      ? { origin: parsed.origin.trim(), token: parsed.token.trim() }
      : null;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: SavedConnection) {
  if (!validConnection(connection)) throw new Error("Invalid DeviceHub connection credentials");
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({
    origin: connection.origin.trim(),
    token: connection.token.trim(),
  }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSavedConnection() {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
