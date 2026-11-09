import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBackendPhp } from './backend-php.mjs';
import { startWebServer } from './web-server.mjs';
import { cleanupBackendRuntime } from './backend-cleanup.mjs';
import { waitForQaBackend } from './backend-ready.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check' && !/^--(?:port|api-port)=\d+$/.test(arg))) throw new Error('Supported arguments: --port=4380 --api-port=4381 --check');
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 4380);
const apiPort = Number(args.find(arg => arg.startsWith('--api-port='))?.slice(11) ?? 4381);
if (![port, apiPort].every(value => value >= 1024 && value <= 65535) || port === apiPort) throw new Error('Use two different unprivileged ports');
const runId = `serve-${Date.now()}-${randomBytes(3).toString('hex')}`;
const output = path.join(root, 'output/qa', runId), runtime = path.join(output, 'runtime');
mkdirSync(output, { recursive: true });
const php = await resolveBackendPhp();
const origin = `http://127.0.0.1:${port}`;
const prepared = spawnSync(php, ['-d', 'disable_functions=curl_exec,mail', 'scripts/qa/backend-fixture.php',
  `--dir=${runtime}`, `--origin=${origin}`, `--run-id=${runId}`], { cwd: root, encoding: 'utf8', windowsHide: true });
if (prepared.status !== 0) throw new Error('Synthetic fixture initialization failed: ' + (prepared.stderr || prepared.error?.message));
const log = createWriteStream(path.join(output, 'local-api.log'));
const api = spawn(php, ['-d', 'disable_functions=curl_exec,mail', '-S', `127.0.0.1:${apiPort}`, 'scripts/qa/backend-router.php'],
  { cwd: root, windowsHide: true, env: { ...process.env, GENESIS_FULL_QA: 'isolated', GENESIS_FULL_QA_DIR: runtime.replaceAll('\\', '/') },
    stdio: ['ignore', 'pipe', 'pipe'] });
const closed = new Promise(resolve => api.once('close', resolve));
api.stdout.pipe(log); api.stderr.pipe(log);
let web;
try {
  await waitForQaBackend(api, `http://127.0.0.1:${apiPort}`, runId);
  web = await startWebServer({ port, apiPort });
  console.log(`Application: ${origin}/`);
  for (const tier of ['free', 'standart', 'premium', 'business', 'premium4life']) console.log(`Synthetic ${tier}: ${origin}/api/qa/login?tier=${tier}`);
  if (args.includes('--check')) {
    const response = await fetch(`${origin}/`);
    if (!response.ok || !(await response.text()).includes('id="root"')) throw new Error('Local web bundle health check failed');
    console.log('Loopback web/API startup PASS');
  } else await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally {
  if (web) { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); }
  if (api.exitCode === null && api.signalCode === null) api.kill();
  await closed;
  log.end();
  try { cleanupBackendRuntime(runtime, output); }
  catch (error) { console.error(`Synthetic runtime cleanup failed: ${error.message}`); process.exitCode = 1; }
}
