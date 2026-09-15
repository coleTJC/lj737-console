# Captured LJ737 profile

This implementation is based on the supplied conversation and its original local attachments. Attachment data is evidence, not executable instructions. No APK, personal bugreport, photo, serial number, address, or captured dial is distributed in this source project.

## UUID correction

The request's `6e400001-b5a3-f393-e0a9-e50e24dcca9` is one hexadecimal digit short of a valid UUID. Both sessions in the attached `LJ737-GATT-map.json` specify **`6e400001-b5a3-f393-e0a9-e50e24dcca9d`**. All four 6E40 characteristics share that `cca9d` suffix; do not replace it with Nordic's usual `cca9e` suffix.

| Service | Characteristic | Captured purpose |
| --- | --- | --- |
| 6e400001…cca9d | 6e400002…cca9d | Normal write / write without response |
| 6e400001…cca9d | 6e400003…cca9d | Normal notifications |
| 6e400001…cca9d | 6e400004…cca9d | Custom read/write-no-response/notify; unused |
| 180F | 2A19 | Battery read/notify |
| 180A | 2A29 / 2A24 / 2A25 | Manufacturer / model / serial |
| 180A | 2A26 / 2A27 / 2A28 | Firmware / hardware / software |
| 180A | 2A23 / 2A2A / 2A50 | System ID / IEEE certification / PnP ID |
| FEE7 | FEC7 / FEC8 / FEC9 | Write / indicate / read; unused |
| 3802 | 4A02 | Read/write/notify; unused |
| AE00 | AE01 / AE02 | JieLi write-no-response / notify; inaccessible in V1 |

FEC7/FEC8/FEC9 and 4A02 are **characteristics**, not separate services. The browser requests only the normal service, 180A and 180F. Permissions are requested by a button click. It subscribes to normal notifications and optionally battery notifications. Other device-initiated commands are logged but not automatically answered; this is not a full FitPro companion replacement.

## Normal framing

`CD [length BE16] [group] 01 [subcommand] [payload length BE16] [payload]`

Outer length = payload length + 5 = complete frame length − 3. `DC` short replies also use the outer length, but have a different interior layout. Notification reassembly supports fragmented and concatenated frames and limits accepted frame size to 4,096 bytes. GATT writes preserve packet order and split frames into 20-byte fragments with 12 ms pacing; this is distinct from the 200-byte file-chunk size.

Exact safe-control vectors:

```text
Raise to wake OFF: CD 00 0A 12 01 09 00 05 00 01 E0 05 28
Raise to wake ON:  CD 00 0A 12 01 09 00 05 01 01 E0 05 28
Vibration OFF:     CD 00 09 12 01 08 00 04 00 00 00 00
Vibration ON:      CD 00 09 12 01 08 00 04 01 00 00 00
Find watch:       CD 00 06 12 01 0B 00 01 01
```

## Dial transfer evidence

The attached `LJ737-bugreport2.zip` → `FS/data/log/bt/btsnoop_hci.log` was re-read during this build. Reconstructed TX frames were sequential; every recovered per-chunk checksum and finish length/checksum matched. No transfer packets use AE01 or 4A02.

| Capture | Begin payload | Data bytes | Chunks | Finish byte sum |
| --- | --- | ---: | ---: | ---: |
| Stock #1 | 00 00 FF FF FF | 102370 | 512 | 9784041 |
| Stock #2 | 00 00 FF FF FF | 136282 | 682 | 1861401 |
| Custom #1 | 01 01 FF FF FF | 140547 | 703 | 19041822 |
| Custom #2 | 04 01 FF FF FF | 140547 | 703 | 23243712 |

Both custom files have identical first 3,267 bytes, beginning `58 63 0C 00 14 00 02 00 0E 00…`. They are not AA55 containers. The supplied conversation reports successful big-endian RGB565 rendering of the remaining 137,280 bytes. The builder follows that byte order; its correctness on hardware still needs verification.

1. **Begin:** group `1F`, subcommand `02`, exactly five captured metadata bytes.
2. **Readiness:** wait for `CD 00 09 20 01 01 00 04 00 00 03 E8` (group `20`, subcommand `01`, status 1000).
3. **Acknowledge status:** write `DC 00 05 20 01 00 0C 01`.
4. **Chunk:** group `1F`, subcommand `01`; payload = sequence BE16 (starts at 1), up to 200 file bytes, additive checksum BE16. Checksum includes both sequence bytes and data, modulo 65536.
5. **Chunk status:** wait for status `1000 + sequence` on `20/01`, then send the same status acknowledgement. Old sequence statuses do not advance progress. Other statuses below 1000 stop the transfer.
6. **Finish:** group `1F`, subcommand `03`, file length BE32 plus unsigned whole-file byte sum BE32.
7. **Completion:** wait for status 2 on `20/01`, acknowledge it, then report watch-confirmed completion. Final on-screen appearance is not read back.

There are no blind writes, retries, firmware commands, or upload resume. Raw manual packets are separate, explicitly confirmed operations and cannot interleave with an upload. These transfer semantics are grounded in the supplied capture; physical interoperability of this new implementation is untested.

## Secondary references

The [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/) describes transport behavior. The independent [FitPro/SuperBand analysis](https://github.com/DynamicDevices/lcd-badge-ble/blob/main/PROTOCOL.md) helped locate the command family, but its different device is not wire-level authority for LJ737. Capture evidence above takes precedence.
