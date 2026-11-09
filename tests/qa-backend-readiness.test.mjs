import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { waitForQaBackend } from '../scripts/qa/backend-ready.mjs';

async function listener(identity) {
  const child = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const server = http.createServer((req, res) => {res.setHeader('Content-Type','application/json');res.end(${JSON.stringify(JSON.stringify(identity))});});
    server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));
  `], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const [message] = await once(child.stdout, 'data');
  const port = Number(message.toString().trim());
  assert(port > 0);
  return { child, port, origin: `http://127.0.0.1:${port}`, close: async () => { child.kill(); await closed; } };
}

test('QA readiness accepts a live listener only for its synthetic run', async () => {
  const server = await listener({ synthetic: true, runId: 'owned-unit-run' });
  try { await waitForQaBackend(server.child, server.origin, 'owned-unit-run'); }
  finally { await server.close(); }
});

test('an unrelated HTTP 200 listener cannot pass QA readiness', async () => {
  const server = await listener({ synthetic: true, runId: 'another-run' });
  try { await assert.rejects(waitForQaBackend(server.child, server.origin, 'owned-unit-run'), /ownership mismatch/); }
  finally { await server.close(); }
});

test('a backend that loses the port bind race cannot adopt the existing server', async () => {
  const server = await listener({ synthetic: true, runId: 'another-run' });
  const child = spawn(process.execPath, ['-e', "require('node:http').createServer().listen(Number(process.argv[1]),'127.0.0.1')", String(server.port)],
    { windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  try { await assert.rejects(waitForQaBackend(child, server.origin, 'owned-unit-run'), /ownership mismatch|exited/); }
  finally { child.kill(); await closed; await server.close(); }
});

test('a stopped child cannot pass readiness even if its origin is well formed', async () => {
  const server = await listener({ synthetic: true, runId: 'owned-unit-run' });
  await server.close();
  await assert.rejects(waitForQaBackend(server.child, server.origin, 'owned-unit-run'), /exited/);
  await assert.rejects(waitForQaBackend(server.child, 'https://example.invalid', 'owned-unit-run'), /loopback/);
});
