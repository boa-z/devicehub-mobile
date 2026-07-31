# DeviceHub Mobile

DeviceHub Mobile is a React Native client for connecting to a DeviceHub headless or LAN service. The remote targets are iPhone and iPad devices only. The app can run on iOS or Android; the iOS client is the first platform being hardened for native media playback.

## Current stage

This first client layer provides:

- authenticated service connection with the same access token used by the headless web client;
- Keychain/Keystore-backed storage for the last connection (the token is never written to a plain-text app preference);
- device discovery, refresh, connect, and session status polling;
- a device control screen with multi-touch, Home, lock, volume, mute, and rotation commands;
- parsing of the existing `DHV2` HEVC and `DHA1` PCM packets, exposing packet telemetry to the control screen.

Both client platforms use native media sinks. iOS uses `AVSampleBufferDisplayLayer` and `AVAudioEngine`; Android uses `MediaCodec` and `AudioTrack`. The media queues are bounded and drop stale packets under pressure, so the React Native thread remains available for touch input and connection state.

## Development

This project uses Expo SDK 57. Native media requires an Expo development build; Expo Go deliberately shows a clear fallback instead of pretending to decode the stream.

```sh
npm install
npx tsc --noEmit
npx expo prebuild --platform ios
npx pod-install ios
npm run ios
```

For an Android development build, install JDK 17 and the Android SDK, then run:

```sh
npx expo prebuild --platform android
npm run android
```

The generated native projects and Pods are local build products and are intentionally not committed.

Pull requests run the same TypeScript and Expo bundle checks plus Android Debug and iOS Simulator development builds in GitHub Actions. A green JavaScript bundle check does not replace either native build: native media code is compiled separately for each platform.

Enter the DeviceHub service address and the access token printed by `devicehub-headless`. For a phone on the LAN, use the host's LAN address rather than `127.0.0.1`.

The headless server currently uses HTTP for a trusted local network, so Android's cleartext permission is enabled for this client. Do not expose that listener directly to the Internet; use a TLS reverse proxy or a private VPN before using it outside a trusted LAN.

## Protocol boundary

The files under `src/protocol` are the only client code that knows the DeviceHub wire format. Screens send typed commands through `DeviceHubSocket`; native media modules will subscribe to `MediaPacket` values without parsing WebSocket frames themselves.

- `DHV2`: 36-byte header followed by an Annex-B HEVC access unit.
- `DHA1`: 12-byte header followed by little-endian signed PCM16 samples.
- HTTP uses `Authorization: Bearer <token>`.
- WebSocket uses `/api/ws?device_id=<selection id>` and the `devicehub-mask`/token subprotocols.

Remote targets must be paired and connected to the host running DeviceHub. This mobile app does not connect directly to devices and does not add Android target-device support: the controlled target set is iPhone and iPad only. Android is a client platform, not a target platform.

When the control socket drops, the client retries with bounded exponential backoff (500 ms to 8 s). Leaving the control screen cancels the retry, flushes the native media sinks, and releases media demand.
