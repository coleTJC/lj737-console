import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { inspectDial, parseCustomDial, serializeCustomDial, PIXEL_BYTES } from '../js/watchface.js';
import { buildCapturedLayout } from '../js/builder-ui.js';

const dataset = resolve(dirname(fileURLToPath(import.meta.url)), '../../dial-data/dials');
const load = name => new Uint8Array(readFileSync(resolve(dataset, name)));

test('all six captured dials inspect without crashing', () => {
  for (const name of ['capture1_0928_normal.bin', 'capture1_0949_normal.bin', 'dial_5017.bin', 'dial_6695.bin']) {
    assert.equal(inspectDial(load(name)).kind, 'AA55 normal container');
  }
  for (const name of ['custom_dial_1.bin', 'custom_dial_2.bin']) {
    const details = inspectDial(load(name));
    assert.equal(details.kind, 'Custom glyph container');
    assert.equal(details.custom.resources.length, 28);
    assert.equal(details.custom.framebufferOffset, 3267);
    assert.equal(details.custom.framebuffer.length, PIXEL_BYTES);
  }
});

test('captured custom dials round-trip byte-for-byte through parsed records', () => {
  for (const name of ['custom_dial_1.bin', 'custom_dial_2.bin']) {
    const original = load(name);
    const parsed = parseCustomDial(original);
    assert.deepEqual(serializeCustomDial(parsed), original);
    assert.deepEqual(buildCapturedLayout(parsed.framebuffer), original);
  }
});

test('different background retains derived record structure and updates sum', () => {
  const captured = parseCustomDial(load('custom_dial_1.bin'));
  const newBackground = captured.framebuffer.map(value => value ^ 0xff);
  const generated = buildCapturedLayout(newBackground);
  const parsed = parseCustomDial(generated);
  assert.equal(generated.length, 140547);
  assert.deepEqual(parsed.framebuffer, newBackground);
  assert.equal(parsed.resources.length, 28);
  assert.notEqual(inspectDial(generated).sum, inspectDial(load('custom_dial_1.bin')).sum);
});
