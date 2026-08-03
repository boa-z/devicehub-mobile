export type TouchSurfaceSize = {
  width: number;
  height: number;
};

export type VideoFrameSize = {
  width: number;
  height: number;
};

export type DisplayedVideoRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function displayedVideoRect(
  surface: TouchSurfaceSize,
  video: VideoFrameSize | null,
  contentMode: "fit" | "fill" = "fit",
  ): DisplayedVideoRect {
  const surfaceWidth = Math.max(surface.width, 1);
  const surfaceHeight = Math.max(surface.height, 1);
  if (!video || video.width <= 0 || video.height <= 0) {
    return { left: 0, top: 0, width: surfaceWidth, height: surfaceHeight };
  }

  const scale = contentMode === "fill"
    ? Math.max(surfaceWidth / video.width, surfaceHeight / video.height)
    : Math.min(surfaceWidth / video.width, surfaceHeight / video.height);
  const displayedWidth = Math.max(video.width * scale, 1);
  const displayedHeight = Math.max(video.height * scale, 1);
  return {
    left: (surfaceWidth - displayedWidth) / 2,
    top: (surfaceHeight - displayedHeight) / 2,
    width: displayedWidth,
    height: displayedHeight,
  };
}

/** Map a touch in the full surface to the displayed video content. */
export function normalizeTouchPoint(
  locationX: number,
  locationY: number,
  surface: TouchSurfaceSize,
  video: VideoFrameSize | null,
  contentMode: "fit" | "fill" = "fit",
) {
  const rect = displayedVideoRect(surface, video, contentMode);
  return {
    x: clamp((locationX - rect.left) / rect.width),
    y: clamp((locationY - rect.top) / rect.height),
  };
}

/** Project a normalized video coordinate back onto the rendered surface. */
export function projectTouchPoint(
  x: number,
  y: number,
  surface: TouchSurfaceSize,
  video: VideoFrameSize | null,
  contentMode: "fit" | "fill" = "fit",
) {
  const rect = displayedVideoRect(surface, video, contentMode);
  return {
    x: rect.left + clamp(x) * rect.width,
    y: rect.top + clamp(y) * rect.height,
  };
}
