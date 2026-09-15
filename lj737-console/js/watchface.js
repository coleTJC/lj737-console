export const WIDTH = 240;
export const HEIGHT = 286;
export const PREFIX_SIZE = 3267;
export const PIXEL_BYTES = WIDTH * HEIGHT * 2;
export const MAX_DIAL_BYTES = 4 * 1024 * 1024;

export function rgb565(rgba) {
  if (rgba.length % 4) throw new Error('Expected RGBA pixels.');
  const bytes = new Uint8Array(rgba.length / 2);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 2) {
    const pixel = (rgba[source] >> 3) << 11 | (rgba[source + 1] >> 2) << 5 | rgba[source + 2] >> 3;
    bytes[target] = pixel >> 8;
    bytes[target + 1] = pixel & 255;
  }
  return bytes;
}

export function decode565(bytes) {
  if (bytes.length !== PIXEL_BYTES) throw new Error('Expected 240 × 286 RGB565 pixels.');
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let source = 0, target = 0; source < bytes.length; source += 2, target += 4) {
    const pixel = bytes[source] << 8 | bytes[source + 1];
    rgba[target] = Math.round((pixel >> 11) * 255 / 31);
    rgba[target + 1] = Math.round((pixel >> 5 & 63) * 255 / 63);
    rgba[target + 2] = Math.round((pixel & 31) * 255 / 31);
    rgba[target + 3] = 255;
  }
  return rgba;
}

export function packageDial(prefix, pixels) {
  if (prefix.length !== PREFIX_SIZE) throw new Error('The template prefix must be exactly 3,267 bytes.');
  if (pixels.length !== PIXEL_BYTES) throw new Error('The image must be exactly 137,280 RGB565 bytes.');
  const bytes = new Uint8Array(PREFIX_SIZE + PIXEL_BYTES);
  bytes.set(prefix);
  bytes.set(pixels, PREFIX_SIZE);
  return bytes;
}

export function inspectDial(bytes) {
  if (!bytes.length || bytes.length > MAX_DIAL_BYTES) throw new Error('Choose a non-empty file under 4 MiB.');
  return {
    size: bytes.length,
    chunks: Math.ceil(bytes.length / 200),
    sum: bytes.reduce((total, value) => (total + value) >>> 0, 0),
    kind: bytes.length === PREFIX_SIZE + PIXEL_BYTES ? 'Custom-size candidate' : bytes[0] === 0xaa && bytes[1] === 0x55 ? 'AA55 container' : 'Unrecognized binary',
  };
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) return 'Unavailable outside a secure context';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
