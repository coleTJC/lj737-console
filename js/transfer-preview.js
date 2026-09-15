import { COMMANDS } from './commands.js';
import { frame, chunkFrame, finishFrame, hex } from './protocol.js';

export function transferPreview(bytes, metadata) {
  if (!bytes.length || bytes.length > 4*1024*1024 || metadata.length !== 5) throw new Error('Invalid transfer file or metadata.');
  const begin = frame(COMMANDS.dialBegin.group,COMMANDS.dialBegin.sub,metadata);
  const finish = finishFrame(bytes);
  const lines = [`BEGIN: ${hex(begin)}`, 'STATUS ACK (after each expected response): DC 00 05 20 01 00 0C 01'];
  let total = 0;
  let checksum = 0;
  let sequence = 0;
  for (let offset = 0; offset < bytes.length; offset += 200) {
    const data = bytes.slice(offset,offset+200);
    const packet = chunkFrame(++sequence,data);
    const expected = ((sequence >> 8) + (sequence & 255) + data.reduce((sum,value) => sum+value,0)) & 65535;
    if (new DataView(packet.buffer).getUint16(packet.length-2) !== expected) throw new Error('Chunk checksum validation failed.');
    total += data.length;
    checksum = data.reduce((sum,value) => (sum+value) >>> 0,checksum);
    lines.push(`CHUNK ${sequence}: ${hex(packet)}`);
  }
  const view = new DataView(finish.buffer);
  if (view.getUint32(8) !== total || view.getUint32(12) !== checksum) throw new Error('Finish length/checksum validation failed.');
  lines.push(`FINISH: ${hex(finish)}`);
  return {begin,finish,manifest:lines.join('\n'),chunks:sequence,summary:`${sequence} chunks · ${total} bytes · sum 0x${checksum.toString(16).padStart(8,'0').toUpperCase()} · all chunk checksums and finish length/sum validated locally. Compatibility is not validated.`};
}
