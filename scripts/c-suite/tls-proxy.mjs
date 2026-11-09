import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

if (process.env.GENESIS_IMPROVEMENTS_TEST !== 'isolated') throw Error('Explicit isolated environment required');
const suite = process.env.GENESIS_ACCEPTANCE_SUITE || 'c-suite';
if (!['c-suite', 'efg-suite', 'kul-suite', 'audit-suite', 'audit-ui-suite'].includes(suite)) throw Error('Unknown isolated suite');
const runtime = new URL(`../../output/${suite}/https/`, import.meta.url);
const server = https.createServer({key: fs.readFileSync(new URL('localhost.key', runtime)), cert: fs.readFileSync(new URL('localhost.crt', runtime))}, (request, response) => {
  const url = new URL(request.url, 'https://localhost:4443');
  if (url.pathname === '/health') {
    response.writeHead(200, {'Content-Type': 'application/json'}); response.end('{"ok":true,"fixture":true}'); return;
  }
  if (!url.pathname.startsWith('/api/') && !/^\/__fixture\/(sign-in|add-member|worker|state)$/.test(url.pathname)) {
    response.writeHead(404); response.end(); return;
  }
  const hash = crypto.createHash('sha256');
  const proxy = http.request({host: '127.0.0.1', port: 4338, path: url.pathname + url.search, method: request.method,
    headers: {...request.headers, host: '127.0.0.1:4338'}}, upstream => {
    response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
    upstream.on('end', () => fs.appendFileSync(new URL('requests.jsonl', runtime), JSON.stringify({method: request.method,
      path: url.pathname, status: upstream.statusCode, bodySha256: hash.digest('hex')}) + '\n'));
  });
  proxy.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.on('data', part => hash.update(part)); request.pipe(proxy);
});
server.listen(4443, '127.0.0.1', () => console.log('Synthetic C-suite TLS fixture on loopback 4443'));
