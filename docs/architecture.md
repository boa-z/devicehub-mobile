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

Text paste is also an authenticated, device-scoped HTTP operation. It remains
outside the media WebSocket because it has request validation and a bounded
completion response; the server rejects empty text, NUL bytes, and payloads over
1,024 characters.

Restart and shutdown use authenticated device-scoped HTTP commands rather than
WebSocket input messages. The mobile UI requires an explicit destructive-action
confirmation and uses a 12-second request deadline, slightly longer than the
server's 10-second device command budget.

Virtual location follows the same device-scoped HTTP boundary. The client reads
the backend status before opening the editor, validates latitude/longitude
locally, and exposes an explicit clear action so a test can restore the real
device location. The server remains responsible for DVT/legacy backend choice
and device readiness errors.

Device details are fetched on demand rather than with the 2-second inventory
poll. This keeps metadata queries off the control path and lets the server's
bounded read-only timeout surface as a retryable panel error. Numeric storage
and battery values remain typed so the UI can distinguish an unavailable value
from zero.

The control screen also uses the server's read-only device extensions on demand:
screenshots and wallpaper-like image resources are loaded through authenticated
native image sources, while companion devices and home-screen layout data are
decoded as typed JSON. Device renaming remains a bounded JSON command. None of
these requests share the media socket or run during initial connection, so a
slow CoreDevice metadata service cannot pause video input.

App icons use the server's image endpoint directly through the native image
loader. Each request carries both the bearer token and the selected session ID;
an icon failure is isolated to that row and falls back to an initial instead of
failing the app list request.

Application console capture is explicitly user-started. The client stores the
server's sequence cursor, requests only lines after that cursor once per second,
and stops the console service when the panel closes. The server's bounded line
and byte retention remains the source of truth; a cursor reset replaces the
mobile buffer instead of duplicating output.

The mobile Files action is an authenticated AFC browser. It lists one
directory at a time and keeps the current path in the screen, while rename,
directory creation, and deletion use the server's device-scoped JSON routes.
Single-file import uses Expo's document provider and the server's bounded raw
browser-upload route. Single-file export uses the same device-scoped download
route, writes to the native cache with Expo FileSystem, and opens the platform
share sheet. The protocol client only constructs authenticated transfer URLs;
native file I/O stays in the screen boundary.

Application storage uses the same screen and transfer boundary but a different
server namespace: `/api/device/apps/{bundle_id}/storage`. The client sends an
explicit `scope` (`documents` or `container`) with every request and resets the
path to `/` when the scope changes. The server decides whether the selected app
can expose Documents or its container; a rejected scope is shown as a scoped
panel error instead of falling back to public AFC. Only individual files can
be imported or exported from mobile, while directory creation, rename, and
delete remain device-side operations.

The control aggregation modal is deliberately a projection of the desktop
fullscreen device toolbars, not a second device-management navigator. It
contains the seven hardware actions, reconnect, both rotation actions, a
screenshot action, and text paste. App lifecycle, AFC, performance, location,
metadata, restart, and shutdown actions remain outside that modal so the same
control surface has a stable meaning on both clients.

Performance and device logs use separate, demand-gated HTTP controls. The
mobile workbench polls performance snapshots and process inventory at a bounded
interval, then polls logs by sequence cursor so old entries are not duplicated.
It records ownership of any sampling or log demand started by that panel and
releases only those demands during cleanup; an already-running demand owned by
another browser or desktop client is left untouched.

Device inventory operations remain separate from the active WebSocket: refresh,
connect, disconnect, and reconnect are asynchronous manager commands. USB trust
pairing and trust removal use the same selection ID but may wait for an on-device
confirmation, so the client gives those requests a longer deadline than normal
status calls. A pairing result is interpreted by the protocol client before the
screen updates its device inventory.

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
