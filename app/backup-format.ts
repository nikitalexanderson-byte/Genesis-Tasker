/** Portable user-owned data, never an authentication or subscription credential. */
export const BACKUP_SCHEMA = 1;
export const BACKUP_MAX_PLAIN = 16 * 1024 * 1024;
export const BACKUP_MAX_FILE = 24 * 1024 * 1024;
export const BACKUP_MODULES = ['workspace', 'mindmaps', 'diary', 'stoicheion', 'aurora', 'physis', 'shared-drafts'] as const;
export type BackupModuleId = typeof BACKUP_MODULES[number];
export type BackupSection = { id: BackupModuleId; source: 'device' | 'server'; completeness: 'available' | 'partial' | 'unavailable'; capturedAt: string; revision: number | null; count: number; pending: number; notices: string[]; data: unknown };
export type BackupPayload = { schema: 1; backupId: string; source: 'device_snapshot' | 'server_snapshot'; ownerId: string; createdAt: string; client: 'web' | 'android'; sections: BackupSection[]; billingEvidence: null; serverEvidence?: unknown };
export type BackupFile = { format: 'genesisbackup'; schema: 1; backupId: string; algorithm: 'A256GCM+A256KW'; wrappedKey: string; iv: string; ciphertext: string; sha256: string };
const encoder = new TextEncoder();
const fail = (code = 'BACKUP_INVALID'): never => { throw new Error(code); };
export function backupBase64(bytes: Uint8Array): string {
  let result = ''; for (let offset = 0; offset < bytes.length; offset += 0x4000) result += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  return btoa(result);
}
export function backupBytes(value: unknown, max = BACKUP_MAX_FILE): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0) return fail();
  // A repeated four-character regexp group exhausts V8's regexp stack on a
  // supported multi-MiB archive. Scan once and check unused padding bits;
  // canonical validation needs neither backtracking nor a full re-encoding.
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,end=value.length-padding;
  const digit=(code:number)=>code>=65&&code<=90?code-65:code>=97&&code<=122?code-71:code>=48&&code<=57?code+4:code===43?62:code===47?63:-1;
  for(let index=0;index<end;index++)if(digit(value.charCodeAt(index))<0)return fail();
  if(padding&&((end<2)||(digit(value.charCodeAt(end-1))&(padding===2?15:3))!==0))return fail();
  const length=value.length/4*3-padding;if(length>max)return fail();
  const binary=atob(value),bytes=new Uint8Array(length);
  // Avoid the iterable conversion's multi-million-element intermediate array.
  for(let index=0;index<length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}
export async function backupDigest(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
/** Bound nesting and total nodes before recursive application code sees untrusted JSON. */
export function backupJson(text: string, maxBytes = BACKUP_MAX_PLAIN): unknown {
  if (encoder.encode(text).length > maxBytes) return fail('BACKUP_TOO_LARGE');
  // JSON.parse itself is non-recursive in the supported engines; validation below is iterative.
  const root: unknown = JSON.parse(text); const stack = [{ value: root, depth: 0 }]; let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 200_000 || depth > 40) return fail('BACKUP_LIMIT');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return fail();
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return root;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function validateBackupPayload(value: unknown): BackupPayload {
  const root = object(value);
  if (root.schema !== 1) return fail('BACKUP_VERSION');
  if (Object.keys(root).some(key => !['schema', 'backupId', 'source', 'ownerId', 'createdAt', 'client', 'sections', 'billingEvidence', 'serverEvidence'].includes(key))
    || !uuid(root.backupId) || !['device_snapshot', 'server_snapshot'].includes(String(root.source)) || !['web', 'android'].includes(String(root.client))
    || typeof root.ownerId !== 'string' || !/^[\w-]{1,100}$/.test(root.ownerId) || typeof root.createdAt !== 'string' || !Number.isFinite(Date.parse(root.createdAt))
    || root.billingEvidence !== null || !Array.isArray(root.sections) || root.sections.length > BACKUP_MODULES.length) return fail();
  const seen = new Set<string>();
  for (const item of root.sections) {
    const section = object(item);
    if (!BACKUP_MODULES.includes(section.id as BackupModuleId) || seen.has(String(section.id)) || !['device', 'server'].includes(String(section.source))
      || !['available', 'partial', 'unavailable'].includes(String(section.completeness)) || typeof section.capturedAt !== 'string' || !Number.isFinite(Date.parse(section.capturedAt))
      || !(section.revision === null || Number.isSafeInteger(section.revision) && Number(section.revision) >= 0)
      || !Number.isSafeInteger(section.count) || Number(section.count) < 0 || Number(section.count) > 50_000 || !Number.isSafeInteger(section.pending) || Number(section.pending) < 0
      || !Array.isArray(section.notices) || section.notices.length > 100 || section.notices.some(n => typeof n !== 'string' || n.length > 2000)) return fail();
    seen.add(String(section.id));
  }
  return root as BackupPayload;
}
export function newBackupRecoveryKey(): string { return backupBase64(crypto.getRandomValues(new Uint8Array(32))); }
function aad(file: Pick<BackupFile, 'format' | 'schema' | 'backupId' | 'algorithm' | 'wrappedKey'>, legacyAndroid = false) {
  const json = JSON.stringify([file.format, file.schema, file.backupId, file.algorithm, file.wrappedKey]);
  // Historical Android JSONArray escaped solidus in standard Base64. New
  // writers use canonical JSON; this exact authenticated v1 encoding stays
  // readable locally. No header, suite, key or plaintext fallback is permitted.
  return encoder.encode(legacyAndroid ? json.replaceAll('/', '\\/') : json);
}
async function recoveryKey(secret: string) {
  const bytes = backupBytes(secret.trim(), 32); if (bytes.length !== 32) return fail('BACKUP_RECOVERY_KEY');
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-KW', false, ['wrapKey', 'unwrapKey']);
}
export async function sealBackup(payload: BackupPayload, secret: string): Promise<string> {
  validateBackupPayload(backupJson(JSON.stringify(payload)));
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrappedKey = backupBase64(new Uint8Array(await crypto.subtle.wrapKey('raw', key, await recoveryKey(secret), 'AES-KW')));
  const header = { format: 'genesisbackup' as const, schema: 1 as const, backupId: payload.backupId, algorithm: 'A256GCM+A256KW' as const, wrappedKey };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header), tagLength: 128 }, key, encoder.encode(JSON.stringify(payload))));
  const file: BackupFile = { ...header, iv: backupBase64(iv), ciphertext: backupBase64(ciphertext), sha256: await backupDigest(ciphertext) };
  const text = JSON.stringify(file); if (encoder.encode(text).length > BACKUP_MAX_FILE) return fail('BACKUP_TOO_LARGE'); return text;
}
/** Decryption is entirely on the user's device. No server decryption oracle. */
export async function openBackup(text: string, secret: string): Promise<BackupPayload> {
  const file = object(backupJson(text, BACKUP_MAX_FILE));
  if (file.schema !== 1) return fail('BACKUP_VERSION');
  if (file.format !== 'genesisbackup' || file.algorithm !== 'A256GCM+A256KW' || !uuid(file.backupId)
    || Object.keys(file).sort().join(',') !== 'algorithm,backupId,ciphertext,format,iv,schema,sha256,wrappedKey') return fail();
  const ciphertext = backupBytes(file.ciphertext, BACKUP_MAX_PLAIN + 16), iv = backupBytes(file.iv, 12), wrapped = backupBytes(file.wrappedKey, 40);
  if (iv.length !== 12 || wrapped.length !== 40 || ciphertext.length < 16 || await backupDigest(ciphertext) !== file.sha256) return fail('BACKUP_INTEGRITY');
  let plain: ArrayBuffer;
  try {
    const key = await crypto.subtle.unwrapKey('raw', new Uint8Array(wrapped), await recoveryKey(secret), 'AES-KW', { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: aad(file as BackupFile), tagLength: 128 }, key, new Uint8Array(ciphertext));
    } catch (error) {
      if (!String(file.wrappedKey).includes('/') || !(error instanceof DOMException) || error.name !== 'OperationError') throw error;
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: aad(file as BackupFile, true), tagLength: 128 }, key, new Uint8Array(ciphertext));
    }
  } catch { return fail('BACKUP_RECOVERY_OR_INTEGRITY'); }
  const payload = validateBackupPayload(backupJson(new TextDecoder('utf-8', { fatal: true }).decode(plain)));
  if (payload.backupId !== file.backupId) return fail('BACKUP_INTEGRITY'); return payload;
}
