import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupBackendRuntime } from './backend-cleanup.mjs';
import { backendPhpEnvironment, resolveBackendPhp } from './backend-php.mjs';
import { sourceSnapshot } from './full-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const runId = args['run-id'] || `task-shapes-${Date.now()}-${randomBytes(3).toString('hex')}`;
assert.match(runId, /^[a-zA-Z0-9-]{6,80}$/);
const output = resolve(root, args.output || `output/qa/${runId}`);
const child = relative(join(root, 'output/qa'), output);
assert(child && !isAbsolute(child) && !child.startsWith('..'), 'Fixture output must be owned by output/qa');
assert(!existsSync(output), 'Fresh fixture output required');
mkdirSync(output, { recursive: true });
const runtime = join(output, 'runtime').replaceAll('\\', '/');
const report = { schemaVersion: 1, runId, synthetic: true, status: 'FAIL', origin: null,
  sourceSha256: sourceSnapshot(root).sha256, generatedAt: new Date().toISOString(),
  scope: 'Current production task normalization, encrypted cache and local HTTP bootstrap; no real Google service or historical production records.',
  externalDelivery: 'disabled', fixture: null, cleanup: null };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let server, closed, php;
function command(file, params) {
  const result = spawnSync(php, ['-d', 'disable_functions=curl_exec,mail', file, ...params], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, ...backendPhpEnvironment(php) },
  });
  // Never expose configuration/session output on a failed child.
  assert.equal(result.status, 0, `Synthetic setup failed: ${file} (exit ${result.status})`);
  return JSON.parse(result.stdout);
}
try {
  php = await resolveBackendPhp(args.php);
  const port = await new Promise((done, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => done(port)); });
  });
  const origin = `http://127.0.0.1:${port}`; report.origin = origin;
  command('scripts/qa/backend-fixture.php', [`--dir=${runtime}`, `--origin=${origin}`, `--run-id=${runId}`]);
  const seed = command('scripts/qa/task-shape-seed.php', [`--dir=${runtime}`]);
  assert.equal(seed.synthetic, true);
  server = spawn(php, ['-d', 'disable_functions=curl_exec,mail', '-S', `127.0.0.1:${port}`, 'scripts/qa/backend-router.php'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, GENESIS_FULL_QA: 'isolated', GENESIS_FULL_QA_DIR: runtime, ...backendPhpEnvironment(php) },
  });
  let serverError;
  server.once('error', error => { serverError = error; });
  closed = new Promise(done => server.once('close', done));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverError || server.exitCode !== null) break;
    try { const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* Owned listener is starting. */ }
    await new Promise(done => setTimeout(done, 50));
  }
  assert(ready, 'Owned loopback server did not start');
  const login = await fetch(origin + '/api/qa/login?tier=business', { signal: AbortSignal.timeout(5000) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).synthetic, true);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'Synthetic login did not establish a session');
  const response = await fetch(origin + '/api/bootstrap', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.equal(bootstrap.user?.isAdmin, false);
  assert.equal(bootstrap.syncWarning, null);
  assert.equal(bootstrap.tasksDeferred, false);
  const tasks = bootstrap.tasks;
  assert(Array.isArray(tasks)); assert.equal(tasks.length, 39); assert.equal(seed.expectedRows, 39);
  assert.equal(new Set(tasks.map(task => task.id)).size, 39);
  assert.equal(tasks.filter(task => !task.done).length, 7);
  assert.equal(tasks.filter(task => task.id.length === 119).length, 3);
  assert.equal(tasks.filter(task => task.googleTaskId !== null).length, 27);
  assert.equal(tasks.filter(task => task.googleEventId !== null).length, 12);
  assert(tasks.every(task => task.googleAccountEmail?.endsWith('@example.invalid')));
  assert(tasks.some(task => task.dueDate === '') && tasks.some(task => task.endDate > task.dueDate && task.dueDate));
  assert(tasks.some(task => task.title === 'Без названия'));
  assert(tasks.some(task => /日本語/.test(task.title) && /\n/.test(task.description)));
  assert(tasks.some(task => task.reminders.length === 2));
  for (const mode of ['profane', 'sacred', 'lunar']) assert(tasks.some(task => task.calendarMode === mode));
  for (const mode of ['classic', 'genesis', 'lunar']) assert(tasks.some(task => task.recurrenceMode === mode));
  assert(tasks.every(task => !/sentinel/.test(task.id)));
  // Allowlist only task rows and a non-sensitive report. No workspace key, CSRF, cookie or full bootstrap is written.
  const fixture = { tasks, report: { schemaVersion: 1, totalRows: 39, openRows: 7, longIdRows: 3, synthetic: true,
    source: 'current-server-local-http-bootstrap', runId, sourceSha256: report.sourceSha256,
    shapeChecks: ['native-tasks', 'calendar-events', '119-character-id', 'undated', 'date-range', 'completed', 'unicode', 'multiline', 'fallback-title', 'reminders', 'three-calendar-modes', 'three-recurrence-modes'] } };
  const bytes = Buffer.from(JSON.stringify(fixture, null, 2) + '\n');
  writeFileSync(join(output, 'task-shape.json'), bytes, { flag: 'wx' });
  report.fixture = { path: relative(root, join(output, 'task-shape.json')).replaceAll('\\', '/'), sha256: hash(bytes), bytes: bytes.length, totalRows: 39 };
  report.api = { path: '/api/bootstrap', status: response.status, authenticated: true, syntheticOrdinaryUser: true, warning: null };
  report.sourceAfterSha256 = sourceSnapshot(root).sha256;
  assert.equal(report.sourceAfterSha256, report.sourceSha256, 'Source changed during fixture generation');
  report.status = 'PASS';
} catch (error) {
  report.error = error.message;
} finally {
  if (server) { if (server.exitCode === null) server.kill(); await closed; }
  try { report.cleanup = existsSync(runtime) ? cleanupBackendRuntime(runtime, output) : { status: 'PASS', reason: 'No runtime created' }; }
  catch (error) { report.cleanup = { status: 'FAIL', reason: error.message }; report.status = 'FAIL'; }
  writeFileSync(join(output, 'task-shape-manifest.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, manifest: relative(root, join(output, 'task-shape-manifest.json')).replaceAll('\\', '/'), fixture: report.fixture, cleanup: report.cleanup?.status }));
if (report.status !== 'PASS') process.exitCode = 1;
