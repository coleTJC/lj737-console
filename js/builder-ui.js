import { WIDTH, HEIGHT, rgb565, decode565, serializeCustomDial, inspectDial } from './watchface.js';
import { CAPTURED_GLYPHS } from './captured-glyphs.js';

const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
export const capturedResources = () => CAPTURED_GLYPHS.resources.map(item => ({ width: item.width, height: item.height, header: decode(item.header), bitmap: decode(item.bitmap) }));
export const buildCapturedLayout = framebuffer => serializeCustomDial({ resources: capturedResources(), trailer: decode(CAPTURED_GLYPHS.trailer), framebuffer });

export function setupBuilder({ selectDial, download, report }) {
  const element = id => document.getElementById(id);
  const canvas = element('image-preview');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const overlay = element('widget-preview').getContext('2d');
  const glyphs = capturedResources();
  let bitmap = null;
  let built = null;
  let generation = 0;
  const glyph = (resource, x, y) => {
    const image = overlay.createImageData(resource.width, resource.height);
    for (let row = 0; row < resource.height; row++) for (let column = 0; column < resource.width; column++) {
      if (!(resource.bitmap[row * Math.ceil(resource.width / 8) + (column >> 3)] & (128 >> (column & 7)))) continue;
      image.data.set([255, 255, 255, 255], (row * resource.width + column) * 4);
    }
    overlay.putImageData(image, x, y);
  };
  const preview = () => {
    overlay.clearRect(0, 0, WIDTH, HEIGHT);
    const now = new Date();
    if (element('preview-time').checked) {
      const digits = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
      for (let index = 0; index < 4; index++) glyph(glyphs[11 + Number(digits[index])], 50 + index * 34 + (index >= 2 ? 8 : 0), 48);
      glyph(glyphs[10], 102, 104);
    }
    if (element('preview-day').checked) for (const [index, digit] of [...String(now.getDate()).padStart(2, '0')].entries()) glyph(glyphs[Number(digit)], 85 + index * 14, 225);
    if (element('preview-weekday').checked) glyph(glyphs[21 + (now.getDay() + 6) % 7], 127, 227);
  };
  const draw = () => {
    built = null;
    element('builder-result').hidden = true;
    element('build-dial').disabled = !bitmap;
    context.fillStyle = '#000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    if (bitmap) {
      const mode = element('image-fit').value;
      const scale = mode === 'stretch' ? null : mode === 'cover' ? Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height) : Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height);
      const zoom = Number(element('image-zoom').value) / 100;
      const width = (scale === null ? WIDTH : bitmap.width * scale) * zoom;
      const height = (scale === null ? HEIGHT : bitmap.height * scale) * zoom;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, (WIDTH - width) / 2 + Number(element('image-x').value), (HEIGHT - height) / 2 + Number(element('image-y').value), width, height);
      context.putImageData(new ImageData(decode565(rgb565(context.getImageData(0, 0, WIDTH, HEIGHT).data)), WIDTH, HEIGHT), 0, 0);
    }
    preview();
  };
  element('image-file').addEventListener('change', async event => {
    const current = ++generation;
    bitmap?.close();
    bitmap = null;
    element('preview-empty').hidden = false;
    draw();
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image under 20 MiB.');
      const loaded = await createImageBitmap(file);
      if (current !== generation) { loaded.close(); return; }
      if (loaded.width * loaded.height > 40000000) { loaded.close(); throw new Error('Choose an image below 40 megapixels.'); }
      bitmap = loaded;
      element('preview-empty').hidden = true;
      draw();
      report('Image loaded; preview includes RGB565 quantization and captured glyphs.');
    } catch (error) { report(error.message, true); }
  });
  for (const id of ['image-fit', 'image-zoom', 'image-x', 'image-y']) element(id).addEventListener('input', draw);
  for (const id of ['preview-time', 'preview-day', 'preview-weekday']) element(id).addEventListener('change', preview);
  element('build-dial').addEventListener('click', () => {
    try {
      if (!bitmap) throw new Error('Choose an image first.');
      built = buildCapturedLayout(rgb565(context.getImageData(0, 0, WIDTH, HEIGHT).data));
      const details = inspectDial(built);
      if (details.kind !== 'Custom glyph container' || details.custom.resources.length !== 28 || details.custom.framebufferOffset !== 3267) throw new Error('Generated dial failed structural validation.');
      element('builder-result').hidden = false;
      element('built-summary').textContent = `${details.size.toLocaleString()} bytes · 240 × 286 RGB565 BE · ${details.custom.resources.length} glyphs · ${details.chunks} chunks · sum 0x${details.sum.toString(16).padStart(8, '0').toUpperCase()}`;
      report('Built and structurally validated. On-watch behavior remains unverified.');
    } catch (error) { report(error.message, true); }
  });
  element('download-built').addEventListener('click', () => { if (built) download(built, 'lj737-custom-dial.bin', 'application/octet-stream'); });
  element('inspect-built').addEventListener('click', () => { if (built) selectDial(built.slice(), 'lj737-custom-dial.bin').catch(error => report(error.message, true)); });
  preview();
}
