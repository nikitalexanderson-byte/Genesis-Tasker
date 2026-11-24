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
import { runMembershipRoot } from './web-membership-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map(argument => { const [key, ...parts] = argument.replace(/^--/, '').split('='); return [key, parts.join('=')]; }));
const suite = args.suite ?? 'full';
if (!['full', 'followup317', 'trial317', 'history317', 'retention', 'header', 'dialog-focus', 'mindmap-save', 'shared-inbox', 'public-region', 'private-product','membership-root'].includes(suite)) throw new Error('Unknown web QA suite');
if(args['preserve-failure']&&suite!=='private-product')throw new Error('Synthetic failure retention is confined to the private-product fixture');
const id = args['run-id'] ?? `web-${Date.now()}-${randomBytes(3).toString('hex')}`;
if (!/^[a-zA-Z0-9-]{6,80}$/.test(id)) throw new Error('Invalid run ID');
const output = path.resolve(root, args.output ?? `output/playwright/full-qa/${id}`);
if (existsSync(output)) throw new Error('Fresh run output required');
mkdirSync(output, { recursive: true });
const runtime = path.join(output, 'runtime');
const php = await resolveBackendPhp(args.php);
const bundleDirectory = path.resolve(root, args.bundle ?? 'dist-web/public_html');
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
function assertRetainedOwnership(owner,client,clientState){
  if(owner.synthetic!==true||owner.directory!==runtime.replaceAll('\\','/')||owner.origin!==origin||owner.configSha256!==hash(readFileSync(path.join(runtime,'config.php')))
    ||client.synthetic!==true||client.directory!==clientState.replaceAll('\\','/')||client.origin!==origin)throw new Error('Synthetic retention ownership check failed');
}
const prepared = spawnSync(php, ['-d', 'disable_functions=curl_exec,mail', 'scripts/qa/backend-fixture.php', `--dir=${runtime}`, `--origin=${origin}`, `--run-id=${id}`, ...(suite === 'private-product' ? ['--e2ee'] : [])], { cwd: root, encoding: 'utf8', windowsHide: true });
if (prepared.status !== 0) throw new Error('Synthetic fixture preparation failed: ' + (prepared.stderr || prepared.error?.message));
const apiLog = createWriteStream(path.join(output, 'local-api.log'));
const api = spawn(php, ['-d', 'disable_functions=curl_exec,mail', '-S', `127.0.0.1:${apiPort}`, 'scripts/qa/backend-router.php'], { cwd: root, windowsHide: true, env: { ...process.env, GENESIS_FULL_QA: 'isolated', GENESIS_FULL_QA_DIR: runtime.replaceAll('\\', '/') }, stdio: ['ignore', 'pipe', 'pipe'] });
const apiClosed = new Promise(resolve => api.once('close', resolve));
api.stdout.pipe(apiLog); api.stderr.pipe(apiLog);
let server, runError, startupGate, membershipRootGate, featureExitCode;
try {
  await waitForQaBackend(api, `http://127.0.0.1:${apiPort}`, id);
  server = await startWebServer({ port, apiPort, directory: bundleDirectory });
  if(args['startup-report']) {
    const prior=JSON.parse(readFileSync(path.resolve(root,args['startup-report']),'utf8'));
    const proof=prior.startupGate?.report?readFileSync(path.resolve(root,prior.startupGate.report)):null;
    const sources=proof?JSON.parse(proof.toString('utf8')).sources:null;
    if(suite!=='private-product'||prior.build?.sha256!==build.sha256||prior.startupGate?.status!=='PASS'||!Array.isArray(sources)
      ||!proof||hash(proof)!==prior.startupGate.sha256
      ||sources.some(source=>hash(readFileSync(path.resolve(root,source.path)))!==source.sha256))throw new Error('Startup reuse requires the exact checked build and unchanged startup sources');
    startupGate={...prior.startupGate,reusedFrom:args['startup-report']};
  }else startupGate = await runSharedStartup({ baseURL: origin, output });
  if(['full','private-product','membership-root'].includes(suite))membershipRootGate=await runMembershipRoot({baseURL:origin,output,bundleDirectory});
  const exitCode = suite==='membership-root'?0:await new Promise((resolve, reject) => {
    const script = {full: 'scripts/qa/web-full.mjs', followup317: 'scripts/qa/web-followup317.mjs', trial317: 'scripts/qa/web-trial-only317.mjs', history317: 'scripts/qa/web-hidden-map-history317.mjs', retention: 'scripts/qa/web-retention.mjs', header: 'scripts/qa/web-header-startup.mjs', 'dialog-focus': 'scripts/qa/web-dialog-focus.mjs', 'mindmap-save': 'scripts/qa/web-mindmap-save.mjs', 'shared-inbox':'scripts/qa/web-shared-inbox.mjs', 'public-region':'scripts/qa/web-public-region.mjs', 'private-product':'scripts/qa/web-private-product.mjs'}[suite];
    const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, env: { ...process.env, GENESIS_QA_WEB_ORIGIN: origin, GENESIS_QA_WEB_OUTPUT: output, GENESIS_QA_BACKEND_RUNTIME: runtime, GENESIS_QA_PHP: php, GENESIS_QA_PHASE: 'isolated', ...(args['preserve-failure']==='true'?{GENESIS_QA_PRESERVE_SYNTHETIC:'true'}:{}), ...(args.focus ? { GENESIS_QA_FOLLOWUP_SCOPE: args.focus } : {}), ...(args.tiers ? { GENESIS_QA_TIERS: args.tiers } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  let cleanup;
  const clientState=path.join(output,'client-state');
  if(args['preserve-failure']==='true'&&featureExitCode!==0&&existsSync(path.join(clientState,'recovery.private.json'))){
    try{
      const owner=JSON.parse(readFileSync(path.join(runtime,'owner.json'),'utf8'));
      const client=JSON.parse(readFileSync(path.join(clientState,'owner.json'),'utf8'));
      assertRetainedOwnership(owner,client,clientState);
      cleanup={status:'PRESERVED_SYNTHETIC',runtime,clientState,origin,port,apiPort,ownershipChecked:true,servicesStopped:true,mustCleanBeforeRelease:true};
      writeFileSync(path.join(output,'preserved-runtime.json'),JSON.stringify(cleanup,null,2));
    }catch{
      cleanup={status:'RETENTION_BOUNDARY_CHECK_FAILED',runtime,clientState,ownershipChecked:false,servicesStopped:true};
      runError=[runError,'Synthetic retention ownership check failed; files were left untouched'].filter(Boolean).join('; ');process.exitCode=1;
    }
  }else{
    cleanup=cleanupBackendRuntime(runtime,output);
    if(existsSync(clientState))cleanupBackendRuntime(clientState,output);
  }
  const buildAfter = bundleIdentity();
  if (buildAfter.sha256 !== build.sha256) { runError = 'Compiled web bundle changed during the test run'; process.exitCode = 1; }
  writeFileSync(path.join(output, 'run.json'), JSON.stringify({ runId: id, origin, featureExitCode: featureExitCode ?? null, build, buildAfterSha256: buildAfter.sha256, startupGate: startupGate ?? null,membershipRootGate:membershipRootGate??null, externalNetwork: 'browser allows only local origin; PHP curl/mail disabled; no provider credentials', cleanup, error: runError ?? null }, null, 2));
  if (runError) console.error(runError);
}
