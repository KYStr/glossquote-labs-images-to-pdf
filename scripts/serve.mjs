import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT, PUBLIC_FILES, inventory, requireNode } from './files.mjs';

const routes = new Map(PUBLIC_FILES.map(file => ['/' + file, file]));
routes.set('/', 'index.html');
routes.set('/en/', 'en/index.html');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export function createHandler(read = file => readFile(path.join(ROOT, 'dist', file))) {
  return async (request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== '127.0.0.1:4226') { response.writeHead(403); response.end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); response.writeHead(405); response.end(); return; }
    const file = routes.get(request.url);
    if (!file) { response.writeHead(404); response.end(); return; }
    try {
      const bytes = await read(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Content-Length': bytes.byteLength });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404); response.end(); }
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts', 'serve.mjs')) {
  requireNode();
  await inventory(path.join(ROOT, 'dist'));
  const server = http.createServer(createHandler());
  server.on('error', () => { console.error('Preview unavailable; existing processes are preserved.'); process.exitCode = 1; });
  server.listen(4226, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4226 (no browser launched)'));
}
