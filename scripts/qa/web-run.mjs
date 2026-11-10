import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { startWebServer } from './web-server.mjs';
import { cleanupBackendRuntime } from './backend-cleanup.mjs';
import { resolveBackendPhp } from './backend-php.mjs';
import { filesBelow, hash } from './full-lib.mjs';
import { runSharedStartup } from './web-shared-startup.mjs';
import { waitForQaBackend } from './backend-ready.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(argument => { const [key, ...parts] = argument.replace(/^--/, '').split('='); return [key, parts.join('=')]; }));
const suite = args.suite ?? 'full';
if (!['full', 'followup317', 'trial317', 'history317', 'retention', 'header', 'dialog-focus'].includes(suite)) throw new Error('Unknown web QA suite');
const id = args['run-id'] ?? `web-${Date.now()}-${randomBytes(3).toString('hex')}`;
if (!/^[a-zA-Z0-9-]{6,80}$/.test(id)) throw new Error('Invalid run ID');
const output = path.resolve(root, args.output ?? `output/playwright/full-qa/${id}`);
if (existsSync(output)) throw new Error('Fresh run output required');
mkdirSync(output, { recursive: true });
const runtime = path.join(output, 'runtime');
const php = await resolveBackendPhp(args.php);
const bundleDirectory = path.join(root, 'dist-web/public_html');
const bundleIdentity = () => {
  const files = filesBelow(bundleDirectory).sort().map(file => ({ path: path.relative(bundleDirectory, file).replaceAll('\\', '/'), sha256: hash(readFileSync(file)) }));
  if (!files.some(file => file.path === 'index.html')) throw new Error('Missing compiled web bundle');
  return { sha256: hash(JSON.stringify(files)), files };
};
const build = bundleIdentity();
async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
const port = await freePort(), apiPort = await freePort();
const origin = `http://127.0.0.1:${port}`;
const prepared = spawnSync(php, ['-d', 'disable_functions=curl_exec,mail', 'scripts/qa/backend-fixture.php', `--dir=${runtime}`, `--origin=${origin}`, `--run-id=${id}`], { cwd: root, encoding: 'utf8', windowsHide: true });
if (prepared.status !== 0) throw new Error('Synthetic fixture preparation failed: ' + (prepared.stderr || prepared.error?.message));
const apiLog = createWriteStream(path.join(output, 'local-api.log'));
const api = spawn(php, ['-d', 'disable_functions=curl_exec,mail', '-S', `127.0.0.1:${apiPort}`, 'scripts/qa/backend-router.php'], { cwd: root, windowsHide: true, env: { ...process.env, GENESIS_FULL_QA: 'isolated', GENESIS_FULL_QA_DIR: runtime.replaceAll('\\', '/') }, stdio: ['ignore', 'pipe', 'pipe'] });
const apiClosed = new Promise(resolve => api.once('close', resolve));
api.stdout.pipe(apiLog); api.stderr.pipe(apiLog);
let server, runError, startupGate, featureExitCode;
try {
  await waitForQaBackend(api, `http://127.0.0.1:${apiPort}`, id);
  server = await startWebServer({ port, apiPort });
  startupGate = await runSharedStartup({ baseURL: origin, output });
  const exitCode = await new Promise((resolve, reject) => {
    const script = {full: 'scripts/qa/web-full.mjs', followup317: 'scripts/qa/web-followup317.mjs', trial317: 'scripts/qa/web-trial-only317.mjs', history317: 'scripts/qa/web-hidden-map-history317.mjs', retention: 'scripts/qa/web-retention.mjs', header: 'scripts/qa/web-header-startup.mjs', 'dialog-focus': 'scripts/qa/web-dialog-focus.mjs'}[suite];
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, env: { ...process.env, GENESIS_QA_WEB_ORIGIN: origin, GENESIS_QA_WEB_OUTPUT: output, GENESIS_QA_BACKEND_RUNTIME: runtime, GENESIS_QA_PHP: php, GENESIS_QA_PHASE: 'isolated', ...(args.focus ? { GENESIS_QA_FOLLOWUP_SCOPE: args.focus } : {}), ...(args.tiers ? { GENESIS_QA_TIERS: args.tiers } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(path.join(output, 'web.log'));
    child.stdout.on('data', data => { log.write(data); process.stdout.write(data); });
    child.stderr.on('data', data => { log.write(data); process.stderr.write(data); });
    child.once('error', reject); child.once('close', code => { log.end(); resolve(code ?? 1); });
  });
  featureExitCode = exitCode;
  process.exitCode = exitCode || (startupGate.status === 'PASS' ? 0 : 1);
  if (startupGate.status !== 'PASS') runError = 'Shared startup gate failed; existing web feature checks were still executed';
} catch (error) { runError = error.message; process.exitCode = 1; }
finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (api.exitCode === null && api.signalCode === null) api.kill();
  await apiClosed;
  apiLog.end();
  const cleanup = cleanupBackendRuntime(runtime, output);
  const buildAfter = bundleIdentity();
  if (buildAfter.sha256 !== build.sha256) { runError = 'Compiled web bundle changed during the test run'; process.exitCode = 1; }
  writeFileSync(path.join(output, 'run.json'), JSON.stringify({ runId: id, origin, featureExitCode: featureExitCode ?? null, build, buildAfterSha256: buildAfter.sha256, startupGate: startupGate ?? null, externalNetwork: 'browser allows only local origin; PHP curl/mail disabled; no provider credentials', cleanup, error: runError ?? null }, null, 2));
  if (runError) console.error(runError);
}
