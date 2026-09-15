import { WIDTH, HEIGHT, PREFIX_SIZE, rgb565, decode565, packageDial } from './watchface.js';

export function setupBuilder({ selectDial, download, report }) {
  const element = id => document.getElementById(id);
  const canvas = element('image-preview');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let bitmap = null;
  let prefix = null;
  let built = null;
  let imageGeneration = 0;
  let prefixGeneration = 0;
  const invalidate = () => {
    built = null;
    element('builder-result').hidden = true;
    element('build-dial').disabled = !bitmap || !prefix;
  };
  const draw = () => {
    invalidate();
    context.fillStyle = '#000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    if (!bitmap) return;
    const mode = element('image-fit').value;
    let width = WIDTH;
    let height = HEIGHT;
    if (mode !== 'stretch') {
      const scale = mode === 'cover' ? Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height) : Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height);
      width = bitmap.width * scale;
      height = bitmap.height * scale;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
    const quantized = decode565(rgb565(context.getImageData(0, 0, WIDTH, HEIGHT).data));
    context.putImageData(new ImageData(quantized, WIDTH, HEIGHT), 0, 0);
  };
  element('image-file').addEventListener('change', async event => {
    const generation = ++imageGeneration;
    bitmap?.close();
    bitmap = null;
    element('preview-empty').hidden = false;
    draw();
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image under 20 MiB.');
      const loaded = await createImageBitmap(file);
      if (generation !== imageGeneration) { loaded.close(); return; }
      if (loaded.width * loaded.height > 40000000) { loaded.close(); throw new Error('Choose an image below 40 megapixels.'); }
      bitmap = loaded;
      element('preview-empty').hidden = true;
      draw();
      report('Image loaded. Preview includes RGB565 color quantization.');
    } catch (error) { report(error.message, true); }
  });
  element('prefix-file').addEventListener('change', async event => {
    const generation = ++prefixGeneration;
    prefix = null;
    invalidate();
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size !== PREFIX_SIZE) throw new Error('Choose the exact 3,267-byte template prefix. A full dial is not a prefix.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation !== prefixGeneration) return;
      prefix = bytes;
      element('builder-status').textContent = 'Template loaded: 3,267 bytes, preserved exactly. The preview excludes its clock and date widgets.';
      invalidate();
    } catch (error) { report(error.message, true); }
  });
  element('image-fit').addEventListener('change', draw);
  element('build-dial').addEventListener('click', () => {
    try {
      if (!bitmap || !prefix) throw new Error('Choose an image and template first.');
      built = packageDial(prefix, rgb565(context.getImageData(0, 0, WIDTH, HEIGHT).data));
      element('builder-result').hidden = false;
      element('built-summary').textContent = '140,547 bytes · original prefix + 137,280 image bytes';
      report('Custom dial built locally. Choose Download or Inspect for upload.');
    } catch (error) { report(error.message, true); }
  });
  element('download-built').addEventListener('click', () => {
    if (built) download(built, 'lj737-custom-dial.bin', 'application/octet-stream');
  });
  element('inspect-built').addEventListener('click', () => {
    if (built) selectDial(built.slice(), 'lj737-custom-dial.bin').catch(error => report(error.message, true));
  });
}
