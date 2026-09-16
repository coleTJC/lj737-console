import { COMMANDS, QUICK_CONTROLS, commandPayload } from './commands.js';
import { frame, hex, parseHex } from './protocol.js';

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const code = value => value.toString(16).padStart(2,'0').toUpperCase();

function numeric(root, label, value, max = 255) {
  const wrapper = node('label', label);
  const input = node('input');
  input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '1'; input.value = String(value);
  wrapper.append(input); root.append(wrapper);
  return input;
}
function checked(root, label) {
  const wrapper = node('label', '', 'check-label');
  const input = node('input'); input.type = 'checkbox';
  wrapper.append(input, document.createTextNode(label)); root.append(wrapper);
  return input;
}
const numberValue = input => input.value.trim() ? Number(input.value) : NaN;

export function prepareLabShell() {
  const rawCard = document.getElementById('raw-hex').closest('article');
  rawCard.querySelector('h3').textContent = 'Raw Lab';
  const fields = node('div'); fields.id = 'raw-fields';
  const description = node('p','Build a frame above or edit the complete packet below. Sending requires an explicit review.','footnote'); description.id = 'raw-interpretation';
  rawCard.insertBefore(fields,document.querySelector('label[for="raw-hex"]'));
  rawCard.insertBefore(description,document.querySelector('label[for="raw-hex"]'));
  document.querySelector('label[for="raw-hex"]').textContent = 'Packet Preview / complete packet (editable hex)';
  const oldReference = document.querySelector('#panel-console table').closest('article');
  const link = node('button','Open Protocol Reference ↗');
  link.addEventListener('click',() => { document.querySelector('[data-panel="lab"]').click(); document.getElementById('protocol-reference').scrollIntoView({block:'start'}); });
  const quick = node('div','','quick-controls'); quick.id = 'quick-controls';
  oldReference.replaceChildren(node('span','REFERENCE / CAPTURE MAPPINGS','eyebrow'),node('h3','Known command groups'),node('p','Compact controls use the same packet previews and confirmation dialog as Device Lab. *SMS-on byte/bit mapping remains unconfirmed.','footnote'),quick,link);
  const actions = document.querySelector('.log-actions');
  const filter = node('input'); filter.id = 'command-filter'; filter.type = 'search'; filter.placeholder = 'Filter command / characteristic / hex'; filter.setAttribute('aria-label','Filter commands, characteristics or hex');
  const csv = node('button','CSV ↓','small'); csv.id = 'export-csv';
  const importLabel = node('label','Import JSON / CSV','log-import');
  const file = node('input'); file.type = 'file'; file.accept = '.json,.csv,application/json,text/csv'; file.id = 'import-log'; importLabel.append(file);
  actions.append(filter,csv,importLabel);
  document.getElementById('export-log').textContent = 'JSON ↓';
  document.querySelector('.log-footer > span').textContent = 'SHOWING LAST 500 MATCHES · RETAINING 50,000 EVENTS · UTC';
  const ota = document.querySelector('#panel-ota .ota-hero');
  ota.querySelector('.eyebrow').textContent = 'Dangerous · firmware writes disabled';
  ota.querySelector('p').textContent = 'Inspect advertised OTA characteristic properties. Authentication is unknown and is not attempted. Flashing is unavailable.';
  const inspect = node('button','Inspect OTA service'); inspect.id = 'inspect-ota';
  const status = node('pre','Not inspected. Authentication: unknown / not attempted.'); status.id = 'ota-status';
  ota.append(inspect,status);
  const info = document.querySelector('#panel-ota .lower-grid article');
  info.querySelector('dl').lastElementChild.lastElementChild.textContent = 'Property inspection only';
  info.querySelector('.footnote').textContent = 'Discovery reads characteristic properties only. No authentication packets, OTA subscriptions or firmware writes are implemented.';
  document.querySelector('#panel-ota .lower-grid article:last-child .footnote').textContent = 'Captured map. Normal FitPro, Device Info, Battery and AE00 are permitted at connection time. AE00 is only inspected when requested.';
  document.getElementById('open-watchfaces').addEventListener('click',() => document.querySelector('[data-panel="dials"]').click());
  const manifest = node('button','Download packet preview','small'); manifest.id = 'download-transfer-preview';
  document.getElementById('upload').parentElement.append(manifest);
}

export function setupLab({ action, review, protocol, report, onSent }) {
  const root = document.getElementById('lab-cards');
  for (const [key, command] of Object.entries(COMMANDS)) {
    if (!command.payload) continue;
    const card = node('article', '', 'card lab-card');
    card.dataset.command = key;
    const top = node('div', '', 'card-top');
    top.append(node('span', `12 / ${code(command.sub)}`, 'eyebrow'), node('span',command.safety,`badge ${command.safety.toLowerCase()}`));
    card.append(top, node('h3',command.name), node('p',command.note,'footnote'));
    const inputs = node('div', '', 'lab-inputs');
    card.append(inputs);
    let enabled, categoryIndex, categoryBit, acknowledge;
    const byteInputs = [];
    if (['switch','notifications','sedentary'].includes(command.kind)) {
      enabled = checked(inputs, command.kind === 'notifications' ? 'Desired SMS test state: on (unchecked = off)' : 'Desired state: on (unchecked = off)');
      enabled.setAttribute('role','switch');
    }
    if (command.defaults) {
      const grid = node('div','','byte-fields');
      command.defaults.forEach((value,index) => {
        if (key === 'sedentary' && index === 1) return;
        byteInputs[index] = numeric(grid,`Byte ${index} · unconfirmed`,value);
      });
      inputs.append(grid);
    }
    if (key === 'notifications') {
      const choice = node('div','','two-fields');
      categoryIndex = numeric(choice,'SMS test byte index (unconfirmed)',0,11);
      categoryBit = numeric(choice,'SMS test bit (unconfirmed)',0,7);
      inputs.append(choice);
      acknowledge = checked(inputs,'I chose this unconfirmed SMS position/bit for testing.');
    }
    const previewLabel = node('h4','Packet Preview');
    const interpretation = node('p','','footnote');
    const preview = node('pre');
    const result = node('p','State unknown · nothing sent.','command-state');
    result.setAttribute('role','status'); result.dataset.labResult = ''; result.dataset.command = key;
    card.append(previewLabel,interpretation,preview);
    let lastParameters = {enabled:true,operation:'set'};
    const build = () => {
      const bytes = command.defaults?.map((value,index) => byteInputs[index] ? numberValue(byteInputs[index]) : value);
      const parameters = {...lastParameters, bytes};
      if (enabled) parameters.enabled = enabled.checked;
      if (categoryIndex) Object.assign(parameters,{index:numberValue(categoryIndex),bit:numberValue(categoryBit)});
      const packet = frame(command.group,command.sub,commandPayload(key,parameters));
      const meaning = key === 'alarm' ? parameters.operation === 'delete' ? 'Delete request · empty payload; may clear all alarms.' : 'Add/set alarm using five captured-format bytes; time/day meanings unknown.' : `${command.name}: ${parameters.enabled ? 'on / start' : 'off / stop'} requested.${key === 'notifications' ? ` Test byte ${parameters.index}, bit ${parameters.bit}; mapping unconfirmed.` : ''}`;
      interpretation.textContent = meaning;
      preview.textContent = hex(packet);
      return {packet,meaning};
    };
    const updatePreview = () => { try { build(); } catch (error) { preview.textContent = error.message; interpretation.textContent = 'Fix inputs before sending.'; } };
    inputs.addEventListener('input',updatePreview);
    const buttons = node('div','','button-row');
    const choices = command.kind === 'action' ? [[command.actions[0],{enabled:true}],[command.actions[1],{enabled:false}]] : key === 'alarm' ? [['Review add / set',{operation:'set'}],['Review delete',{operation:'delete'}]] : [['Review / test',{}]];
    for (const [label,parameters] of choices) {
      const button = node('button',label,'lab-send');
      button.addEventListener('click',() => action(async () => {
        lastParameters = {...lastParameters,...parameters};
        const {packet,meaning} = build();
        if (acknowledge && !acknowledge.checked) throw new Error('Explicitly acknowledge the SMS test position before reviewing a send.');
        if (!await review(`${command.name} · ${command.safety}`,`${meaning} ${command.note}`,hex(packet))) return;
        await protocol.raw(packet,true);
        result.textContent = `${meaning} Sent · not read back.`;
        onSent(key,lastParameters);
        report(`${command.name} sent. Check the watch and RX events.`);
      }));
      buttons.append(button);
    }
    card.append(buttons,result); root.append(card); updatePreview();
  }
  const reference = document.getElementById('protocol-reference');
  const table = node('table');
  const head = node('tr');
  for (const title of ['Command','Group / sub','Safety','Payload / evidence']) head.append(node('th',title));
  const thead = node('thead'); thead.append(head); table.append(thead);
  const body = node('tbody');
  for (const command of Object.values(COMMANDS)) {
    const row = node('tr');
    row.append(node('td',command.name),node('td',command.group === undefined ? 'AE00 / AE01 / AE02' : `${code(command.group)} / ${code(command.sub)}`));
    const safety = node('td'); safety.append(node('span',command.safety,`badge ${command.safety.toLowerCase()}`));
    row.append(safety,node('td',command.note)); body.append(row);
  }
  table.append(body); reference.append(table);
  setupQuickControls();
  setupRaw();
}

function setupQuickControls() {
  const root = document.getElementById('quick-controls');
  for (const item of QUICK_CONTROLS) {
    const row = node('div','','quick-control-row');
    const identity = node('div');
    identity.append(node('strong',item.name),node('small',`${item.mapping}${item.experimental ? ' · EXPERIMENTAL' : ''}`));
    const actions = node('div','','segmented quick-actions');
    for (const action of item.actions) {
      const button = node('button',action.label,'lab-send');
      button.addEventListener('click',() => {
        if (action.panel) { document.querySelector(`[data-panel="${action.panel}"]`).click(); return; }
        const card = document.querySelector(`.lab-card[data-command="${item.command}"]`);
        const state = card.querySelector('[role="switch"]');
        if (state && action.enabled !== undefined) { state.checked = action.enabled; state.dispatchEvent(new Event('input',{bubbles:true})); }
        if (item.command === 'notifications') card.querySelector('input[type="checkbox"]:not([role="switch"])').checked = true;
        card.querySelectorAll('.button-row .lab-send')[action.target ?? 0].click();
      });
      actions.append(button);
    }
    const status = node('span','State unknown','command-state'); status.dataset.quickStatus = item.command;
    const controls = node('div','','quick-control-actions'); controls.append(actions,status);
    row.append(identity,controls); root.append(row);
  }
}

function setupRaw() {
  const root = document.getElementById('raw-fields');
  const group = numeric(root,'Group (decimal; 18 = 0x12)',18);
  const sub = numeric(root,'Subcommand (decimal; 11 = 0x0B)',11);
  const wrapper = node('label','Payload bytes (hex; empty allowed)');
  const payload = node('textarea'); payload.rows = 2; payload.value = '01'; wrapper.append(payload); root.append(wrapper);
  const button = node('button','Build packet preview'); root.append(button);
  const build = () => {
    const target = document.getElementById('raw-hex');
    try {
      const packet = frame(numberValue(group),numberValue(sub),payload.value.trim() ? parseHex(payload.value) : new Uint8Array());
      if (packet.length > 512) throw new Error('Raw packet exceeds 512 bytes.');
      target.value = hex(packet);
      document.getElementById('raw-interpretation').textContent = `Group 0x${code(numberValue(group))} / subcommand 0x${code(numberValue(sub))} · ${packet.length-8} payload bytes. Arbitrary command; meaning not guaranteed.`;
      target.dispatchEvent(new Event('input'));
    } catch (error) { document.getElementById('raw-interpretation').textContent = error.message; }
  };
  button.addEventListener('click',build);
}
