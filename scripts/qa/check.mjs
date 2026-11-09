import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.some(arg => !/^--scope=(?:all|web)$/.test(arg))) throw new Error('Supported argument: --scope=all|web');
const scope = args[0]?.slice(8) ?? 'all';
const id = `checks-${Date.now()}-${randomBytes(3).toString('hex')}`, output = path.join(root, 'output/qa', id);
mkdirSync(output, { recursive: true });
const report = { id, scope, startedAt: new Date().toISOString(), safety: { deploy: false, productionData: false }, stages: [],
  external: ['Google OAuth/Calendar/Tasks', 'Payment and Play providers', 'Push/email delivery', 'Physical devices and emulator instrumentation']
    .map(name => ({ name, status: 'UNVERIFIED', reason: 'Requires a separate authorized test environment' })) };
const save = () => writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
async function stage(name, command, arguments_, cwd = root) {
  const row = { name, status: 'RUNNING', startedAt: new Date().toISOString(), log: `${name}.log` };
  report.stages.push(row); save(); console.log(`START ${name}`);
  const log = createWriteStream(path.join(output, row.log));
  await new Promise(resolve => {
    const child = spawn(command, arguments_, { cwd, windowsHide: true, env: { ...process.env, CI: 'true',
      GENESIS_DEPLOY_ANDROID: 'false', GENESIS_MINDMAPS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once('error', error => { row.error = error.message; });
    child.once('close', code => { row.exitCode = code; row.status = code === 0 && !row.error ? 'PASS' : 'FAIL'; resolve(); });
  });
  await new Promise(resolve => log.end(resolve));
  row.finishedAt = new Date().toISOString(); save(); console.log(`${row.status} ${name}`);
}
function packageCommand(script) {
  if (process.env.npm_execpath && /pnpm[^/\\]*\.(?:c?js|mjs)$/i.test(process.env.npm_execpath))
    return [process.execPath, [process.env.npm_execpath, script]];
  return process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `pnpm.cmd ${script}`]] : ['pnpm', [script]];
}
try {
  for (const script of ['lint', 'typecheck', 'test', 'build:web']) {
    const [command, values] = packageCommand(script); await stage(script.replace(':', '-'), command, values);
  }
  for (const [name, script] of [['backend', 'backend-run'], ['api', 'backend-api'], ['web', 'web-run']])
    await stage(name, process.execPath, [`scripts/qa/${script}.mjs`, `--run-id=${id}-${name}`, `--output=${output}/${name}`]);
  if (scope === 'web') report.stages.push({ name: 'android', status: 'UNVERIFIED', reason: 'Explicit --scope=web' });
  else if (!process.env.JAVA_HOME || !process.env.ANDROID_HOME || !existsSync(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')))
    report.stages.push({ name: 'android', status: 'UNVERIFIED', reason: 'Set JAVA_HOME (JDK 25) and ANDROID_HOME (SDK 37.2)' });
  else if (process.platform === 'win32') await stage('android', process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c',
    'gradlew.bat :app:testDebugUnitTest :app:assembleDebug -PgenesisUrl=https://localhost.invalid/ -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4096m -Dfile.encoding=COMPAT" --max-workers=2 --no-daemon --console=plain'], path.join(root, 'android'));
  else await stage('android', 'bash', ['./gradlew', ':app:testDebugUnitTest', ':app:assembleDebug', '-PgenesisUrl=https://localhost.invalid/',
    '-Pkotlin.compiler.execution.strategy=in-process', '--max-workers=2', '--no-daemon', '--console=plain'], path.join(root, 'android'));
} catch (error) { report.error = error.message; }
report.finishedAt = new Date().toISOString();
report.status = report.error || report.stages.some(row => row.status === 'FAIL') ? 'FAIL'
  : scope === 'all' && report.stages.some(row => row.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
save(); console.log(`${report.status}: ${path.relative(root, output)}/results.json (scope=${scope}; external services remain UNVERIFIED)`);
process.exitCode = report.status === 'PASS' ? 0 : 1;
