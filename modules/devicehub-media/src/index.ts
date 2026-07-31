import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";

export type DeviceHubVideoViewProps = {
  contentMode?: "fit" | "fill";
  onVideoStatus?: (event: { nativeEvent: { state: string; detail?: string } }) => void;
};

export type DeviceHubMediaModule = {
  pushVideoFrame(
    view: unknown,
    data: Uint8Array,
    timestampNs: number,
    keyframe: boolean,
    width: number,
    height: number,
  ): void;
  pushAudioPcm(data: Uint8Array, sampleRate: number, channels: number): void;
  reset(): void;
  resetVideo(view: unknown): void;
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
