import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const plans = ['free', 'standart', 'premium', 'business', 'premium4life'];
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const slash = value => value.replaceAll('\\', '/');
export const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function versionInfo(root) {
  const gradle = readFileSync(path.join(root, 'android/app/build.gradle.kts'), 'utf8');
  const versionName = gradle.match(/^\s*versionName\s*=\s*"([^"]+)"/m)?.[1];
  const versionCode = Number(gradle.match(/^\s*versionCode\s*=\s*(\d+)/m)?.[1]);
  if (!versionName || !versionCode) throw new Error('Cannot identify Android version from the current Gradle configuration');
  return { appVersion: `${versionName}/${versionCode}`, android: { versionName, versionCode }, webPackage: readJson(path.join(root, 'package.json')).version };
}
export function contained(root, file) {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path escapes the QA workspace');
  return resolved;
}
export function sourceSnapshot(root) {
  // Hash source bytes only. Never open secrets, local databases, generated build trees or user backups.
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'app', 'server', 'android', 'tests', 'scripts', 'public', '.github/workflows', 'package.json', 'pnpm-lock.yaml', '*.config.*', 'docs/qa/3.1.7-2026-11-03/catalog-contracts.json'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const files = [...new Set(names)].filter(name => !/(^|\/)(?:\.env[^/]*|config\.php|server\/var|deploy-private|backups|sshp\.txt)(?:\/|$)/.test(name) && !/(?:^|\/)(?:build|\.gradle|var|node_modules)(?:\/|$)/.test(name)).sort().map(name => {
    const file = contained(root, name);
    return { path: slash(name), sha256: existsSync(file) && statSync(file).isFile() ? hash(readFileSync(file)) : 'MISSING' };
  });
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sha256: hash(JSON.stringify(files)), files };
}
export function filesBelow(directory, accept = () => true) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file, accept) : accept(file) ? [file] : [];
  });
}
export function evidence(root, value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(file => {
    const absolute = contained(root, file);
    return { path: slash(path.relative(root, absolute)), exists: existsSync(absolute) && statSync(absolute).isFile(), ...(existsSync(absolute) && statSync(absolute).isFile() ? { sha256: hash(readFileSync(absolute)) } : {}) };
  });
}
export function sourceTestCases(root, file) {
  const text = readFileSync(contained(root, file), 'utf8');
  const packageName = text.match(/^package\s+(\S+)/m)?.[1];
  const className = text.match(/^(?:internal\s+)?class\s+(\w+)/m)?.[1];
  const methods = [...text.matchAll(/@Test\b(?:\([^)]*\))?\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:(?:public|internal|override|suspend)\s+)*fun\s+(\w+)\s*\(/g)].map(match => match[1]);
  return { className: packageName && className ? `${packageName}.${className}` : null, methods };
}
