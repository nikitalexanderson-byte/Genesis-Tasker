import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

if (process.env.GENESIS_FULL_QA !== 'isolated') throw new Error('Explicit isolation required');
const directory = path.resolve(process.env.GENESIS_FULL_QA_DIR || '');
const owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json'), 'utf8'));
if (!owner.synthetic || owner.directory !== directory.replaceAll('\\', '/') || owner.origin !== 'https://localhost:4443') {
  throw new Error('Unexpected fixture owner or origin');
}
const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'localhost.key')),
  cert: fs.readFileSync(path.join(directory, 'localhost.crt')) }, (request, response) => {
  const url = new URL(request.url, owner.origin);
  if (!url.pathname.startsWith('/api/')) { response.writeHead(404); response.end(); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: 4382, path: url.pathname + url.search,
    method: request.method, headers: { ...request.headers, host: 'localhost:4443', 'x-forwarded-proto': 'https' } }, result => {
    response.writeHead(result.statusCode, result.headers); result.pipe(response);
    result.on('end', () => fs.appendFileSync(path.join(directory, 'requests.jsonl'), JSON.stringify({
      method: request.method, path: url.pathname, status: result.statusCode }) + '\n'));
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.pipe(upstream);
});
server.listen(4443, '127.0.0.1', () => console.log('Owned native QA TLS fixture ready'));
