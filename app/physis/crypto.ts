export type PhysisEnvelope = { version: 1; schemaVersion: 1; keyVersion: number; iv: string; ciphertext: string };
export type WrappedKey = { iv: string; ciphertext: string };
export type LegacyPhysisVault = {
  version: 1; keyVersion: number;
  password: WrappedKey & { salt: string; iterations: 600000 };
  recovery: WrappedKey;
};
export type AccountPhysisVault = { version: 2; keyVersion: number; account: WrappedKey };
export type PhysisVault = LegacyPhysisVault | AccountPhysisVault;
export type AccountKeyAccess = {
  seal(value: unknown, scope: string): Promise<WrappedKey>;
  open<T>(envelope: WrappedKey, scope: string): Promise<T>;
};
const KDF_ITERATIONS = 600000;
export const MAX_PHYSIS_PLAINTEXT_BYTES = 256 * 1024 - 16;
const encode = (text: string) => new TextEncoder().encode(text);
export function toBase64(value: Uint8Array): string {
  let text = ''; for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text);
}
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 2_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('PHYSIS_INVALID_ENVELOPE');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export function physisAad(owner: string, id: string, schemaVersion: number, keyVersion: number) {
  return encode(`genesis:physis:v1:${owner}:${id}:${schemaVersion}:${keyVersion}`);
}
async function keyFromRaw(raw: Uint8Array<ArrayBuffer>, usages: KeyUsage[] = ['encrypt', 'decrypt']) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, usages);
}
async function passwordKey(password: string, salt: string) {
  const raw = encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: fromBase64(salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { raw.fill(0); }
}
async function wrap(raw: Uint8Array<ArrayBuffer>, key: CryptoKey, owner: string, purpose: string, keyVersion: number): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: physisAad(owner, `vault:${purpose}`, 1, keyVersion) }, key, raw);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
}
function validateWrap(value: WrappedKey) {
  if (!value || fromBase64(value.iv).length !== 12 || fromBase64(value.ciphertext).length !== 48) throw new Error('PHYSIS_INVALID_VAULT');
}
export function validateVault(vault: PhysisVault) {
  if (!vault || !Number.isSafeInteger(vault.keyVersion) || vault.keyVersion < 1) throw new Error('PHYSIS_INVALID_VAULT');
  if (vault.version === 2) {
    if (!vault.account || fromBase64(vault.account.iv).length !== 12 || fromBase64(vault.account.ciphertext).length !== 62) throw new Error('PHYSIS_INVALID_VAULT');
    return;
  }
  if (vault.version !== 1 || vault.password?.iterations !== KDF_ITERATIONS || fromBase64(vault.password.salt).length !== 16) throw new Error('PHYSIS_INVALID_VAULT');
  validateWrap(vault.password); validateWrap(vault.recovery);
}
export async function createPhysisVault(owner: string, password: string, keyVersion = 1) {
  if (password.length < 12 || password.length > 1024) throw new Error('Используйте пароль от 12 до 1024 символов.');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const recoveryRaw = crypto.getRandomValues(new Uint8Array(32));
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  try {
    const key = await keyFromRaw(raw);
    const vault: LegacyPhysisVault = { version: 1, keyVersion,
      password: { ...await wrap(raw, await passwordKey(password, salt), owner, 'password', keyVersion), salt, iterations: KDF_ITERATIONS },
      recovery: await wrap(raw, await keyFromRaw(recoveryRaw), owner, 'recovery', keyVersion) };
    const recovery = 'PHY1-' + toBase64(recoveryRaw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { key, vault, recovery };
  } finally { raw.fill(0); recoveryRaw.fill(0); }
}
export async function unlockPhysisVault(owner: string, vault: PhysisVault, secret: string, method: 'password' | 'recovery') {
  validateVault(vault);
  if (vault.version !== 1) throw new Error('Эта копия открывается через аккаунт GENESIS.');
  let raw: Uint8Array<ArrayBuffer> | undefined;
  let recoveryRaw: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (method === 'recovery') {
      if (!/^PHY1-[A-Za-z0-9_-]{43}$/.test(secret.trim())) throw new Error('PHYSIS_RECOVERY_INVALID');
      recoveryRaw = fromBase64(secret.trim().slice(5).replace(/-/g, '+').replace(/_/g, '/') + '=');
    }
    const wrappingKey = method === 'password' ? await passwordKey(secret, vault.password.salt) : await keyFromRaw(recoveryRaw!);
    const wrapped = vault[method];
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(wrapped.iv),
      additionalData: physisAad(owner, `vault:${method}`, 1, vault.keyVersion) }, wrappingKey, fromBase64(wrapped.ciphertext)));
    return await keyFromRaw(raw);
  } catch { throw new Error('Не удалось разблокировать Фюзис. Проверьте пароль или код восстановления. Данные не изменены.'); }
  finally { raw?.fill(0); recoveryRaw?.fill(0); }
}
export async function changePhysisPassword(owner: string, vault: LegacyPhysisVault, key: CryptoKey, password: string): Promise<LegacyPhysisVault> {
  if (password.length < 12 || password.length > 1024) throw new Error('Используйте пароль от 12 до 1024 символов.');
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  try { return { ...vault, password: { ...await wrap(raw, await passwordKey(password, salt), owner, 'password', vault.keyVersion), salt, iterations: KDF_ITERATIONS } }; }
  finally { raw.fill(0); }
}
/** Wrap the existing record key with the same account key as the rest of GENESIS. */
export async function accountPhysisVault(access: AccountKeyAccess, keyVersion = 1, existingKey?: CryptoKey) {
  const raw = existingKey ? new Uint8Array(await crypto.subtle.exportKey('raw', existingKey)) : crypto.getRandomValues(new Uint8Array(32));
  try {
    const key = existingKey ?? await keyFromRaw(raw);
    const vault: AccountPhysisVault = { version: 2, keyVersion, account: await access.seal(toBase64(raw), `physis-vault:v2:${keyVersion}`) };
    validateVault(vault);
    return { key, vault };
  } finally { raw.fill(0); }
}
export async function openAccountPhysisVault(access: AccountKeyAccess, vault: AccountPhysisVault) {
  validateVault(vault);
  const raw = fromBase64(await access.open<string>(vault.account, `physis-vault:v2:${vault.keyVersion}`));
  try {
    if (raw.length !== 32) throw new Error('PHYSIS_INVALID_VAULT');
    return await keyFromRaw(raw);
  } finally { raw.fill(0); }
}
export async function sealPhysis(key: CryptoKey, owner: string, id: string, keyVersion: number, value: unknown): Promise<PhysisEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encode(JSON.stringify(value));
  try {
    if (plain.length > MAX_PHYSIS_PLAINTEXT_BYTES) throw new Error('Запись слишком велика. Разделите данные на несколько записей.');
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: physisAad(owner, id, 1, keyVersion) }, key, plain);
    return { version: 1, schemaVersion: 1, keyVersion, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
  } finally { plain.fill(0); }
}
export async function openPhysis(key: CryptoKey, owner: string, id: string, keyVersion: number, envelope: PhysisEnvelope): Promise<unknown> {
  if (!envelope || envelope.version !== 1 || envelope.schemaVersion !== 1 || envelope.keyVersion !== keyVersion || fromBase64(envelope.iv).length !== 12) throw new Error('PHYSIS_INVALID_ENVELOPE');
  let plain: Uint8Array | undefined;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv),
      additionalData: physisAad(owner, id, 1, keyVersion) }, key, fromBase64(envelope.ciphertext)));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch { throw new Error('Запись не расшифрована: неверный ключ или поврежденные данные. Шифротекст сохранён.'); }
  finally { plain?.fill(0); }
}
