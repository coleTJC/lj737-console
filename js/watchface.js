export const WIDTH = 240;
export const HEIGHT = 286;
export const PREFIX_SIZE = 3267;
export const PIXEL_BYTES = WIDTH * HEIGHT * 2;
export const MAX_DIAL_BYTES = 4 * 1024 * 1024;
const GLYPH_SIGNATURE = 0x63;

export function parseCustomDial(bytes) {
  if (bytes.length < PIXEL_BYTES + 14) throw new Error('Custom dial is too short.');
  const framebufferOffset = bytes.length - PIXEL_BYTES;
  const resources = [];
  let offset = 0;
  while (offset + 14 <= framebufferOffset && bytes[offset] === 0x58 && bytes[offset + 1] === GLYPH_SIGNATURE) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 14);
    const width = view.getUint16(2, true);
    const height = view.getUint16(4, true);
    const stride = Math.ceil(width / 8);
    const length = 14 + stride * height;
    if (!width || !height || offset + length > framebufferOffset) throw new Error('Invalid custom glyph dimensions or length.');
    resources.push({ offset, width, height, stride, length, header: bytes.slice(offset, offset + 14), bitmap: bytes.slice(offset + 14, offset + length) });
    offset += length;
  }
  if (!resources.length) throw new Error('No LJ737 custom glyph records found.');
  return { kind: 'Custom glyph container', resources, trailer: bytes.slice(offset, framebufferOffset), framebuffer: bytes.slice(framebufferOffset), framebufferOffset, width: WIDTH, height: HEIGHT };
}

export function serializeCustomDial({ resources, trailer, framebuffer }) {
  if (framebuffer.length !== PIXEL_BYTES) throw new Error('Expected a 240 × 286 RGB565 framebuffer.');
  const length = resources.reduce((total, resource) => total + 14 + Math.ceil(resource.width / 8) * resource.height, 0) + trailer.length + framebuffer.length;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const resource of resources) {
    const stride = Math.ceil(resource.width / 8);
    if (resource.header.length !== 14 || resource.bitmap.length !== stride * resource.height || resource.header[0] !== 0x58 || resource.header[1] !== GLYPH_SIGNATURE) throw new Error('Invalid captured glyph record.');
    bytes.set(resource.header, offset);
    const view = new DataView(bytes.buffer, offset, 14);
    view.setUint16(2, resource.width, true);
    view.setUint16(4, resource.height, true);
    bytes.set(resource.bitmap, offset + 14);
    offset += 14 + resource.bitmap.length;
  }
  bytes.set(trailer, offset);
  offset += trailer.length;
  bytes.set(framebuffer, offset);
  return bytes;
}

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
  let custom = null;
  if (bytes[0] === 0x58 && bytes[1] === GLYPH_SIGNATURE) {
    try { custom = parseCustomDial(bytes); } catch { /* Preserve generic inspection for malformed or unknown files. */ }
  }
  return {
    size: bytes.length,
    chunks: Math.ceil(bytes.length / 200),
    sum: bytes.reduce((total, value) => (total + value) >>> 0, 0),
    kind: custom ? 'Custom glyph container' : bytes[0] === 0xaa && bytes[1] === 0x55 ? 'AA55 normal container' : bytes.length === PREFIX_SIZE + PIXEL_BYTES ? 'Custom-size candidate' : 'Unrecognized binary',
    custom,
  };
}

export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) return 'Unavailable outside a secure context';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
