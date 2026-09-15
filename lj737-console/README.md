# LJ737 Field Console

A mobile-first, local-first development console for **MOVEMENT / LJ737_MB_V1.5 / V27094**. Plain HTML, CSS and JavaScript; no runtime dependencies, account, build step, or backend.

## Start on a computer

With Node.js 20+ installed, open a terminal in this folder:

```sh
npm start
```

Open **http://localhost:4173** in Chrome or Edge. `npm install` is unnecessary. Do not double-click `index.html`: ES modules and Web Bluetooth need a served origin. The included server binds only to this computer. Set `PORT` to another port if necessary.

## Publish with GitHub Pages

1. Create a public GitHub repository, for example `lj737-console`.
2. Upload **the contents of this folder** to its root: `index.html`, `style.css`, `js/`, `.nojekyll`, and the documentation. Keep the subfolders intact. Upload source files, not just the ZIP. Never upload private captures or session logs.
3. Open **Settings → Pages → Build and deployment → Deploy from a branch**. Select your default branch and **/(root)**, then Save.
4. Wait for deployment and open `https://YOUR-USERNAME.github.io/lj737-console/`. Enable **Enforce HTTPS** when available.

No deployment was performed for you. See [GitHub's Pages quickstart](https://docs.github.com/en/pages/quickstart) for the publishing settings.

## Use from Android

1. Open the HTTPS Pages URL directly in **Chrome for Android**, not an in-app browser. Turn on Bluetooth and grant Chrome the Bluetooth / nearby-device permissions requested by Android. Some versions may also need location permission or location services for scanning.
2. Disconnect or close FitPro/OlyWear and any other app connected to the watch.
3. Tap **Connect watch**, select **MOVEMENT** or **Movement**, and wait for identity and battery reads. Enable **Show all nearby BLE devices** if its advertised name differs.
4. Use explicit **On / Off** controls or **Ping**. Toggle state starts unknown; “sent” means Bluetooth delivered the write, not that a setting was read back.
5. Keep the page visible and phone awake during dial uploads. Backgrounding cancels a transfer. Reconnect after a cancelled or failed upload; no automatic resume or retries.

| Browser | Notes |
| --- | --- |
| Chrome Android | Recommended mobile route; HTTPS required. |
| Edge Android | Availability varies with build; the capability banner checks the actual API. Use Chrome if unavailable. |
| Chrome / Edge on Windows or macOS | Supported route with a working BLE adapter and browser permissions. Managed policies may block access. |
| ChromeOS / Linux | ChromeOS can support the API; Linux support is platform/flag dependent and is not a tested target. |
| Safari, iOS browsers, Firefox | Not supported for this console's Bluetooth connection. |

HTTPS or localhost is required. A phone visiting a computer's plain `http://192.168…` address does **not** get the localhost exception. Bluetooth availability does not guarantee adapter, permissions, or device compatibility. See [Chrome's Web Bluetooth documentation](https://developer.chrome.com/docs/capabilities/bluetooth).

## Watchface workflow

**Captured .bin:** Choose the file in Watchfaces. Review size, header, SHA-256, additive checksum and chunk count. Choose the start metadata matching its capture, check the compatibility acknowledgement, then **Review upload** and confirm. Signature and size are hints, not a full file validator. Ordinary AA55 containers are inspected but their widgets/palettes are not rendered.

**Custom background:** Supply an image plus an **exactly 3,267-byte prefix** from your known-compatible custom dial. Choose center crop, fit with black edges, or stretch. The builder appends 240 × 286 big-endian RGB565 pixels without changing one byte of the prefix: **3,267 + 137,280 = 140,547 bytes**. Download the result or inspect it for upload. No templates are invented or bundled. The inspector can extract the prefix from a separately verified 140,547-byte custom dial. The preview shows the quantized background only, not the template's clock/date overlays. PNG/JPEG/WebP/BMP decoding and EXIF orientation follow the browser; transparent areas are composited onto black.

**Transfer:** Five-byte metadata presets are captured stock `00 00 FF FF FF`, custom #1 `01 01 FF FF FF`, and custom #2 `04 01 FF FF FF`. Their precise slot/style meanings remain uncertain. Upload uses 200-byte file chunks fragmented into serialized 20-byte GATT writes, with a status acknowledgement per chunk. The eight-second wait timeout stops the transfer; cancellation/timeout/failure disconnects to prevent further transfer traffic. No unknown abort command is invented. The watch may remain in its transfer screen until its own timeout.

## Scope and architecture

```text
index.html + style.css + js/app.js + js/builder-ui.js  (UI)
                         ↓
js/protocol.js + js/watchface.js                      (LJ737 / binary logic)
                         ↓
js/transport.js                                      (Web Bluetooth GATT)
```

- Live reads: manufacturer, model, serial, firmware, hardware, software, System ID, IEEE certification bytes, PnP ID, battery. Missing fields show unavailable. Captured board/firmware labels are separate from live values.
- Safe controls use exact captured vibration / raise-to-wake / find packets. Raw hex permits at most 512 bytes on normal `6E400002` only and requires a fresh confirmation for every send.
- The log retains the last 500 events in memory, with UTC timestamps, filtering, clear and JSON export. Reload clears all state. Exported logs may contain device data; review before sharing.
- The OTA tab is a captured reference only. AE00/AE01/AE02 are never requested, subscribed, or written. Firmware flashing is absent.
- No analytics, network uploads, cloud storage, remote fonts, RSSI claim, or raw HCI access. A network is needed to initially load the hosted page; this is not an installable offline PWA.

## Verification and limitations

```sh
npm test
```

All **16 Node tests passed**, covering literal captured commands, chunk checksums, framing, RGB565/prefix preservation, ACK sequencing, timeout/cancellation, and serialized Bluetooth writes using a fake GATT boundary. This environment blocks child-process creation, so verification used Node.js 24's single-process runner entirely inside the sandbox:

```sh
node --test --test-isolation=none
```

JavaScript syntax checks passed. Browser checks verified initial disconnected state, desktop and 390px layouts, captured-file inspection (140,547 bytes / 703 chunks), wrong-size prefix rejection, building and inspecting a 140,547-byte custom file, raw hex validation, and disabled OTA controls. Physical Bluetooth operations, on-watch image appearance, Android hardware behavior and raw-send confirmation while connected still require testing with the watch.

Detailed captured bytes, corrections and evidence: [PROTOCOL.md](PROTOCOL.md).
