// Minimal static file server for Firebase App Hosting (no dependencies). Serves ./dist with SPA fallback.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = normalize(join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const ext = extname(file);
  const noCache = file.endsWith('index.html') || file.endsWith('sw.js');
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => console.log(`Serving dist on port ${port}`));
