# Client architecture

DeviceHub Mobile is a control client. The remote device set is intentionally limited to iPhone and iPad. The client application can run on iOS or Android; Android is a client platform, not a remote-device transport.

## Boundaries

```text
React Native screens
  -> protocol client (HTTP, WebSocket, typed commands and device-scoped app control)
  -> media adapter (native view and audio sink)
  -> iOS AVSampleBufferDisplayLayer/AVAudioEngine
  -> Android MediaCodec/AudioTrack
```

`src/protocol` owns the wire contract. It knows the Bearer token, `/api/status`, `/api/ws`, device-scoped app requests, control messages, and the `DHV2`/`DHA1` packet headers. Screens do not parse packets or construct WebSocket URLs.

Device-scoped HTTP operations, such as app listing and app lifecycle control,
carry the selected session ID in `x-devicehub-device`. This keeps multi-device
selection explicit without changing the bearer-token or WebSocket protocol.

`modules/devicehub-media` owns platform media primitives. On iOS, HEVC access units are converted to `CMSampleBuffer` values on a dedicated serial queue and presented by `AVSampleBufferDisplayLayer`; PCM16 is converted to `AVAudioPCMBuffer` on a dedicated audio queue. On Android, HEVC is queued to `MediaCodec` and PCM16 is written to a streaming `AudioTrack`. Both adapters cap pending work and discard stale inter frames when the renderer falls behind, so the JS thread is not used as a media decode queue.

The access token is stored only through `expo-secure-store` (Keychain on iOS and Keystore-backed storage on Android). A user changing the server explicitly clears the saved credential.

The native modules expose the same API on both client platforms. The server protocol remains platform-neutral at the client side, while `target_platforms` is restricted to `ios` because only iPhone/iPad sessions are supported.

## Handshake

Every mobile socket sends `client_hello` after opening:

- protocol version;
- client platform (`ios` or `android`);
- client version;
- media and input capabilities.

The server replies with `server_hello`, including the supported packet formats and target platform list. The current target list contains only `ios` because DeviceHub controls iPhone/iPad sessions.

The control screen treats the socket as ready only after `server_hello` has been
validated. Video and audio demand are sent after that point, rather than merely
when the underlying WebSocket reports `OPEN`. The mobile client applies an
eight-second connection/handshake deadline; a timeout closes that socket and
enters the existing bounded reconnect loop. The control screen exposes the
latest handshake error and a manual retry action while reconnecting.

## Performance rules

- Keep control messages small and JSON encoded.
- Do not convert HEVC to images in JavaScript.
- Keep native media queues bounded and drop stale frames under pressure.
- Request a server keyframe after a decoder reset or generation change.
- Move the WebSocket media ingress into native code in a later stage if JS packet delivery becomes the remaining CPU bottleneck; the current module boundary allows that migration without changing the UI.

## Application lifecycle

`ControlScreen` owns the lifetime of its media demand. When the app leaves the
foreground it disables video and audio demand and resets both native sinks, so
the headless service does not continue producing frames for an unavailable
surface. A foreground transition closes any stale socket and opens a new one;
only that new socket is allowed to publish frames or control-lease state. Retry
backoff is active only while the screen is visible and the app is active.
