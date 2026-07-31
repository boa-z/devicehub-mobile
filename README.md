# DeviceHub Mobile

DeviceHub Mobile is a React Native client for connecting to a DeviceHub headless or LAN service. The remote targets are iPhone and iPad devices only. The app can run on iOS or Android; the iOS client is the first platform being hardened for native media playback.

## Current stage

This first client layer provides:

- authenticated service connection with the same access token used by the headless web client;
- device discovery, refresh, connect, and session status polling;
- a device control screen with multi-touch, Home, lock, volume, mute, and rotation commands;
- parsing of the existing `DHV2` HEVC and `DHA1` PCM packets, exposing packet telemetry to the control screen.

The screen intentionally does not claim to decode video or play audio yet. Native iOS VideoToolbox and AVAudioEngine adapters are the next implementation stage. The Android app will use the same protocol layer and later provide MediaCodec/AudioTrack adapters.

## Development

This project uses Expo SDK 57 and must be run with an Expo development build when native media modules are added. Expo Go is sufficient only for the current protocol and UI skeleton.

```sh
npm install
npx tsc --noEmit
npx expo start
```

Enter the DeviceHub service address and the access token printed by `devicehub-headless`. For a phone on the LAN, use the host's LAN address rather than `127.0.0.1`.

## Protocol boundary

The files under `src/protocol` are the only client code that knows the DeviceHub wire format. Screens send typed commands through `DeviceHubSocket`; native media modules will subscribe to `MediaPacket` values without parsing WebSocket frames themselves.

- `DHV2`: 36-byte header followed by an Annex-B HEVC access unit.
- `DHA1`: 12-byte header followed by little-endian signed PCM16 samples.
- HTTP uses `Authorization: Bearer <token>`.
- WebSocket uses `/api/ws?device_id=<selection id>` and the `devicehub-mask`/token subprotocols.

Remote targets must be paired and connected to the host running DeviceHub. This mobile app does not connect directly to iOS devices and does not add Android target-device support.
