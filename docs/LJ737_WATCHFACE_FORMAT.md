# LJ737 watchface format — capture-backed notes

## Confirmed

- Four captured normal dials begin with `AA 55`; their sizes are 101064, 114137, 102370 and 136282 bytes. Their resource tables are not yet decoded by this app.
- Two FitPro custom dials are 140547 bytes each. Their first 3267 bytes are identical; the remaining 137280 bytes differ with the chosen background.
- The trailing image is 240 × 286, RGB565 big-endian, at offset 3267 (`0x0CC3`) **for these two captures**.
- The common leading area contains 28 sequential `58 63` glyph records plus a 10-byte trailer. Every record has a 14-byte header; width and height are unsigned little-endian words at header offsets 2 and 4. The bitmap is one bit per pixel, MSB-first, row-aligned to whole bytes, with length `ceil(width / 8) × height`. This accounts exactly for the first 3257 bytes.
- Records 0–9 are 12 × 20 digit glyphs; record 10 is a 36 × 2 separator; records 11–20 are 30 × 50 digit glyphs; records 21–27 are 36 × 13 weekday glyphs Monday–Sunday. The bitmaps render as those symbols.
- Re-serializing records, trailer and framebuffer without edits reproduces either captured custom dial byte-for-byte.
- Transfer uses FitPro group `1F`: begin `02`, 200-byte chunks `01`, finish `03`. Chunk payload is big-endian sequence, data, big-endian additive sum of sequence bytes plus data modulo 65536. Finish carries big-endian total length and 32-bit additive byte sum. All six supplied transfers were checksum-validated in the dataset manifest.

## Likely

- The 28 custom glyphs are a fixed-size clock/date resource atlas. The device firmware probably decides placement from the selected transfer metadata or other state, not from per-glyph coordinates in these records. This has **not** been confirmed by varying the template.
- The 14-byte record header contains `02 00 0E 00 FF FF 00 00` after the dimensions in every supplied custom record. Its individual field meanings are not established.

## Unknown and deliberately not generated

- The 10-byte trailer is `16 01 F0 00 1E 01 00 00 0A 00`. Its field meanings are unknown; the builder preserves these captured bytes. It may contain image/container metadata, but calling it widget layout would be speculative.
- The custom captures have identical resources and only background pixels differ. Consequently they give **no evidence** for changing on-watch widget coordinates, disabling widgets, changing digit style, or switching 12/24-hour mode. The builder does not claim to perform those changes; preview checkboxes are illustrative only.
- A prefix size of 3267 is confirmed only for this one captured layout, not every LJ737 custom template.
- Normal-dial widget IDs `05` (hours), `06` (minutes), `0A` (day), `0B` (weekday) and flags `08` (indexed palette), `10` (raw RGB565) were mapped in earlier captures, but this app does not assume their normal-dial table structure applies to the different `58 63` custom container.
- Transfer-start metadata differs between captures: `01 01 FF FF FF` and `04 01 FF FF FF` for custom dials. Its slot/style semantics are unresolved. The user must choose matching metadata and explicitly confirm before upload.

The bundled glyph source in `js/captured-glyphs.js` is the 28 individual record headers/bitmaps and trailer extracted from both identical custom prefixes, not an unexplained complete prefix. `parseCustomDial` and `serializeCustomDial` in `js/watchface.js` derive all record offsets from dimensions.
