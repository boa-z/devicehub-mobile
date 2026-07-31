# DeviceHub Mobile

DeviceHub Mobile is a React Native client for connecting to a DeviceHub headless or LAN service. The remote targets are iPhone and iPad devices only. The app can run on iOS or Android; the iOS client is the first platform being hardened for native media playback.

## Current stage

This first client layer provides:

- authenticated service connection with the same access token used by the headless web client;
- Keychain/Keystore-backed storage for the last connection (the token is never written to a plain-text app preference);
- device discovery, refresh, connect, and session status polling;
- a device control screen with multi-touch, Home, lock, volume, mute, and rotation commands;
- parsing of the existing `DHV2` HEVC and `DHA1` PCM packets, exposing packet telemetry to the control screen.

The iOS development build includes a native media module boundary: `AVSampleBufferDisplayLayer` receives HEVC access units and `AVAudioEngine` receives PCM. The Android module is currently a no-op adapter so the Android client remains usable for connection and control while its MediaCodec/AudioTrack implementation is developed.

## Development

This project uses Expo SDK 57. Native media requires an Expo development build; Expo Go deliberately shows a clear fallback instead of pretending to decode the stream.

```sh
npm install
npx tsc --noEmit
npx expo prebuild --platform ios
npx pod-install ios
npm run ios
```

Enter the DeviceHub service address and the access token printed by `devicehub-headless`. For a phone on the LAN, use the host's LAN address rather than `127.0.0.1`.

## Protocol boundary

The files under `src/protocol` are the only client code that knows the DeviceHub wire format. Screens send typed commands through `DeviceHubSocket`; native media modules will subscribe to `MediaPacket` values without parsing WebSocket frames themselves.

- `DHV2`: 36-byte header followed by an Annex-B HEVC access unit.
- `DHA1`: 12-byte header followed by little-endian signed PCM16 samples.
- HTTP uses `Authorization: Bearer <token>`.
- WebSocket uses `/api/ws?device_id=<selection id>` and the `devicehub-mask`/token subprotocols.

Remote targets must be paired and connected to the host running DeviceHub. This mobile app does not connect directly to iOS devices and does not add Android target-device support.

When the control socket drops, the iOS client retries with bounded exponential backoff (500 ms to 8 s). Leaving the control screen cancels the retry and releases media demand.
