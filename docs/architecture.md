# Client architecture

DeviceHub Mobile is a control client. The remote device set is intentionally limited to iPhone and iPad. The client application can run on iOS or Android; Android is a client platform, not a remote-device transport.

## Boundaries

```text
React Native screens
  -> protocol client (HTTP, WebSocket, typed commands)
  -> media adapter (native view and audio sink)
  -> iOS VideoToolbox/AVAudioEngine
```

`src/protocol` owns the wire contract. It knows the Bearer token, `/api/status`, `/api/ws`, control messages, and the `DHV2`/`DHA1` packet headers. Screens do not parse packets or construct WebSocket URLs.

`modules/devicehub-media` owns platform media primitives. On iOS, HEVC access units are converted to `CMSampleBuffer` values and queued to `AVSampleBufferDisplayLayer`; PCM16 is converted to `AVAudioPCMBuffer` and scheduled on `AVAudioPlayerNode`. The display queue drops frames when the layer is not ready, so a stalled native renderer cannot grow an unbounded JS queue.

The access token is stored only through `expo-secure-store` (Keychain on iOS and Keystore-backed storage on Android). A user changing the server explicitly clears the saved credential.

The Android module currently exposes the same API as a no-op adapter. This keeps connection and input behavior testable on Android while the future MediaCodec/AudioTrack implementation can be added without changing screens or the server protocol.

## Handshake

Every mobile socket sends `client_hello` after opening:

- protocol version;
- client platform (`ios` or `android`);
- client version;
- media and input capabilities.

The server replies with `server_hello`, including the supported packet formats and target platform list. The current target list contains only `ios` because DeviceHub controls iPhone/iPad sessions.

## Performance rules

- Keep control messages small and JSON encoded.
- Do not convert HEVC to images in JavaScript.
- Keep native media queues bounded and drop stale frames under pressure.
- Request a server keyframe after a decoder reset or generation change.
- Move the WebSocket media ingress into native code in a later stage if JS packet delivery becomes the remaining CPU bottleneck; the current module boundary allows that migration without changing the UI.
