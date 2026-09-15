import { COMMANDS, commandPayload, byte } from './commands.js';
export const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(' ').toUpperCase();

export function parseHex(text) {
  if (!text.trim() || !/^[\da-f\s]+$/i.test(text)) throw new Error('Enter complete hexadecimal bytes, separated by spaces or newlines.');
  const tokens = text.trim().split(/\s+/);
  if (tokens.some(token => token.length % 2)) throw new Error('Every hex byte needs two digits.');
  return Uint8Array.from(tokens.join('').match(/../g), byte => parseInt(byte, 16));
}

export function frame(group, subcommand, payload = new Uint8Array()) {
  byte(group, 'Group');
  byte(subcommand, 'Subcommand');
  if (!(payload instanceof Uint8Array)) throw new Error('Payload must be bytes.');
  if (payload.length > 65530) throw new Error('Payload too large.');
  const packet = new Uint8Array(payload.length + 8);
  const view = new DataView(packet.buffer);
  packet.set([0xcd, 0, 0, group, 1, subcommand]);
  view.setUint16(1, payload.length + 5);
  view.setUint16(6, payload.length);
  packet.set(payload, 8);
  return packet;
}

export function settings(name, enabled) {
  if (!['wake','vibration','find','camera','heart','ecg'].includes(name)) throw new Error('Unsupported safe control.');
  return frame(COMMANDS[name].group, COMMANDS[name].sub, commandPayload(name, { enabled }));
}

export function chunkFrame(sequence, data) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 65535 || !data.length || data.length > 200) throw new Error('Invalid chunk.');
  const payload = new Uint8Array(data.length + 4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, sequence);
  payload.set(data, 2);
  view.setUint16(payload.length - 2, payload.reduce((sum, byte) => sum + byte, 0) & 0xffff);
  return frame(COMMANDS.dialChunk.group, COMMANDS.dialChunk.sub, payload);
}

export function finishFrame(data) {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, data.length);
  view.setUint32(4, data.reduce((sum, byte) => (sum + byte) >>> 0, 0));
  return frame(COMMANDS.dialFinish.group, COMMANDS.dialFinish.sub, payload);
}

export class FrameStream {
  buffer = new Uint8Array();
  push(bytes) {
    const merged = new Uint8Array(this.buffer.length + bytes.length);
    merged.set(this.buffer);
    merged.set(bytes, this.buffer.length);
    this.buffer = merged;
    const frames = [];
    while (this.buffer.length >= 3) {
      const size = (this.buffer[1] << 8 | this.buffer[2]) + 3;
      if (![0xcd, 0xdc].includes(this.buffer[0]) || size < 8 || size > 4096) {
        this.buffer = this.buffer.slice(1);
        continue;
      }
      if (this.buffer.length < size) break;
      const packet = this.buffer.slice(0, size);
      this.buffer = this.buffer.slice(size);
      if (packet[0] === 0xcd && (packet[4] !== 1 || (packet[6] << 8 | packet[7]) !== size - 8)) continue;
      frames.push(packet);
    }
    return frames;
  }
}

const STATUS_ACK = Uint8Array.of(0xdc, 0, 5, 0x20, 1, 0, 12, 1);

export class LJ737 extends EventTarget {
  busy = false;
  pending = null;
  controller = null;
  stream = new FrameStream();
  constructor(transport, { timeout = 8000 } = {}) {
    super();
    this.transport = transport;
    this.timeout = timeout;
    transport.addEventListener('data', event => {
      for (const packet of this.stream.push(event.bytes)) {
        const message = new Event('frame');
        message.bytes = packet;
        this.dispatchEvent(message);
        if (packet[0] === 0xcd && packet[3] === 0x20 && packet[5] === 1 && packet.length === 12) {
          const status = new DataView(packet.buffer).getUint32(8);
          this.pending?.(status);
        }
      }
    });
    transport.addEventListener('disconnected', () => {
      this.cancel('Disconnected. Reconnect before starting a fresh transfer.');
      this.stream = new FrameStream();
    });
  }
  assertReady() {
    if (this.busy) throw new Error('Protocol busy. Wait for the current operation.');
    if (!this.transport.connected) throw new Error('Connect your watch first.');
  }
  async exclusive(action) {
    this.assertReady();
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async set(name, enabled) {
    return this.exclusive(() => this.transport.write(settings(name, enabled)));
  }
  async raw(bytes, confirmed) {
    if (confirmed !== true) throw new Error('Explicit confirmation is required.');
    if (!bytes.length || bytes.length > 512) throw new Error('Raw commands must contain 1–512 bytes.');
    return this.exclusive(() => this.transport.write(bytes));
  }
  cancel(message = 'Cancelled. The watch may need time to leave transfer mode.') {
    this.controller?.abort(new Error(message));
  }
  async exchange(packet, expected, signal) {
    signal.throwIfAborted();
    let resolveStatus;
    let rejectStatus;
    const response = new Promise((resolve, reject) => { resolveStatus = resolve; rejectStatus = reject; });
    response.catch(() => {});
    const onAbort = () => rejectStatus(signal.reason);
    const timer = setTimeout(() => rejectStatus(new Error(`Timed out waiting for status ${expected}. No automatic retry.`)), this.timeout);
    signal.addEventListener('abort', onAbort, { once: true });
    this.pending = status => {
      if (status === expected) resolveStatus(status);
      else if (status < 1000) rejectStatus(new Error(`Watch returned unexpected status ${status}; transfer stopped.`));
    };
    try {
      await Promise.all([this.transport.write(packet, { signal }), response]);
      signal.throwIfAborted();
      await this.transport.write(STATUS_ACK, { signal });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      this.pending = null;
    }
  }
  async upload(bytes, beginPayload, onProgress = () => {}) {
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Choose a non-empty dial under 4 MiB.');
    if (beginPayload.length !== 5) throw new Error('This capture profile needs exactly five begin-metadata bytes.');
    return this.exclusive(async () => {
      this.controller = new AbortController();
      const signal = this.controller.signal;
      try {
        onProgress(0, bytes.length, 'Waiting for watch');
        await this.exchange(frame(COMMANDS.dialBegin.group, COMMANDS.dialBegin.sub, beginPayload), 1000, signal);
        for (let offset = 0, sequence = 1; offset < bytes.length; offset += 200, sequence++) {
          const chunk = bytes.slice(offset, offset + 200);
          await this.exchange(chunkFrame(sequence, chunk), 1000 + sequence, signal);
          onProgress(offset + chunk.length, bytes.length, 'Chunks acknowledged');
        }
        onProgress(bytes.length, bytes.length, 'Verifying on watch');
        await this.exchange(finishFrame(bytes), 2, signal);
        onProgress(bytes.length, bytes.length, 'Watch confirmed completion');
      } catch (error) {
        this.controller.abort(error);
        this.transport.disconnect?.();
        throw error;
      } finally { this.controller = null; }
    });
  }
}
