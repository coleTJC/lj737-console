import test from 'node:test';
import assert from 'node:assert/strict';
import { frame, parseHex, hex, settings, chunkFrame, finishFrame, FrameStream, LJ737 } from '../js/protocol.js';
import { rgb565, packageDial, inspectDial } from '../js/watchface.js';

test('settings reproduce captured bytes including schedule and reserved fields', () => {
  assert.equal(hex(settings('wake', true)), 'CD 00 0A 12 01 09 00 05 01 01 E0 05 28');
  assert.equal(hex(settings('vibration', false)), 'CD 00 09 12 01 08 00 04 00 00 00 00');
  assert.equal(hex(settings('find', true)), 'CD 00 06 12 01 0B 00 01 01');
  assert.throws(() => settings('unknown', true));
});

test('hex parser refuses partial bytes, invalid symbols and empty input', () => {
  for (const value of ['', 'C D0', 'GG', '0xCD', 'CD,00', 'CD 0']) assert.throws(() => parseHex(value));
  assert.deepEqual([...parseHex('cd00 0a\n12')], [205, 0, 10, 18]);
});

test('chunk checksum includes both sequence bytes and finish sum is big endian', () => {
  assert.equal(hex(chunkFrame(257, Uint8Array.of(255, 2))), 'CD 00 0B 1F 01 01 00 06 01 01 FF 02 01 03');
  assert.equal(hex(finishFrame(Uint8Array.of(255, 2))), 'CD 00 0D 1F 01 03 00 08 00 00 00 02 00 00 01 01');
  assert.throws(() => chunkFrame(0, Uint8Array.of(1)));
  assert.throws(() => chunkFrame(65536, Uint8Array.of(1)));
});

test('notification stream reconstructs split and concatenated CD/DC frames', () => {
  const stream = new FrameStream();
  assert.deepEqual(stream.push(parseHex('CD 00 09 20 01')), []);
  const packets = stream.push(parseHex('01 00 04 00 00 03 E8 DC 00 05 1F 02 00 0D 01'));
  assert.equal(packets.length, 2);
  assert.equal(hex(packets[0]), 'CD 00 09 20 01 01 00 04 00 00 03 E8');
});

test('RGB565 is big endian and packaging preserves the exact prefix', () => {
  assert.deepEqual([...rgb565(Uint8ClampedArray.of(255,0,0,255,0,255,0,255,0,0,255,255))], [248,0,7,224,0,31]);
  const prefix = new Uint8Array(3267).fill(42);
  const packed = packageDial(prefix, new Uint8Array(137280));
  assert.equal(packed.length, 140547);
  assert.deepEqual(packed.slice(0, 3267), prefix);
  assert.throws(() => packageDial(new Uint8Array(3266), new Uint8Array(137280)));
  assert.throws(() => packageDial(prefix, new Uint8Array(137279)));
  assert.equal(inspectDial(packed).kind, 'Custom-size candidate');
});

class FakeTransport extends EventTarget {
  connected = true;
  writes = [];
  responder = null;
  async write(bytes) {
    this.writes.push(hex(bytes));
    this.responder?.(bytes);
  }
  notify(value) {
    const event = new Event('data');
    event.bytes = parseHex(value);
    this.dispatchEvent(event);
  }
}

test('upload requires matching statuses, acknowledges them and only then finishes', async () => {
  const transport = new FakeTransport();
  const protocol = new LJ737(transport, { timeout: 50 });
  transport.responder = bytes => {
    if (bytes[0] !== 0xcd) return;
    if (bytes[5] === 2) transport.notify('CD00092001010004000003E8');
    if (bytes[5] === 1) {
      transport.notify('CD00092001010004000003E8');
      transport.notify('CD00092001010004000003E9');
    }
    if (bytes[5] === 3) transport.notify('CD0009200101000400000002');
  };
  await protocol.upload(Uint8Array.of(0xaa,0x55), parseHex('0000ffffff'));
  assert.equal(transport.writes[0], 'CD 00 0A 1F 01 02 00 05 00 00 FF FF FF');
  assert.equal(transport.writes[1], 'DC 00 05 20 01 00 0C 01');
  assert.equal(transport.writes.at(-2), 'CD 00 0D 1F 01 03 00 08 00 00 00 02 00 00 00 FF');
  assert.equal(transport.writes.at(-1), 'DC 00 05 20 01 00 0C 01');
});

test('missing start status times out without sending chunks or finish', async () => {
  const transport = new FakeTransport();
  const protocol = new LJ737(transport, { timeout: 10 });
  await assert.rejects(protocol.upload(Uint8Array.of(1), parseHex('0000ffffff')), /Timed out/);
  assert.equal(transport.writes.length, 1);
  assert.equal(protocol.busy, false);
});

test('cancellation and device refusal stop the transfer', async () => {
  for (const reason of ['cancel', 'refuse']) {
    const transport = new FakeTransport();
    const protocol = new LJ737(transport, { timeout: 50 });
    transport.responder = () => reason === 'cancel' ? protocol.cancel() : transport.notify('CD0009200101000400000003');
    await assert.rejects(protocol.upload(Uint8Array.of(1), parseHex('0000ffffff')), reason === 'cancel' ? /Cancel/ : /status 3/);
    assert.equal(transport.writes.length, 1);
  }
});

test('raw sends require explicit confirmation and cannot interleave with upload', async () => {
  const transport = new FakeTransport();
  const protocol = new LJ737(transport, { timeout: 10 });
  await assert.rejects(protocol.raw(frame(0x12, 0x0b, Uint8Array.of(1)), false), /confirmation/);
  const uploading = protocol.upload(Uint8Array.of(1), parseHex('0000ffffff'));
  await assert.rejects(protocol.set('find', true), /busy/);
  protocol.cancel();
  await assert.rejects(uploading);
});

test('timeout also stops a stalled underlying write', async () => {
  const transport = new FakeTransport();
  transport.write = () => new Promise(() => {});
  const protocol = new LJ737(transport, { timeout: 10 });
  await assert.rejects(protocol.upload(Uint8Array.of(1), parseHex('0000ffffff')), /Timed out/);
  assert.equal(protocol.busy, false);
});

test('disconnect while waiting aborts without a finish packet', async () => {
  const transport = new FakeTransport();
  const protocol = new LJ737(transport, { timeout: 50 });
  transport.responder = () => transport.dispatchEvent(new Event('disconnected'));
  await assert.rejects(protocol.upload(Uint8Array.of(1), parseHex('0000ffffff')), /Disconnected/);
  assert.equal(transport.writes.length, 1);
});
