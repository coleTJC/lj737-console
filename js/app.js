import { BluetoothTransport, DEVICE_FIELDS } from './transport.js';
import { LJ737, hex, parseHex, frame } from './protocol.js';
import { inspectDial, sha256, PREFIX_SIZE, PIXEL_BYTES, MAX_DIAL_BYTES } from './watchface.js';
import { setupBuilder } from './builder-ui.js';

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
  for (const entry of entries) {
    if (element('log-filter').value !== 'all' && element('log-filter').value !== entry.direction) continue;
    const row = document.createElement('div');
    row.className = 'log-row';
    row.dataset.direction = entry.direction;
    for (const [className, text] of [['log-time', entry.time.slice(11,23)], ['log-direction', entry.direction], ['log-message', entry.message]]) {
      const cell = document.createElement('span');
      cell.className = className;
      cell.textContent = text;
      row.append(cell);
    }
    fragment.append(row);
  }
  root.replaceChildren(fragment);
  root.scrollTop = element('autoscroll').checked ? root.scrollHeight : scrollTop;
  element('log-count').textContent = entries.length;
}

function log(message, direction = 'SYS', extra = {}) {
  entries.push({ time: new Date().toISOString(), direction, message, ...extra });
  if (entries.length > 500) entries.shift();
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
  infoRows(element('device-info'), DEVICE_FIELDS.map(([name]) => [name, '—']));
  element('battery-value').textContent = '—';
  element('battery-fill').style.width = '0%';
  element('battery-note').textContent = 'Read after connecting';
  for (const name of ['vibration', 'wake']) element(`${name}-state`).textContent = 'State unknown';
  document.querySelectorAll('[data-setting]').forEach(button => button.classList.remove('selected'));
}

async function refresh(subscribe = false) {
  const currentSession = session;
  const info = await transport.readInfo();
  if (currentSession !== session || !transport.connected) return;
  infoRows(element('device-info'), Object.entries(info));
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
  ]);
  element('dial-header').textContent = hex(bytes.slice(0, 64));
  element('dial-hash').textContent = `SHA-256: ${hash}`;
  element('dial-inspection').hidden = false;
  element('extract-prefix').hidden = bytes.length !== PREFIX_SIZE + PIXEL_BYTES;
  updateControls();
  report('File inspected. Size and signature are format hints, not proof of compatibility.');
}

const titles = { device: 'Device overview', dials: 'Watchface workbench', console: 'Command console', ota: 'Firmware interface' };
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

transport.addEventListener('packet', event => log(hex(event.bytes), event.direction, { characteristic: event.characteristic }));
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
  await protocol.set(name, enabled);
  if (name !== 'find') {
    element(`${name}-state`).textContent = `${enabled ? 'On' : 'Off'} sent · not read back`;
    document.querySelectorAll(`[data-setting="${name}"]`).forEach(item => item.classList.toggle('selected', item === button));
  }
  report(`${name === 'find' ? 'Find-watch' : name === 'wake' ? 'Raise-to-wake' : 'Vibration'} command sent. Verify the response on the watch.`);
})));

element('raw-hex').addEventListener('input', () => {
  try { element('raw-size').textContent = `${parseHex(element('raw-hex').value).length} bytes`; }
  catch { element('raw-size').textContent = element('raw-hex').value.trim() ? 'Invalid hex' : '0 bytes'; }
});
element('raw-send').addEventListener('click', () => action(async () => {
  const bytes = parseHex(element('raw-hex').value);
  if (bytes.length > 512) throw new Error('Raw commands are limited to 512 bytes.');
  if (!await review('Send raw packet?', `${bytes.length} bytes will be sent to ${transport.device?.name || 'the connected watch'}. Review every byte; raw commands bypass the safe controls.`, hex(bytes))) return;
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
element('extract-prefix').addEventListener('click', async () => {
  if (!selectedDial) return;
  const dial = selectedDial;
  if (await review('Extract template prefix?', 'Only use this if you independently verified this 140,547-byte file uses the captured custom layout. Size alone cannot prove that.', `${dial.name}\nFirst 3,267 bytes will be copied unchanged. No Bluetooth write.`, false)) download(dial.bytes.slice(0, PREFIX_SIZE), 'lj737-template-prefix.bin', 'application/octet-stream');
});
element('upload').addEventListener('click', () => action(async () => {
  if (!selectedDial || !element('dial-confirm').checked) throw new Error('Inspect and verify a dial first.');
  const dial = selectedDial;
  const metadata = parseHex(element('begin-preset').value === 'manual' ? element('begin-hex').value : element('begin-preset').value);
  if (metadata.length !== 5) throw new Error('Enter exactly five transfer-start metadata bytes.');
  if (!await review('Upload this watchface?', `${dial.name} · ${dial.bytes.length.toLocaleString()} bytes. This may replace a watchface. Keep the watch nearby, close FitPro, and leave this page visible.`, `BEGIN: ${hex(frame(0x1f, 2, metadata))}\n${dial.details.chunks} chunks; 20-byte GATT writes\nSHA-256: ${dial.hash}`)) return;
  uploading = true;
  updateControls();
  try {
    await protocol.upload(dial.bytes, metadata, (sent, total, status) => {
      element('upload-progress').value = sent / total * 100;
      element('upload-status').textContent = `${status} · ${sent.toLocaleString()} / ${total.toLocaleString()} bytes`;
    });
    report('The watch acknowledged all chunks and confirmed transfer completion. Check the watch display.');
  } catch (error) {
    element('upload-status').textContent = `Stopped: ${error.message} Progress records acknowledged bytes, not installation.`;
    throw error;
  }
}));
element('cancel-upload').addEventListener('click', () => protocol.cancel());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && uploading) protocol.cancel('Page hidden; transfer cancelled. Keep the page visible for uploads.');
});

element('log-filter').addEventListener('change', renderLog);
element('clear-log').addEventListener('click', () => { entries.length = 0; renderLog(); });
element('export-log').addEventListener('click', () => download(JSON.stringify({ format: 'lj737-log-v1', timestamps: 'UTC', exportedAt: new Date().toISOString(), entries }, null, 2), 'lj737-session.json', 'application/json'));

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
