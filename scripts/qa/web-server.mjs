import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

/** Serve the actual release web bundle and proxy only to the isolated loopback API. */
export async function startWebServer({ port = 4380, apiPort = 4381 } = {}) {
  const directory = path.join(root, 'dist-web', 'public_html');
  if (!existsSync(path.join(directory, 'index.html'))) throw new Error('Build the web client with pnpm build:web first');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      const upstream = http.request({ hostname: '127.0.0.1', port: apiPort, path: url.pathname + url.search, method: request.method, headers: { ...request.headers, host: `127.0.0.1:${port}` } }, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on('error', () => { response.writeHead(502); response.end('Isolated API unavailable'); });
      request.pipe(upstream);
      return;
    }
    let candidate;
    try { candidate = path.resolve(directory, `.${decodeURIComponent(url.pathname)}`); }
    catch { response.writeHead(400); response.end(); return; }
    if (candidate !== directory && !candidate.startsWith(directory + path.sep)) { response.writeHead(403); response.end(); return; }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      if (path.extname(candidate)) { response.writeHead(404); response.end(); return; }
      candidate = path.join(directory, 'index.html');
    }
    const stream = createReadStream(candidate);
    stream.on('error', () => { if (!response.headersSent) response.writeHead(503); response.end('Bundle temporarily unavailable'); });
    stream.once('open', () => { response.writeHead(200, { 'Content-Type': types[path.extname(candidate)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); stream.pipe(response); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startWebServer();
  console.log('Isolated release preview listening on http://127.0.0.1:4380');
}
