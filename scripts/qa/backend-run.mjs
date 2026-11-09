import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupBackendRuntime } from './backend-cleanup.mjs';
import { backendPhpEnvironment, resolveBackendPhp } from './backend-php.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const normalize = (path) => path.replaceAll('\\', '/');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || 'true']; }));
const php = await resolveBackendPhp(args.php);
const runId = args['run-id'] || `${new Date().toISOString().replaceAll(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid run id');
const output = resolve(root, args.output || `output/qa/3.1.7-2026-11-03/backend/${runId}`);
if (existsSync(output)) throw new Error('A fresh output directory is required');
mkdirSync(join(output, 'logs'), { recursive: true });
const results = [];
const sourceHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const phpQuote = (text) => `'${normalize(text).replaceAll("'", "\\'")}'`;

async function command(binary, commandArgs, env = {}, timeout = 180000) {
  return await new Promise((done) => {
    const started = Date.now();
    const child = spawn(binary, commandArgs, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr: error.message, durationMs: Date.now() - started, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr, durationMs: Date.now() - started, timedOut }); });
  });
}
function record(name, level, execution, extra = {}) {
  // Reports contain synthetic fixture output only; redact even synthetic session/secret values.
  const sanitize = (text) => text.replace(/(GENESISSESSID[=; ]+)[^\s;]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|crypto_key|client_secret|csrf)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  const log = join(output, 'logs', `${name}.log`);
  writeFileSync(log, sanitize(execution.stdout + execution.stderr));
  const status = execution.code === 0 && !execution.timedOut ? 'PASS' : 'FAIL';
  const row = { id: `backend.${name}`, level, status, durationMs: execution.durationMs, exitCode: execution.code,
    evidence: normalize(log), evidenceSha256: sourceHash(readFileSync(log)), ...extra };
  results.push(row); writeFileSync(join(output, 'results.json'), JSON.stringify({ runId, results }, null, 2));
  console.log(`${row.status} ${name} (${execution.durationMs} ms)`);
  if (status === 'FAIL') console.error(sanitize(execution.stdout + execution.stderr).slice(-6000));
}

const version = await command(php, ['-v']);
if (version.code !== 0) throw new Error('PHP runtime unavailable; supply --php=<path>');
writeFileSync(join(output, 'runtime.txt'), version.stdout);
const testFiles = readdirSync(join(root, 'server/tests')).filter((file) => file.endsWith('.php'));
const helpers = new Map([
  ['physis-browser.php', 'browser fixture utility'], ['physis-router.php', 'HTTP fixture router'], ['physis-worker.php', 'worker of physis-security'],
  ['resource-limits.php', 'included by security-lifecycle in shared-projects'], ['security-lifecycle.php', 'included by shared-projects'],
  ['security-auth-http.php', 'called by security-lifecycle'], ['shared-collaboration.php', 'included by shared-projects'],
  ['shared-approvals-permissions.php', 'included by shared-projects'], ['shared-task-download-http.php', 'called by shared-task-attachments'],
  ['task-graph-integrations.php', 'called by template-apply'], ['workflow-integrations.php', 'called by shared-workflows'],
  ['shared-fixture-plan.php', 'ordinary Business entitlement fixture for collaboration suites'],
]);
const inventory = testFiles.map((file) => ({ file: `server/tests/${file}`, kind: helpers.has(file) ? 'helper' : 'suite', reason: helpers.get(file) }));
writeFileSync(join(output, 'inventory.json'), JSON.stringify(inventory, null, 2));
const filesToLint = [];
function enumerate(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { if (entry.name === 'var' || entry.name === 'config.php') continue; const child = join(path, entry.name); if (entry.isDirectory()) enumerate(child); else if (entry.name.endsWith('.php')) filesToLint.push(child); } }
enumerate(join(root, 'server')); enumerate(join(root, 'scripts/qa'));
if (!args.only) {
  const start = Date.now(); const lint = [];
  for (const file of filesToLint) { const execution = await command(php, ['-l', file], {}, 30000); if (execution.code !== 0) lint.push({ file, ...execution }); }
  record('syntax', 'static', { code: lint.length ? 1 : 0, durationMs: Date.now() - start, stdout: JSON.stringify({ checkedFiles: filesToLint.length, failures: lint }, null, 2), stderr: '' }, { checkedFiles: filesToLint.length });
}
const selected = testFiles.filter((file) => !helpers.has(file) && (!args.only || args.only.split(',').includes(file.replace('.php', ''))));
for (const file of selected) {
  const name = file.replace('.php', ''); const source = readFileSync(join(root, 'server/tests', file), 'utf8');
  const directory = normalize(join(output, 'runtime', name));
  mkdirSync(join(directory, 'sessions'), { recursive: true }); mkdirSync(join(directory, 'tmp'));
  const selfConfig = /define\(['"]GENESIS_LOCAL_TEST_CONFIG['"]/.test(source) && !['shared-task-download-http.php'].includes(file);
  const mapFixture = ['mindmaps', 'mindmaps-native-contract', 'shared-mindmaps'].includes(name);
  const accountRace = name === 'account-layout-concurrency';
  const config = { app_url: accountRace ? 'http://127.0.0.1:4338' : 'https://localhost.invalid', google_only: true,
    google_client_id: '', google_client_secret: '', gigachat_enabled: false, gemini_enabled: false,
    crypto_key: randomBytes(32).toString('base64'), db_path: `${directory}/${mapFixture ? 'mindmaps-test' : accountRace ? 'improvements-test' : 'genesis'}.sqlite`,
    session_path: `${directory}/sessions`, cookie_secure: false, timezone: 'Europe/Moscow',
    admin_email: 'nikitalexanderson@gmail.com', notifications: { email: { transport: 'disabled' } }, billing: { enabled: false } };
  const configText = `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(config)).toString('base64')}'),true,512,JSON_THROW_ON_ERROR);`;
  writeFileSync(join(directory, 'config.php'), configText);
  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ directory, configSha256: sourceHash(configText), synthetic: true }));
  // The few older map suites require the file to exist before they open it.
  if (mapFixture) writeFileSync(config.db_path, '');
  const baseIniPath = resolve(dirname(php), 'php.ini');
  const baseIni = existsSync(baseIniPath) ? readFileSync(baseIniPath, 'utf8') : '';
  const ini = `${baseIni}\ndisable_functions=curl_exec,mail\nsys_temp_dir="${directory}/tmp"\nlog_errors=1\nerror_log="${directory}/php-error.log"\nauto_prepend_file="${normalize(join(root, 'scripts/qa/backend-prepend.php'))}"\n`;
  const iniPath = join(directory, 'php.ini'); writeFileSync(iniPath, ini);
  const wrapper = join(directory, 'run.php');
  writeFileSync(wrapper, `<?php\n$qaCompleted=false;register_shutdown_function(static function()use(&$qaCompleted){if(!$qaCompleted){fwrite(STDERR,"QA_INCOMPLETE_SUITE\\n");exit(97);}});\nrequire ${phpQuote(join(root, 'server/tests', file))};\n$qaCompleted=true;echo "\\nQA_COMPLETED_SUITE\\n";\n`);
  const env = { PHPRC: iniPath, GENESIS_FULL_QA: 'isolated', GENESIS_QA_TEST_DIR: directory,
    GENESIS_QA_SELF_CONFIG: selfConfig ? '1' : '0', GENESIS_IMPROVEMENTS_TEST: 'isolated', GENESIS_MINDMAPS_TEST: 'isolated',
    GENESIS_LOCAL_CI_DIR: directory, GENESIS_SMOKE_ROOT: directory, GENESIS_MINDMAPS_FIXTURE_ROOT: directory,
    ...backendPhpEnvironment(php) };
  const execution = await command(php, ['-c', iniPath, wrapper], env, Number(args.timeout || 600000));
  if (existsSync(join(directory, 'php-error.log'))) execution.stderr += readFileSync(join(directory, 'php-error.log'), 'utf8');
  record(name, 'logic/integration', execution, { source: `server/tests/${file}`, freshDatabase: true,
    mocks: /injected|fake|synthetic|fixture/i.test(source), selfContainedFixture: selfConfig });
  if (!args['keep-runtime']) {
    try { results.at(-1).cleanup = cleanupBackendRuntime(directory, output); }
    catch (error) { results.at(-1).cleanup = { status:'FAIL', error:error.message };results.at(-1).status='FAIL';console.log(`FAIL cleanup ${name}`); }
  }
}
const summary = Object.fromEntries(['PASS', 'FAIL'].map((status) => [status, results.filter((row) => row.status === status).length]));
writeFileSync(join(output, 'results.json'), JSON.stringify({ runId, isolation: { productionConfigRead: false, productionDatabaseTouched: false,
  providerTransport: 'curl_exec and mail disabled', sessions: 'per-suite', database: 'per-suite', php: version.stdout.split('\n')[0] }, summary, results }, null, 2));
console.log(JSON.stringify({ runId, output: normalize(output), summary }));
process.exitCode = summary.FAIL ? 1 : 0;
