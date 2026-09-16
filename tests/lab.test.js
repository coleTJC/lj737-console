import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, QUICK_CONTROLS, commandPayload, decodePacket, knownDevice } from '../js/commands.js';
import { frame, hex } from '../js/protocol.js';
import { exportSession, importSession } from '../js/session.js';
import { transferPreview } from '../js/transfer-preview.js';

test('lab payloads reproduce captured alarm and reminder operations', () => {
  assert.equal(hex(commandPayload('alarm', { operation: 'set', bytes: [106,94,199,136,31] })), '6A 5E C7 88 1F');
  assert.equal(commandPayload('alarm', { operation: 'delete' }).length, 0);
  assert.equal(hex(commandPayload('sedentary', { enabled: false, bytes: [0,1,0,150,4,8,22,127] })), '00 00 00 96 04 08 16 7F');
});

test('compact reference controls cover every mapped command group', () => {
  assert.deepEqual(QUICK_CONTROLS.map(item => item.command), [
    'vibration','wake','find','notifications','alarm','sedentary','camera','heart','ecg','watchfaces',
  ]);
  assert.deepEqual(QUICK_CONTROLS.find(item => item.command === 'alarm').actions.map(action => action.label), ['Set captured','Delete?']);
  assert.deepEqual(QUICK_CONTROLS.find(item => item.command === 'notifications').actions.map(action => action.label), ['SMS off','SMS test on*']);
  assert.equal(QUICK_CONTROLS.find(item => item.command === 'watchfaces').mapping,'1F / 02, 01, 03');
});

test('SMS test changes only the explicitly selected bit and preserves other bytes', () => {
  const bytes = [128,1,2,3,4,5,6,7,8,9,10,11];
  assert.deepEqual([...commandPayload('notifications', { bytes, enabled: true, index: 3, bit: 2 })], [128,1,2,7,4,5,6,7,8,9,10,11]);
  assert.deepEqual([...commandPayload('notifications', { bytes, enabled: false, index: 3, bit: 0 })], [128,1,2,2,4,5,6,7,8,9,10,11]);
  assert.throws(() => commandPayload('notifications', { bytes, enabled: true, index: 12, bit: 0 }));
});

test('invalid bytes and missing booleans cannot become silently truncated commands', () => {
  for (const value of [-1,256,1.5,NaN]) assert.throws(() => commandPayload('alarm', { operation: 'set', bytes: [value,0,0,0,0] }));
  assert.throws(() => commandPayload('camera', { enabled: 'false' }));
  assert.throws(() => commandPayload('alarm', { operation: 'set', bytes: [] }));
  assert.throws(() => frame(256, 1));
  assert.throws(() => frame(18, -1));
});

test('decoding recognizes CD settings, DC acknowledgements, and transfer status', () => {
  assert.match(decodePacket(frame(18,12,Uint8Array.of(1))), /Camera/);
  assert.match(decodePacket(Uint8Array.of(220,0,5,18,9,0,9,1)), /Raise.*reply/i);
  assert.match(decodePacket(frame(32,1,Uint8Array.of(0,0,3,232))), /1000/);
  assert.equal(decodePacket(Uint8Array.of(205,0)), 'Fragment / unrecognized');
  assert.equal(COMMANDS.ota.safety, 'Dangerous');
});

test('known device separates observed identity from captured display size', () => {
  assert.match(knownDevice({Hardware:'LJ737_MB_V1.5',Firmware:'V27094','IEEE certification':'4C (LJ737(D))'}), /Known device/);
  assert.match(knownDevice({Hardware:'LJ737_MB_V1.5'}), /not read/);
  assert.match(knownDevice({}), /not read/);
});

test('JSON and CSV session round trips preserve multiline and quoted content', () => {
  const entries = [{time:'2026-09-15T12:00:00.000Z',direction:'RX',characteristic:'6e40',hex:'CD 00',command:'Unknown',message:'a,"b"\nc'}];
  for (const format of ['json','csv']) assert.deepEqual(importSession(exportSession(entries,format),format), entries);
  assert.throws(() => importSession('{"format":"other","entries":[]}', 'json'));
  assert.throws(() => importSession('{"format":"lj737-log-v2","entries":[{"time":"bad"}]}', 'json'));
  assert.throws(() => importSession('time,direction\n"unfinished','csv'));
});

test('transfer preview includes exact first/last chunk, checksum and finish length', () => {
  const bytes = new Uint8Array(201).fill(255);
  const preview = transferPreview(bytes,Uint8Array.of(0,0,255,255,255));
  assert.equal(preview.chunks,2);
  assert.match(preview.manifest,/CHUNK 2: CD 00 0A 1F 01 01 00 05 00 02 FF 01 01/);
  assert.equal(hex(preview.finish),'CD 00 0D 1F 01 03 00 08 00 00 00 C9 00 00 C8 37');
  assert.match(preview.summary,/validated locally/);
  assert.throws(() => transferPreview(bytes,new Uint8Array(4)));
  assert.throws(() => transferPreview(new Uint8Array(),new Uint8Array(5)));
});

test('CSV escapes spreadsheet formulas and preserves literal leading apostrophes', () => {
  for (const message of ['=SUM(1,2)','+cmd','-1','@value',"'literal",'\tformula']) {
    const entries = [{time:'2026-09-15T12:00:00.000Z',direction:'SYS',message,characteristic:'',hex:'',command:''}];
    const csv = exportSession(entries,'csv');
    assert.deepEqual(importSession(csv,'csv'),entries);
    assert.ok(csv.includes(`"'${message}"`));
  }
});
