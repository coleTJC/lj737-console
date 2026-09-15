import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain', '.bin': 'application/octet-stream' };
http.createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403).end('Forbidden'); return; }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}${['.html','.css','.js','.json','.md'].includes(extname(file)) ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  } catch { response.writeHead(404).end('Not found'); }
}).on('error', error => {
  console.error(`Unable to open localhost:${port}: ${error.message}. Try another PORT value.`);
  process.exitCode = 1;
}).listen(port, '127.0.0.1', () => console.log(`LJ737 console: http://localhost:${port}`));
