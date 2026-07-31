import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";

export type DeviceHubVideoViewProps = {
  contentMode?: "fit" | "fill";
  onVideoStatus?: (event: { nativeEvent: { state: string; detail?: string } }) => void;
};

export type DeviceHubMediaModule = {
  pushVideoFrame(view: unknown, data: Uint8Array, timestampNs: number, keyframe: boolean): void;
  pushAudioPcm(data: Int16Array, sampleRate: number, channels: number): void;
  reset(): void;
};

function loadNativeModule() {
  try {
    return requireNativeModule<DeviceHubMediaModule>("DeviceHubMedia");
  } catch {
    return null;
  }
}

function loadNativeView() {
  try {
    return requireNativeViewManager<DeviceHubVideoViewProps>("DeviceHubMedia") as ComponentType<DeviceHubVideoViewProps>;
  } catch {
    return null;
  }
}

export const DeviceHubMedia = loadNativeModule();
export const DeviceHubVideoView = loadNativeView();
