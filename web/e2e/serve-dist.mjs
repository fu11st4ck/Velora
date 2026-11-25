// Serves the production build the way deploy/Caddyfile does — same security headers (read from
// the Caddyfile itself), same compression, same fallback to index.html, /api proxied to the API — so the CSP and the
// production build can be tested without Docker. Development and CI use only.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createGzip } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', 'dist', 'velora-web', 'browser');
const port = Number(process.env.PORT ?? 4400);
const apiPort = Number(process.env.API_PORT ?? 3100);
const caddyfile = readFileSync(join(here, '..', '..', 'deploy', 'Caddyfile'), 'utf8');

// Headers set in the Caddyfile: `Name "value"` lines inside header { } blocks, and `header Name "value"` lines.
const headers = {};
for (const m of caddyfile.matchAll(/^\s*(?:header\s+)?([A-Z][A-Za-z-]+)\s+"([^"]*)"\s*$/gm)) headers[m[1]] = m[2];
if (!headers['Content-Security-Policy']) throw new Error('No Content-Security-Policy found in deploy/Caddyfile');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = request({ host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const type = types[extname(file)] ?? 'application/octet-stream';
  // Like Caddy's `encode zstd gzip`: compress text responses for clients that accept it.
  const compress = /gzip/.test(req.headers['accept-encoding'] ?? '') && /text|javascript|json|svg/.test(type);
  res.writeHead(200, { ...headers, 'Content-Type': type, ...(compress ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  if (compress) createReadStream(file).pipe(createGzip()).pipe(res);
  else createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on ${port}`));
