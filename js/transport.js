export const UUID = Object.freeze({
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9d',
  write: '6e400002-b5a3-f393-e0a9-e50e24dcca9d',
  notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9d',
  custom: '6e400004-b5a3-f393-e0a9-e50e24dcca9d',
});

export const DEVICE_FIELDS = [
  ['Manufacturer', 0x2a29], ['Model', 0x2a24], ['Serial', 0x2a25],
  ['Firmware', 0x2a26], ['Hardware', 0x2a27], ['Software', 0x2a28],
  ['System ID', 0x2a23], ['IEEE certification', 0x2a2a], ['PnP ID', 0x2a50],
];

const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
const valueBytes = value => new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
const byteHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(' ').toUpperCase();

export class BluetoothTransport extends EventTarget {
  device = null;
  server = null;
  writer = null;
  connecting = false;
  queue = Promise.resolve();
  listeners = [];
  generation = 0;
  writeTimeout = 8000;
  get connected() { return Boolean(this.server?.connected && this.writer); }
  emit(type, values = {}) {
    const event = new Event(type);
    Object.assign(event, values);
    this.dispatchEvent(event);
  }
  run(operation) {
    const generation = this.generation;
    const result = this.queue.then(() => {
      if (generation !== this.generation) throw new Error('Connection changed; operation cancelled.');
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async connect(showAll = false) {
    if (!globalThis.isSecureContext) throw new Error('Open this console over HTTPS or localhost.');
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Try Chrome on Android or Chrome/Edge on Windows or macOS.');
    if (this.connecting || this.connected) return;
    this.connecting = true;
    const generation = ++this.generation;
    try {
      const optionalServices = [UUID.service, 0x180f, 0x180a, 0xae00];
      const options = showAll ? { acceptAllDevices: true, optionalServices } : {
        filters: [{ name: 'MOVEMENT' }, { name: 'Movement' }, { services: [UUID.service] }], optionalServices,
      };
      const device = await navigator.bluetooth.requestDevice(options);
      if (generation !== this.generation) throw new Error('Connection cancelled.');
      this.device = device;
      const disconnected = () => this.cleanup();
      device.addEventListener('gattserverdisconnected', disconnected);
      this.listeners.push([device, 'gattserverdisconnected', disconnected]);
      const server = await device.gatt.connect();
      if (generation !== this.generation) {
        device.gatt.disconnect();
        throw new Error('Connection cancelled.');
      }
      this.server = server;
      const service = await this.server.getPrimaryService(UUID.service);
      this.writer = await service.getCharacteristic(UUID.write);
      const reader = await service.getCharacteristic(UUID.notify);
      await this.subscribe(reader, bytes => {
        this.emit('packet', { direction: 'RX', bytes, characteristic: UUID.notify });
        this.emit('data', { bytes });
      });
      if (generation !== this.generation || !this.connected) throw new Error('Connection lost during setup.');
      this.emit('connected', { name: device.name || 'Unnamed device' });
    } catch (error) {
      this.disconnect();
      throw error;
    } finally { this.connecting = false; }
  }
  async subscribe(characteristic, callback) {
    const handler = event => callback(valueBytes(event.target.value));
    characteristic.addEventListener('characteristicvaluechanged', handler);
    this.listeners.push([characteristic, 'characteristicvaluechanged', handler]);
    await characteristic.startNotifications();
  }
  cleanup() {
    this.generation++;
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
    this.writer = null;
    this.server = null;
    this.device = null;
    this.emit('disconnected');
  }
  disconnect() {
    const device = this.device;
    this.cleanup();
    if (device?.gatt?.connected) device.gatt.disconnect();
  }
  async readInfo() {
    return this.run(async () => {
      if (!this.connected) throw new Error('Connect first.');
      const result = {};
      let service;
      try { service = await this.server.getPrimaryService(0x180a); } catch {}
      for (const [name, uuid] of DEVICE_FIELDS) {
        try {
          if (!service) throw new Error('Service unavailable');
          const characteristic = await service.getCharacteristic(uuid);
          const bytes = valueBytes(await characteristic.readValue());
          const text = new TextDecoder().decode(bytes).replace(/\0+$/, '');
          result[name] = ['System ID', 'PnP ID'].includes(name) ? byteHex(bytes) : name === 'IEEE certification' ? `${byteHex(bytes)}${/^[\x20-\x7e]+$/.test(text) ? ` (${text})` : ''}` : text || 'Empty';
        } catch { result[name] = 'Unavailable'; }
      }
      return result;
    });
  }
  async inspectOTA() {
    return this.run(async () => {
      if (!this.connected) throw new Error('Connect first.');
      const generation = this.generation;
      const service = await this.server.getPrimaryService(0xae00);
      const result = { Service:'AE00 discovered', Authentication:'Unknown / not attempted', Flashing:'Disabled' };
      for (const uuid of [0xae01,0xae02]) {
        try {
          const characteristic = await service.getCharacteristic(uuid);
          const properties = ['read','write','writeWithoutResponse','notify','indicate'].filter(name => characteristic.properties[name]);
          result[uuid.toString(16).toUpperCase()] = properties.join(', ') || 'No recognized properties';
        } catch (error) { result[uuid.toString(16).toUpperCase()] = `Unavailable: ${error.message}`; }
      }
      if (generation !== this.generation || !this.connected) throw new Error('Disconnected during inspection.');
      return result;
    });
  }
  async readBattery(subscribe = false) {
    return this.run(async () => {
      if (!this.connected) throw new Error('Connect first.');
      const service = await this.server.getPrimaryService(0x180f);
      const characteristic = await service.getCharacteristic(0x2a19);
      const report = bytes => {
        const percent = bytes.length && bytes[0] <= 100 ? bytes[0] : null;
        this.emit('battery', { percent });
        return percent;
      };
      const percent = report(valueBytes(await characteristic.readValue()));
      if (subscribe && characteristic.properties.notify) {
        try { await this.subscribe(characteristic, report); }
        catch { this.emit('notice', { message: 'Battery notifications unavailable; use Refresh.' }); }
      }
      return percent;
    });
  }
  async write(bytes, { signal } = {}) {
    const copy = bytes.slice();
    const writeGeneration = this.generation;
    try { return await this.run(async () => {
      if (!this.connected) throw new Error('Watch disconnected.');
      const generation = this.generation;
      const writer = this.writer;
      for (let offset = 0; offset < copy.length; offset += 20) {
        signal?.throwIfAborted();
        if (generation !== this.generation || !this.connected) throw new Error('Watch disconnected during write.');
        const chunk = copy.slice(offset, offset + 20);
        let timer;
        const deadline = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Bluetooth write timed out. Reconnect before sending again.')), this.writeTimeout);
        });
        try {
          if (writer.properties.writeWithoutResponse) await Promise.race([writer.writeValueWithoutResponse(chunk), deadline]);
          else if (writer.properties.write) await Promise.race([writer.writeValueWithResponse(chunk), deadline]);
          else throw new Error('Characteristic does not support writes.');
        } finally { clearTimeout(timer); }
        this.emit('packet', { direction: 'TX', bytes: chunk, characteristic: UUID.write, commandPacket: copy });
        await delay(12);
      }
    }); } catch (error) {
      if (writeGeneration === this.generation) this.disconnect();
      throw error;
    }
  }
}
