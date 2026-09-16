import { BluetoothTransport, DEVICE_FIELDS } from './transport.js';
import { LJ737, hex, parseHex, settings, FrameStream } from './protocol.js';
import { inspectDial, sha256, MAX_DIAL_BYTES } from './watchface.js';
import { setupBuilder } from './builder-ui.js';
import { COMMANDS, decodePacket, knownDevice } from './commands.js';
import { setupLab, prepareLabShell } from './lab-ui.js';
import { exportSession, importSession, MAX_ENTRIES } from './session.js';
import { transferPreview } from './transfer-preview.js';

const element = id => document.getElementById(id);
const transport = new BluetoothTransport();
const protocol = new LJ737(transport);
const entries = [];
let busy = false;
let uploading = false;
let selectedDial = null;
let selectionGeneration = 0;
let session = 0;
let logRenderPending = false;
const bluetoothAvailable = Boolean(globalThis.isSecureContext && navigator.bluetooth);
prepareLabShell();
let rxStream = new FrameStream();
let droppedEntries = 0;

function download(data, name, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderLog() {
  logRenderPending = false;
  const root = element('log');
  const scrollTop = root.scrollTop;
  const fragment = document.createDocumentFragment();
  const query = element('command-filter').value.toLowerCase();
  const matches = entries.filter(entry => (element('log-filter').value === 'all' || element('log-filter').value === entry.direction) && `${entry.command || ''} ${entry.characteristic || ''} ${entry.hex || ''} ${entry.message}`.toLowerCase().includes(query));
  for (const entry of matches.slice(-500)) {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.dataset.direction = entry.direction;
    for (const [className, text] of [['log-time', new Date(entry.time).toISOString().slice(11,23)], ['log-direction', entry.direction], ['log-message', [entry.command,entry.message].filter(Boolean).join('\n')]]) {
      const cell = document.createElement('span');
      cell.className = className;
      cell.textContent = text;
      if (className === 'log-message' && entry.characteristic) {
        const characteristic = document.createElement('small');
        characteristic.textContent = entry.characteristic;
        cell.append(characteristic);
      }
      row.append(cell);
    }
    const copy = document.createElement('button');
    copy.className = 'log-copy'; copy.textContent = 'Copy'; copy.setAttribute('aria-label','Copy event');
    copy.addEventListener('click',async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(entry,null,2)); copy.textContent = 'Copied'; }
      catch { report('Clipboard unavailable. Export the session to copy this event.',true); }
    });
    row.append(copy);
    fragment.append(row);
  }
  root.replaceChildren(fragment);
  root.scrollTop = element('autoscroll').checked ? root.scrollHeight : scrollTop;
  element('log-count').textContent = `${entries.length}${droppedEntries ? ` · ${droppedEntries} older dropped` : ''}`;
}

function log(message, direction = 'SYS', extra = {}) {
  entries.push({ time: new Date().toISOString(), direction, message, ...extra });
  if (entries.length > MAX_ENTRIES) { entries.shift(); droppedEntries++; }
  if (!logRenderPending) { logRenderPending = true; requestAnimationFrame(renderLog); }
}

function report(message, error = false) {
  const notice = element('notice');
  notice.hidden = false;
  notice.classList.toggle('error', error);
  notice.textContent = message;
  log(`${error ? 'ERROR / ' : ''}${message}`);
}

function infoRows(root, rows) {
  root.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    root.append(row);
  }
}

function updateControls() {
  const connected = transport.connected;
  element('connect').disabled = busy || connected || !bluetoothAvailable;
  element('disconnect').disabled = !connected && !transport.connecting;
  element('refresh').disabled = busy || !connected;
  element('safe-controls').disabled = busy || !connected;
  element('raw-send').disabled = busy || !connected;
  element('upload').disabled = busy || !connected || !selectedDial || !element('dial-confirm').checked || !element('begin-preset').value;
  element('cancel-upload').disabled = !uploading;
  element('download-transfer-preview').disabled = busy || !selectedDial || !element('begin-preset').value;
  element('inspect-ota').disabled = busy || !connected;
  element('import-log').disabled = busy;
  document.querySelectorAll('.lab-send').forEach(button => { button.disabled = busy; });
  for (const id of ['dial-file', 'begin-preset', 'begin-hex', 'dial-confirm', 'show-all']) element(id).disabled = busy;
}

async function action(operation) {
  if (busy) return;
  busy = true;
  updateControls();
  try { await operation(); }
  catch (error) { report(error.message || String(error), true); }
  finally { busy = false; uploading = false; updateControls(); }
}

function resetLive() {
  element('known-device').textContent = knownDevice({});
  element('ota-status').textContent = 'Not inspected. Authentication: unknown / not attempted.';
  document.querySelectorAll('[data-lab-result]').forEach(item => { item.textContent = 'State unknown · no current-session readback.'; });
  infoRows(element('device-info'), DEVICE_FIELDS.map(([name]) => [name, '—']));
  element('battery-value').textContent = '—';
  element('battery-fill').style.width = '0%';
  element('battery-note').textContent = 'Read after connecting';
  for (const name of ['vibration', 'wake']) element(`${name}-state`).textContent = 'State unknown';
  document.querySelectorAll('[data-setting]').forEach(button => button.classList.remove('selected'));
}

function showSentState(name, parameters) {
  const label = parameters.enabled === undefined ? 'Command sent' : `${parameters.enabled ? 'On / start' : 'Off / stop'} sent`;
  const labResult = document.querySelector(`[data-lab-result][data-command="${name}"]`);
  if (labResult) labResult.textContent = `${label} · not read back.`;
  const quickResult = document.querySelector(`[data-quick-status="${name}"]`);
  if (quickResult) quickResult.textContent = `${label} · not read back`;
  if (!['wake','vibration'].includes(name) || parameters.enabled === undefined) return;
  element(`${name}-state`).textContent = `${parameters.enabled ? 'On' : 'Off'} sent · not read back`;
  document.querySelectorAll(`[data-setting="${name}"]`).forEach(item => item.classList.toggle('selected',item.dataset.value === String(parameters.enabled)));
}

async function refresh(subscribe = false) {
  const currentSession = session;
  const info = await transport.readInfo();
  if (currentSession !== session || !transport.connected) return;
  infoRows(element('device-info'), Object.entries(info));
  element('known-device').textContent = knownDevice(info);
  log('Device Information read complete; absent characteristics marked unavailable.');
  if (info.Hardware !== 'Unavailable' && info.Hardware !== 'LJ737_MB_V1.5') report(`Hardware differs from capture: ${info.Hardware}. Verify device identity before writes.`, true);
  try { await transport.readBattery(subscribe); }
  catch (error) { log(`Battery unavailable: ${error.message}`); }
}

function review(title, description, bytes, bluetoothWrite = true) {
  const dialog = element('review-dialog');
  element('review-title').textContent = title;
  element('review-description').textContent = description;
  element('review-bytes').textContent = bytes;
  element('review-destination').hidden = !bluetoothWrite;
  element('review-confirm').textContent = bluetoothWrite ? 'Confirm & send' : 'Confirm & extract';
  element('review-confirm').disabled = bluetoothWrite && !transport.connected;
  if (bluetoothWrite && !transport.connected) element('review-description').textContent += '\nPreview only: connect your watch to send.';
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

async function selectDial(bytes, name) {
  if (uploading) throw new Error('Wait for the current transfer before inspecting another file.');
  const generation = ++selectionGeneration;
  selectedDial = null;
  element('dial-confirm').checked = false;
  element('dial-inspection').hidden = true;
  element('upload-progress').value = 0;
  element('upload-status').textContent = 'No transfer running. Keep the page visible while uploading.';
  updateControls();
  const details = inspectDial(bytes);
  const hash = await sha256(bytes);
  if (generation !== selectionGeneration) return;
  selectedDial = { bytes, name, details, hash };
  element('dial-name').textContent = name;
  infoRows(element('dial-details'), [
    ['Format hint', details.kind], ['Size', `${details.size.toLocaleString()} bytes`],
    ['Transfer chunks', `${details.chunks} × up to 200 bytes`], ['Additive sum', `0x${details.sum.toString(16).padStart(8, '0').toUpperCase()}`],
    ...(details.custom ? [['Screen', '240 × 286'], ['Framebuffer', `offset ${details.custom.framebufferOffset} (0x${details.custom.framebufferOffset.toString(16).toUpperCase()}) · RGB565 BE`], ['Glyph resources', String(details.custom.resources.length)], ['Unknown trailer', `${details.custom.trailer.length} bytes`]] : []),
  ]);
  element('dial-format').textContent = details.custom
    ? details.custom.resources.map((resource, index) => `#${String(index).padStart(2, '0')}  @${resource.offset} (0x${resource.offset.toString(16).toUpperCase()})  ${resource.width}×${resource.height}  ${resource.length} bytes`).join('\n') + `\nUnknown trailer: ${hex(details.custom.trailer)}`
    : 'No custom glyph records parsed. AA55 normal-dial resource tables are not decoded.';
  element('dial-header').textContent = hex(bytes.slice(0, 64));
  element('dial-hash').textContent = `SHA-256: ${hash}`;
  element('dial-inspection').hidden = false;
  updateControls();
  report('File inspected. Size and signature are format hints, not proof of compatibility.');
}

const titles = { device: 'Device overview', lab: 'Device Lab', dials: 'Watchface workbench', console: 'Command console', ota: 'Firmware interface' };
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-panel]').forEach(item => {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  for (const name of Object.keys(titles)) element(`panel-${name}`).hidden = name !== button.dataset.panel;
  element('page-title').replaceChildren(document.createTextNode(titles[button.dataset.panel]));
  const period = document.createElement('span');
  period.className = 'mint';
  period.textContent = '.';
  element('page-title').append(period);
}));

transport.addEventListener('packet', event => {
  const command = event.direction === 'TX' ? decodePacket(event.commandPacket || event.bytes) : rxStream.push(event.bytes).map(decodePacket).join(' / ') || 'Fragment / awaiting complete frame';
  log(hex(event.bytes),event.direction,{characteristic:event.characteristic,hex:hex(event.bytes),command});
});
transport.addEventListener('notice', event => log(event.message));
transport.addEventListener('connected', event => {
  session++;
  resetLive();
  element('connection-badge').classList.add('online');
  element('connection-badge').lastChild.textContent = ' CONNECTED';
  element('device-name').textContent = event.name;
  element('connection-note').textContent = 'Normal FitPro channel · notifications active';
  report(`Connected to ${event.name}. Reading live identity…`);
  updateControls();
});
transport.addEventListener('disconnected', () => {
  rxStream = new FrameStream();
  session++;
  resetLive();
  element('connection-badge').classList.remove('online');
  element('connection-badge').lastChild.textContent = ' DISCONNECTED';
  element('device-name').textContent = 'MOVEMENT';
  element('connection-note').textContent = 'Awaiting a secure Bluetooth connection';
  if (element('review-dialog').open) element('review-dialog').close('cancel');
  log('Disconnected. Live readings cleared.');
  updateControls();
});
transport.addEventListener('battery', event => {
  element('battery-value').textContent = event.percent ?? '—';
  element('battery-fill').style.width = `${event.percent ?? 0}%`;
  element('battery-note').textContent = event.percent === null ? 'Invalid battery value' : 'Live GATT battery reading';
});

element('connect').addEventListener('click', () => action(async () => {
  await transport.connect(element('show-all').checked);
  await refresh(true);
}));
element('disconnect').addEventListener('click', () => transport.disconnect());
element('refresh').addEventListener('click', () => action(() => refresh()));
document.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', () => action(async () => {
  const name = button.dataset.setting;
  const enabled = button.dataset.value === 'true';
  if (!await review(`${COMMANDS[name].name} · Safe`,`${enabled ? 'On / start' : 'Off / stop'} requested. ${COMMANDS[name].note}`,hex(settings(name,enabled)))) return;
  await protocol.set(name, enabled);
  showSentState(name,{enabled});
  report(`${name === 'find' ? 'Find-watch' : name === 'wake' ? 'Raise-to-wake' : 'Vibration'} command sent. Verify the response on the watch.`);
})));

element('raw-hex').addEventListener('input', () => {
  try { const bytes = parseHex(element('raw-hex').value); element('raw-size').textContent = `${bytes.length} bytes`; element('raw-interpretation').textContent = `${decodePacket(bytes)} · ${bytes.length} bytes · arbitrary packet requires confirmation.`; }
  catch { element('raw-size').textContent = element('raw-hex').value.trim() ? 'Invalid hex' : '0 bytes'; }
});
element('raw-send').addEventListener('click', () => action(async () => {
  const bytes = parseHex(element('raw-hex').value);
  if (bytes.length > 512) throw new Error('Raw commands are limited to 512 bytes.');
  if (!await review('Send arbitrary packet? · Experimental', `${decodePacket(bytes)} · ${bytes.length} bytes will be sent to ${transport.device?.name || 'the connected watch'}. Review every byte; raw commands bypass the guided controls.`, hex(bytes))) return;
  await protocol.raw(bytes, true);
  report('Raw packet sent. Watch acceptance is not implied.');
}));

element('dial-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  const generation = ++selectionGeneration;
  selectedDial = null;
  element('dial-inspection').hidden = true;
  element('dial-confirm').checked = false;
  updateControls();
  if (!file) return;
  try {
    if (!file.size || file.size > MAX_DIAL_BYTES) throw new Error('Choose a non-empty .bin under 4 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation === selectionGeneration) await selectDial(bytes, file.name);
  } catch (error) { report(error.message, true); }
});
element('begin-preset').addEventListener('change', () => {
  element('begin-hex').hidden = element('begin-preset').value !== 'manual';
  element('dial-confirm').checked = false;
  updateControls();
});
element('begin-hex').addEventListener('input', () => { element('dial-confirm').checked = false; updateControls(); });
element('dial-confirm').addEventListener('change', updateControls);
element('upload').addEventListener('click', () => action(async () => {
  if (!selectedDial || !element('dial-confirm').checked) throw new Error('Inspect and verify a dial first.');
  const dial = selectedDial;
  const metadata = parseHex(element('begin-preset').value === 'manual' ? element('begin-hex').value : element('begin-preset').value);
  if (metadata.length !== 5) throw new Error('Enter exactly five transfer-start metadata bytes.');
  const preview = transferPreview(dial.bytes,metadata);
  if (!await review('Upload this watchface? · Experimental', `${dial.name}\n${preview.summary}\nSHA-256: ${dial.hash}\nEvery outgoing frame is listed below; each is split into 20-byte GATT writes. This may replace a watchface. Keep this page visible.`, preview.manifest)) return;
  uploading = true;
  updateControls();
  try {
    await protocol.upload(dial.bytes, metadata, (sent, total, status) => {
      element('upload-progress').value = sent / total * 100;
      element('upload-status').textContent = `${status} · ${Math.ceil(sent/200)} / ${preview.chunks} chunks · ${sent.toLocaleString()} / ${total.toLocaleString()} bytes`;
    });
    report('The watch acknowledged all chunks and confirmed transfer completion. Check the watch display.');
  } catch (error) {
    element('upload-status').textContent = `Stopped: ${error.message} Progress records acknowledged bytes, not installation.`;
    throw error;
  }
}));
element('cancel-upload').addEventListener('click', () => protocol.cancel());
element('download-transfer-preview').addEventListener('click',() => {
  try {
    if (!selectedDial) throw new Error('Select a dial first.');
    const metadata = parseHex(element('begin-preset').value === 'manual' ? element('begin-hex').value : element('begin-preset').value);
    const preview = transferPreview(selectedDial.bytes,metadata);
    download(`${preview.summary}\nSHA-256: ${selectedDial.hash}\n${preview.manifest}`,'lj737-transfer-preview.txt');
  } catch (error) { report(error.message,true); }
});
element('inspect-ota').addEventListener('click',() => action(async () => {
  element('ota-status').textContent = 'Inspecting AE00 characteristic properties… Authentication not attempted.';
  try { const result = await transport.inspectOTA(); element('ota-status').textContent = Object.entries(result).map(([name,value]) => `${name}: ${value}`).join('\n'); }
  catch (error) { element('ota-status').textContent = `Inspection unavailable: ${error.message}\nAuthentication: unknown / not attempted. Flashing: disabled.`; throw error; }
}));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && uploading) protocol.cancel('Page hidden; transfer cancelled. Keep the page visible for uploads.');
});

element('log-filter').addEventListener('change', renderLog);
element('command-filter').addEventListener('input',renderLog);
element('clear-log').addEventListener('click', () => { entries.length = 0; droppedEntries = 0; renderLog(); });
element('export-log').addEventListener('click', () => download(exportSession(entries,'json'),'lj737-session.json','application/json'));
element('export-csv').addEventListener('click', () => download(exportSession(entries,'csv'),'lj737-session.csv','text/csv'));
element('import-log').addEventListener('change',async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 32*1024*1024) throw new Error('Session exceeds 32 MiB.');
    const imported = importSession(await file.text(),file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
    if (busy) throw new Error('Wait for the current device operation before importing.');
    if (!confirm(`Replace the activity log with ${imported.length} imported events? This does not send any packets.`)) return;
    entries.splice(0,entries.length,...imported); droppedEntries = 0; renderLog();
  } catch (error) { report(error.message,true); }
  finally { event.target.value = ''; }
});

setupLab({action,review,protocol,report,onSent:showSentState});
setupBuilder({ selectDial, download, report });
resetLive();
updateControls();
const compatibility = element('compatibility');
if (!globalThis.isSecureContext) {
  compatibility.classList.add('warning');
  compatibility.textContent = 'HTTPS required for Bluetooth. Open the hosted site, or use localhost on this computer. A plain LAN HTTP address is not sufficient on Android.';
} else if (!navigator.bluetooth) {
  compatibility.classList.add('warning');
  compatibility.textContent = 'Web Bluetooth unavailable in this browser. Use Chrome on Android or Chrome/Edge on Windows or macOS. Edge Android varies; use Chrome if unavailable. Offline file tools still work. Safari / iOS and Firefox are unsupported.';
} else {
  compatibility.textContent = 'Secure context · Web Bluetooth available. Chrome Android / Chrome or Edge desktop. Edge Android depends on its build. Close FitPro before connecting; browser policy and Bluetooth permissions can still block access.';
}
log('Console ready. No device connected; no commands sent.');
log('Capture profile: LJ737_MB_V1.5 / V27094 · UUID suffix CCA9D.');
