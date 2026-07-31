import Constants from "expo-constants";
import { Platform } from "react-native";

type RuntimeConfig = {
  version?: unknown;
  build?: unknown;
};

const expoConfig = Constants.expoConfig;
const configured = (expoConfig?.extra as { devicehub?: RuntimeConfig } | undefined)?.devicehub;

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: string) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return stringValue(value, fallback);
}

export const APP_VERSION = stringValue(configured?.version ?? expoConfig?.version, "1.0.0");

const platformBuild = Platform.OS === "ios"
  ? expoConfig?.ios?.buildNumber
  : expoConfig?.android?.versionCode;

export const APP_BUILD = numberValue(configured?.build ?? platformBuild, "1");
export const APP_VERSION_LABEL = `${APP_VERSION} (${APP_BUILD})`;
