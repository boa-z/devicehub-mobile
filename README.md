# DeviceHub Mobile

DeviceHub Mobile is a React Native client for connecting to a DeviceHub headless or LAN service. The remote targets are iPhone and iPad devices only. The app can run on iOS or Android; the iOS client is the first platform being hardened for native media playback.

## Current stage

This first client layer provides:

- authenticated service connection with the same access token used by the headless web client;
- Bonjour/NSD discovery of headless services on a trusted local network, followed by token-authenticated HTTP/WebSocket access;
- Keychain/Keystore-backed storage for the last connection (the token is never written to a plain-text app preference);
- device discovery, refresh, USB trust pairing, connect, disconnect, retry, and session status polling;
- a device control screen with multi-touch, Home, lock, volume, mute, and rotation commands;
- text paste from the mobile keyboard into the active iPhone or iPad;
- confirmed device restart and shutdown actions;
- an installed-app panel that lists user apps and can launch or stop them through the host;
- parsing of the existing `DHV2` HEVC and `DHA1` PCM packets, exposing packet telemetry to the control screen.
- foreground-aware control recovery: backgrounding releases media demand and native queues, while returning to the control screen rebuilds the socket before resuming playback.

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

## Nightly iOS IPA

The `Publish iOS Nightly IPA` workflow builds a Release iOS archive without Apple signing and publishes it to the `nightly` prerelease. It runs for pushes to `main`, once per day, or manually from the Actions tab. The workflow also keeps a 14-day Actions artifact for troubleshooting.

Download `devicehub-mobile-unsigned.ipa` from the nightly release and verify it with the accompanying `.sha256` file. The IPA contains an unsigned `.app`; it cannot be installed directly on an iPhone or iPad. Installation requires your own Apple development or distribution certificate, a matching provisioning profile, and a re-signing step. It is not an App Store or TestFlight package.

The connection screen discovers `_devicehub._tcp.local.` services when the headless server was started with `--allow-lan`. Select a discovered service to fill its address, then enter the access token printed by `devicehub-headless`. Discovery never carries the token. Manual addresses remain supported; for a phone on the LAN, use the host's LAN address rather than `127.0.0.1`.

The headless server currently uses HTTP for a trusted local network, so Android's cleartext permission is enabled for this client. Do not expose that listener directly to the Internet; use a TLS reverse proxy or a private VPN before using it outside a trusted LAN.

USB devices whose `pairing` state is `unpaired` show a **Trust** action. Keep
the iPhone or iPad unlocked and approve the trust prompt; the request can wait
for up to 100 seconds because the server waits for that device confirmation.
After pairing, refresh the list and connect the device. A connected session can
be released with **Disconnect**, and failed sessions expose **Retry**.

## Protocol boundary

The files under `src/protocol` are the only client code that knows the DeviceHub wire format. Screens send typed commands through `DeviceHubSocket`; native media modules will subscribe to `MediaPacket` values without parsing WebSocket frames themselves.

- `DHV2`: 36-byte header followed by an Annex-B HEVC access unit.
- `DHA1`: 12-byte header followed by little-endian signed PCM16 samples.
- HTTP uses `Authorization: Bearer <token>`.
- WebSocket uses `/api/ws?device_id=<selection id>` and the `devicehub-mask`/token subprotocols.

Remote targets must be paired and connected to the host running DeviceHub. This mobile app does not connect directly to devices and does not add Android target-device support: the controlled target set is iPhone and iPad only. Android is a client platform, not a target platform.

The mobile app can launch or stop applications already installed on the target through the authenticated host API. It intentionally does not install, sign, or sideload applications.

When the control socket drops in the foreground, the client retries with bounded exponential backoff (500 ms to 8 s). Backgrounding the app releases media demand and flushes native sinks instead of keeping a stale stream alive; returning to the foreground forces a fresh authenticated socket. Leaving the control screen cancels retries, flushes the native media sinks, and releases media demand.
