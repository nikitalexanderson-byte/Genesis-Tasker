import { readFileSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Delete only a marked synthetic runtime strictly inside this run's output directory. */
export function cleanupBackendRuntime(directory, output) {
  const target = resolve(directory), boundary = resolve(output);
  const child = relative(boundary, target);
  if (!child || isAbsolute(child) || child.startsWith('..') || resolve(boundary, child) !== target) throw new Error('Cleanup target escaped its run directory');
  const owner = JSON.parse(readFileSync(resolve(target, 'owner.json'), 'utf8'));
  if (owner.synthetic !== true || owner.directory !== target.replaceAll('\\', '/')) throw new Error('Unowned runtime cleanup refused');
  rmSync(target, { recursive:true, force:false, maxRetries:3, retryDelay:100 });
  return { status:'PASS', removed:target.replaceAll('\\', '/'), ownershipChecked:true };
}
