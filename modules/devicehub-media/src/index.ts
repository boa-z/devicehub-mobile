import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";

export type DeviceHubVideoOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

export type DeviceHubPictureInPictureStatus = {
  state: "starting" | "started" | "stopping" | "stopped" | "failed";
  detail?: string;
};

export type DeviceHubVideoViewProps = {
  contentMode?: "fit" | "fill";
  orientation?: DeviceHubVideoOrientation;
  onVideoStatus?: (event: { nativeEvent: { state: string; detail?: string } }) => void;
  onPictureInPictureStatus?: (event: { nativeEvent: DeviceHubPictureInPictureStatus }) => void;
};

export type DeviceHubMediaModule = {
  pushVideoFrame(
    view: unknown,
    data: Uint8Array,
    timestampNs: number,
    keyframe: boolean,
    width: number,
    height: number,
  ): boolean;
  pushAudioPcm(data: Uint8Array, sampleRate: number, channels: number): void;
  reset(): void;
  resetVideo(view: unknown): void;
  isPictureInPictureSupported?: () => boolean;
  startPictureInPicture?: (view: unknown) => boolean;
  stopPictureInPicture?: (view: unknown) => void;
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
