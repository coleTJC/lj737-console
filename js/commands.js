export function byte(value, name = 'Byte') {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${name} must be an integer from 0 to 255.`);
  return value;
}
const booleanPayload = (enabled, tail = []) => {
  if (typeof enabled !== 'boolean') throw new Error('Choose an explicit on/off state.');
  return Uint8Array.of(Number(enabled), ...tail);
};
function fields(values, length) {
  if (!Array.isArray(values) || values.length !== length) throw new Error(`Enter exactly ${length} payload bytes.`);
  return Uint8Array.from(values.map(value => byte(value)));
}

export const COMMANDS = Object.freeze({
  wake: { name:'Raise to wake', group:0x12, sub:0x09, safety:'Safe', kind:'switch', note:'Preserves captured schedule 01 E0 05 28. User verified this control on the watch.', payload:({enabled}) => booleanPayload(enabled,[1,224,5,40]) },
  vibration: { name:'Vibration', group:0x12, sub:0x08, safety:'Safe', kind:'switch', note:'Captured state followed by three reserved zero bytes.', payload:({enabled}) => booleanPayload(enabled,[0,0,0]) },
  find: { name:'Find watch', group:0x12, sub:0x0b, safety:'Safe', kind:'action', actions:['Find / start','Stop finding'], note:'Captured boolean request. Acceptance is not read back.', payload:({enabled}) => booleanPayload(enabled) },
  camera: { name:'Camera mode', group:0x12, sub:0x0c, safety:'Safe', kind:'action', actions:['Enter camera mode','Exit camera mode'], note:'Captured 01 / 00. Watch events appear in the activity stream; this does not open a phone camera.', payload:({enabled}) => booleanPayload(enabled) },
  heart: { name:'Heart measurement', group:0x12, sub:0x18, safety:'Safe', kind:'action', actions:['Start heart measurement','Stop heart measurement'], note:'Mapped start/stop request, one-byte state. Hardware response and measurement decoding remain unverified.', payload:({enabled}) => booleanPayload(enabled) },
  ecg: { name:'ECG', group:0x12, sub:0x1a, safety:'Safe', kind:'action', actions:['Start ECG','Stop ECG'], note:'Mapped start/stop request. Sensor availability and response decoding remain unverified.', payload:({enabled}) => booleanPayload(enabled) },
  notifications: {
    name:'Notifications / SMS test', group:0x12, sub:0x07, safety:'Experimental', kind:'notifications', defaults:Array(12).fill(0),
    note:'SMS-off capture has twelve zero bytes. SMS byte position and bit are NOT confirmed. Select a test byte/bit explicitly. Other category bytes are unconfirmed; use a captured baseline to preserve settings.',
    payload:({bytes,enabled,index,bit}) => {
      const result = fields(bytes,12);
      booleanPayload(enabled);
      if (!Number.isInteger(index) || index < 0 || index > 11 || !Number.isInteger(bit) || bit < 0 || bit > 7) throw new Error('Select category byte 0–11 and bit 0–7.');
      result[index] = enabled ? result[index] | (1 << bit) : result[index] & ~(1 << bit);
      return result;
    },
  },
  alarm: {
    name:'Alarm', group:0x12, sub:0x02, safety:'Experimental', kind:'alarm', defaults:[106,94,199,136,31],
    note:'Captured add/set: 6A 5E C7 88 1F. Hour, minute, repeat and slot packing are unknown. Edit the five decimal parameters. Captured delete has NO payload and may clear ALL alarms.',
    payload:({operation,bytes}) => {
      if (operation === 'delete') return new Uint8Array();
      if (operation !== 'set') throw new Error('Choose add/set or delete.');
      return fields(bytes,5);
    },
  },
  sedentary: {
    name:'Sedentary reminder', group:0x12, sub:0x05, safety:'Experimental', kind:'sedentary', defaults:[0,1,0,150,4,8,22,127],
    note:'Captured enable: 00 01 00 96 04 08 16 7F. Disable changes byte 1 to 00. Schedule, interval and weekday encoding are unconfirmed; edit captured decimal parameters.',
    payload:({enabled,bytes}) => { const result = fields(bytes,8); result[1] = booleanPayload(enabled)[0]; return result; },
  },
  dialBegin: { name:'Watchface begin', group:0x1f, sub:0x02, safety:'Experimental', kind:'transfer', note:'Five captured slot/style bytes; meanings partly decoded. Wait for status 1000.' },
  dialChunk: { name:'Watchface chunk', group:0x1f, sub:0x01, safety:'Experimental', kind:'transfer', note:'Sequence BE16 + up to 200 data bytes + additive checksum BE16 including sequence. Wait for 1000 + sequence.' },
  dialFinish: { name:'Watchface finish', group:0x1f, sub:0x03, safety:'Experimental', kind:'transfer', note:'File length BE32 + whole-file byte sum BE32. Status 2 confirms completion.' },
  status: { name:'Transfer status', group:0x20, sub:0x01, safety:'Safe', kind:'receive', note:'Unsigned BE32 status. Uploader replies DC 00 05 20 01 00 0C 01.' },
  ota: { name:'JieLi firmware / OTA', safety:'Dangerous', kind:'disabled', note:'AE00 / AE01 / AE02 discovery only. Authentication unknown; flashing unavailable.' },
});
export function commandPayload(name, parameters) {
  if (!COMMANDS[name]?.payload) throw new Error('This command is not available as a control.');
  return COMMANDS[name].payload(parameters);
}
const code = value => value.toString(16).padStart(2,'0').toUpperCase();
export function decodePacket(packet) {
  if (packet.length < 8 || ![0xcd,0xdc].includes(packet[0]) || (packet[1] << 8 | packet[2]) + 3 !== packet.length) return 'Fragment / unrecognized';
  const reply = packet[0] === 0xdc;
  if (!reply && (packet[4] !== 1 || (packet[6] << 8 | packet[7]) !== packet.length - 8)) return 'Malformed frame';
  const group = packet[3];
  const sub = packet[reply ? 4 : 5];
  const command = Object.values(COMMANDS).find(item => item.group === group && item.sub === sub);
  let name = command?.name || `Unknown ${code(group)} / ${code(sub)}`;
  if (reply) return `${name} · reply (DC; semantics unconfirmed)`;
  if (command === COMMANDS.status && packet.length === 12) name += ` · ${new DataView(packet.buffer,packet.byteOffset).getUint32(8)}`;
  return name;
}
export function knownDevice(info) {
  const product = Object.values(info).some(value => String(value).includes('LJ737(D)')) ? 'LJ737(D)' : 'product not read';
  const hardware = info.Hardware && info.Hardware !== 'Unavailable' ? info.Hardware : 'board not read';
  const firmware = info.Firmware && info.Firmware !== 'Unavailable' ? info.Firmware : 'firmware not read';
  const matched = product === 'LJ737(D)' && hardware === 'LJ737_MB_V1.5' && firmware === 'V27094';
  return `${matched ? 'Known device' : 'Live identity'} · ${product} · ${hardware} · ${firmware} | Display 240 × 286 is the captured profile, not a live reading.`;
}
