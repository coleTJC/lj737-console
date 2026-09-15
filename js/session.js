export const MAX_ENTRIES = 50000;
const columns = ['time','direction','characteristic','hex','command','message'];
function validate(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Session must contain at most 50,000 events.');
  return entries.map(entry => {
    if (!entry || typeof entry.time !== 'string' || !Number.isFinite(Date.parse(entry.time)) || !['TX','RX','SYS'].includes(entry.direction)) throw new Error('Invalid event timestamp or direction.');
    const result = {};
    for (const key of columns) {
      const value = entry[key] ?? '';
      if (typeof value !== 'string' || value.length > 65536) throw new Error(`Invalid event ${key}.`);
      result[key] = value;
    }
    if (result.hex && !/^(?:[\da-f]{2})(?: [\da-f]{2})*$/i.test(result.hex)) throw new Error('Invalid event hex bytes.');
    return result;
  });
}
export function exportSession(entries, format) {
  const rows = validate(entries);
  if (format === 'json') return JSON.stringify({format:'lj737-log-v2',timestamps:'UTC',exportedAt:new Date().toISOString(),entries:rows},null,2);
  if (format !== 'csv') throw new Error('Choose JSON or CSV.');
  const quote = value => `"${(/^[=+\-@\t\r']/.test(value) ? "'" : '') + value.replaceAll('"','""')}"`;
  return [columns.join(','), ...rows.map(entry => columns.map(key => quote(entry[key])).join(','))].join('\r\n');
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index+1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') {
        if (char === '\r' && text[index+1] === '\n') index++;
        rows.push(row); row = [];
        if (rows.length > MAX_ENTRIES+1) throw new Error('Too many CSV rows.');
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Malformed CSV quoting.');
      field += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV field.');
  if (field || row.length || closed) rows.push([...row,field]);
  return rows;
}
export function importSession(text,format) {
  if (text.length > 32*1024*1024) throw new Error('Session file exceeds 32 MiB.');
  if (format === 'json') {
    const data = JSON.parse(text);
    if (!['lj737-log-v1','lj737-log-v2'].includes(data?.format)) throw new Error('Unrecognized session format.');
    return validate(data.entries);
  }
  if (format !== 'csv') throw new Error('Choose JSON or CSV.');
  const [header,...rows] = parseCSV(text.replace(/^\uFEFF/,''));
  if (header?.join(',') !== columns.join(',')) throw new Error('CSV column headers do not match this app.');
  return validate(rows.map(row => {
    if (row.length !== columns.length) throw new Error('Invalid CSV row length.');
    return Object.fromEntries(columns.map((key,index) => [key, /^'[=+\-@\t\r']/.test(row[index]) ? row[index].slice(1) : row[index]]));
  }));
}
