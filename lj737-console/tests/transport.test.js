import test from 'node:test';
import assert from 'node:assert/strict';
import { BluetoothTransport } from '../js/transport.js';

function connectedTransport(write) {
  const transport = new BluetoothTransport();
  transport.server = { connected: true };
  transport.writer = { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: write };
  return transport;
}

test('GATT serializes whole packets and fragments at 20 bytes', async () => {
  const written = [];
  const transport = connectedTransport(async bytes => { written.push([...bytes]); });
  await Promise.all([transport.write(new Uint8Array(41).fill(1)), transport.write(Uint8Array.of(9))]);
  assert.deepEqual(written.map(bytes => bytes.length), [20,20,1,1]);
  assert.deepEqual(written.at(-1), [9]);
});

test('disconnect invalidates queued writes', async () => {
  const written = [];
  const transport = connectedTransport(async bytes => { written.push([...bytes]); transport.cleanup(); });
  const results = await Promise.allSettled([transport.write(new Uint8Array(40)), transport.write(Uint8Array.of(1))]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(written.length, 1);
});

test('cancellation prevents the next GATT fragment', async () => {
  const controller = new AbortController();
  let count = 0;
  const transport = connectedTransport(async () => { count++; controller.abort(); });
  await assert.rejects(transport.write(new Uint8Array(40), { signal: controller.signal }));
  assert.equal(count, 1);
});

test('write-with-response fallback follows characteristic properties', async () => {
  const transport = new BluetoothTransport();
  transport.server = { connected: true };
  let written;
  transport.writer = { properties: { write: true }, writeValueWithResponse: async bytes => { written = [...bytes]; } };
  await transport.write(Uint8Array.of(0xcd, 0));
  assert.deepEqual(written, [0xcd, 0]);
});

test('stalled GATT write disconnects and discards remaining fragments', async () => {
  const transport = connectedTransport(() => new Promise(() => {}));
  transport.writeTimeout = 10;
  await assert.rejects(transport.write(new Uint8Array(40)), /timed out/);
  assert.equal(transport.connected, false);
});
