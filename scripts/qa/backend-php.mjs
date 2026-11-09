import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const version = '8.4.27';
const archiveUrl = `https://windows.php.net/downloads/releases/php-${version}-1-nts-Win32-vs17-x64.zip`;
const archiveSha256 = 'dbae154a0a89791f36c3d48e68bae797878333e7d6cb5721e74617de59b63ab7';
const defaultDirectory = join(tmpdir(), `genesis-full-qa-php-${version}`);
const requiredExtensions = ['pdo_sqlite', 'sqlite3', 'sodium', 'mbstring', 'openssl', 'curl', 'fileinfo'];

/** System PHP keeps its own OpenSSL defaults; Windows archives may need their bundled config. */
export function backendPhpEnvironment(binary, environment = process.env, platform = process.platform) {
  if (environment.OPENSSL_CONF !== undefined) return { OPENSSL_CONF: environment.OPENSSL_CONF };
  if (platform === 'win32') {
    const bundled = join(dirname(binary), 'extras', 'ssl', 'openssl.cnf');
    if (existsSync(bundled)) return { OPENSSL_CONF: bundled };
  }
  return {};
}

function execute(binary, args) {
  return new Promise((done) => {
    const child = spawn(binary, args, { windowsHide:true, stdio:['ignore','pipe','pipe'] });
    let stdout='', stderr='';
    child.stdout.on('data', data=>{stdout+=data;}); child.stderr.on('data', data=>{stderr+=data;});
    child.once('error', error=>done({code:-1,stdout,stderr:error.message}));
    child.once('close', code=>done({code,stdout,stderr}));
  });
}

async function validate(binary) {
  const result = await execute(binary, ['-r', 'echo json_encode(["version"=>PHP_VERSION,"extensions"=>get_loaded_extensions()]);']);
  if(result.code!==0) throw new Error(`QA PHP unavailable: ${result.stderr || binary}. Set GENESIS_QA_PHP to a compatible CLI runtime.`);
  let details;
  try { details=JSON.parse(result.stdout); } catch { throw new Error(`QA PHP startup returned unexpected output: ${binary}`); }
  const missing=requiredExtensions.filter(extension=>!details.extensions.map(value=>value.toLowerCase()).includes(extension));
  if(missing.length) throw new Error(`QA PHP is missing extensions: ${missing.join(', ')}.`);
  return binary;
}

/** Install only a pinned, checksum-verified official Windows runtime in a fresh temp directory. */
export async function resolveBackendPhp(explicit) {
  const configured=explicit || process.env.GENESIS_QA_PHP;
  if(configured) return validate(configured);
  if(process.platform!=='win32') return validate('php');
  const executable=join(defaultDirectory,'php.exe');
  if(existsSync(executable)) return validate(executable);
  // A partially created directory may belong to another run; never replace or delete it.
  if(existsSync(defaultDirectory)) throw new Error(`QA PHP directory is incomplete; use --php=<runtime>: ${defaultDirectory}`);
  const staging=`${defaultDirectory}-download-${process.pid}`;
  const cleanupTarget=resolve(staging), boundary=resolve(tmpdir());
  if(resolve(boundary,`genesis-full-qa-php-${version}-download-${process.pid}`)!==cleanupTarget) throw new Error('Unsafe PHP download cleanup path');
  mkdirSync(staging);
  const archive=join(staging,'php.zip');
  const extracted=join(staging,'runtime');
  try {
    const response=await fetch(archiveUrl,{signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`Official PHP download returned HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==archiveSha256) throw new Error('Official PHP archive checksum mismatch');
    writeFileSync(archive,bytes);
    // The temporary paths are passed as literal arguments, never composed into shell code.
    const unpackScript=join(staging,'unpack.ps1');
    writeFileSync(unpackScript,'param([string]$Archive,[string]$Destination)\n$ErrorActionPreference="Stop"\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n');
    const unpack=await execute('powershell.exe',['-NoProfile','-NonInteractive','-File',unpackScript,'-Archive',archive,'-Destination',extracted]);
    if(unpack.code!==0) throw new Error(`QA PHP extraction failed: ${unpack.stderr}`);
    const extensionDirectory=join(defaultDirectory,'ext').replaceAll('\\','/');
    writeFileSync(join(extracted,'php.ini'),`extension_dir="${extensionDirectory}"\n${requiredExtensions.map(extension=>`extension=${extension}`).join('\n')}\nallow_url_fopen=1\ndisplay_errors=1\ndisplay_startup_errors=1\nerror_reporting=E_ALL\ndate.timezone=UTC\n`);
    writeFileSync(join(extracted,'qa-runtime.json'),JSON.stringify({version,archiveUrl,archiveSha256,syntheticRuntime:true},null,2));
    // A concurrent installer may have completed while this archive was downloaded.
    if(!existsSync(defaultDirectory)) renameSync(extracted,defaultDirectory);
    return await validate(executable);
  } finally {
    // staging was created exclusively by this invocation; no existing tree is removed.
    rmSync(cleanupTarget,{recursive:true,force:false,maxRetries:3,retryDelay:100});
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({php:await resolveBackendPhp(process.argv.find(value=>value.startsWith('--php='))?.slice(6))}));
}
