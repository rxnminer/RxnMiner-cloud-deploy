import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('website/dist');
const api = spawn(process.execPath, ['website/demo-api/server.mjs'], { stdio: 'inherit' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.json': 'application/json' };
const gateway = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/demo')) {
      // Same-origin gateway: reject cross-origin browser submissions before
      // removing Origin for the loopback upstream.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403); res.end('Origin not allowed'); return;
      }
      const headers = { ...req.headers, host: '127.0.0.1:18842' };
      delete headers.origin;
      const upstream = http.request({ host: '127.0.0.1', port: 18842, path: req.url, method: req.method, headers },
        response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('API unavailable'); });
      req.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let file = path.resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (file !== dist && !file.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'content-length': bytes.length, 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
gateway.listen(18840, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  api.kill(signal); gateway.close(); setTimeout(() => process.exit(), 10000).unref();
});
api.on('exit', code => { gateway.close(); process.exit(code || 1); });
