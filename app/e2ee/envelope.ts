/**
 * Inactive 3.3.6 wire contract. Key storage, device trust and migration are separate.
 * No legacy sync entrypoint imports this module. See docs/e2ee-336-contract-adr.md.
 */
export const E2EE_SUITE = 'A256KW-A256GCM-ES256' as const;
export const E2EE_MAX_PLAINTEXT = 4 * 1024 * 1024;
export const E2EE_DOMAINS = [
  'workspace', 'diary', 'dream-journal', 'mindmap', 'physis', 'aurora',
  'stoicheion', 'shared-project', 'shared-comment', 'attachment', 'local-snapshot', 'outbox', 'draft', 'key-check',
] as const;

export type E2eeContext = {
  cryptoProtocol: 1;
  suite: typeof E2EE_SUITE;
  ownerId: string;
  scopeId: string;
  domain: typeof E2EE_DOMAINS[number];
  objectId: string;
  schemaVersion: number;
  dataGeneration: number;
  writerProtocol: 9;
  cryptoEpoch: number;
  securityEpoch: number;
  revision: number;
  keyId: string;
  deviceId: string;
  operationId: string;
};
export type E2eeEnvelope = {
  context: E2eeContext;
  wrappedKey: string;
  nonce: string;
  ciphertext: string;
  signature: string;
};

const fields = [
  'cryptoProtocol', 'suite', 'ownerId', 'scopeId', 'domain', 'objectId', 'schemaVersion',
  'dataGeneration', 'writerProtocol', 'cryptoEpoch', 'securityEpoch', 'revision',
  'keyId', 'deviceId', 'operationId',
] as const;
const numberFields = new Set<string>([
  'cryptoProtocol', 'schemaVersion', 'dataGeneration', 'writerProtocol', 'cryptoEpoch', 'securityEpoch', 'revision',
]);
const encoder = new TextEncoder();
const aadPrefix = encoder.encode('GENESIS-E2EE-AAD\0v1\0');
const signaturePrefix = encoder.encode('GENESIS-E2EE-SIGNATURE\0v1\0');
function invalid(): never { throw new Error('E2EE_INVALID_ENVELOPE'); }
function corrupt(): never { throw new Error('E2EE_CORRUPT_ENVELOPE'); }

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object') invalid();
  try {
    if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      // Snapshot data descriptors once; an accessor must not swap a validated field later.
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
      captured[key] = property.value;
    }
    return captured;
  } catch { return invalid(); }
}

export function validateE2eeContext(value: unknown): E2eeContext {
  const source = exactObject(value, fields);
  const context: Record<string, string | number> = {};
  for (const name of fields) {
    const item = source[name];
    if (numberFields.has(name)) {
      if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1) invalid();
    } else if (typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(item)) invalid();
    context[name] = item as string | number;
  }
  if (context.cryptoProtocol !== 1 || context.suite !== E2EE_SUITE || context.writerProtocol !== 9
      || !(E2EE_DOMAINS as readonly string[]).includes(context.domain as string)) invalid();
  return Object.freeze(context) as E2eeContext;
}

export function encodeE2eeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeE2eeBytes(value: unknown, min: number, max = min): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length < Math.ceil(min * 4 / 3)
      || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)); }
  catch { return invalid(); }
  if (bytes.length < min || bytes.length > max || encodeE2eeBytes(bytes) !== value) invalid();
  return bytes;
}

export function validateE2eeEnvelope(value: unknown): E2eeEnvelope {
  const source = exactObject(value, ['context', 'wrappedKey', 'nonce', 'ciphertext', 'signature']);
  const context = validateE2eeContext(source.context);
  decodeE2eeBytes(source.wrappedKey, 40);
  decodeE2eeBytes(source.nonce, 12);
  decodeE2eeBytes(source.ciphertext, 16, E2EE_MAX_PLAINTEXT + 16);
  decodeE2eeBytes(source.signature, 64);
  return Object.freeze({ context, wrappedKey: source.wrappedKey as string, nonce: source.nonce as string,
    ciphertext: source.ciphertext as string, signature: source.signature as string });
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function e2eeAdditionalData(source: E2eeContext): Uint8Array<ArrayBuffer> {
  const context = validateE2eeContext(source);
  return concat(aadPrefix, ...fields.map(name => {
    const value = context[name];
    if (typeof value === 'number') {
      const result = new Uint8Array(8), view = new DataView(result.buffer);
      view.setUint32(0, Math.floor(value / 0x100000000));
      view.setUint32(4, value % 0x100000000);
      return result;
    }
    const bytes = encoder.encode(value), length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length);
    return concat(length, bytes);
  }));
}

async function signatureData(envelope: Pick<E2eeEnvelope, 'context' | 'wrappedKey' | 'nonce' | 'ciphertext'>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',
    decodeE2eeBytes(envelope.ciphertext, 16, E2EE_MAX_PLAINTEXT + 16)));
  return concat(signaturePrefix, e2eeAdditionalData(envelope.context),
    decodeE2eeBytes(envelope.wrappedKey, 40), decodeE2eeBytes(envelope.nonce, 12), hash);
}

function assertKey(key: CryptoKey, algorithm: 'AES-KW' | 'ECDSA', usage: KeyUsage) {
  if (!key || key.algorithm.name !== algorithm || !key.usages.includes(usage)
      || (algorithm === 'AES-KW' && (key.algorithm as AesKeyAlgorithm).length !== 256)
      || (algorithm === 'ECDSA' && (key.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256')) invalid();
}

/** Import only memory-held key material; this function does not read or persist a key. */
export async function importE2eeRoot(source: Uint8Array): Promise<CryptoKey> {
  if (!(source instanceof Uint8Array) || source.length !== 32) invalid();
  const copy = new Uint8Array(source);
  try { return await crypto.subtle.importKey('raw', copy, 'AES-KW', false, ['wrapKey', 'unwrapKey']); }
  finally { copy.fill(0); }
}

/** Always a fresh DEK/nonce. Retry the returned immutable envelope, not a new seal. */
export async function sealE2eeEnvelope(root: CryptoKey, deviceSigningKey: CryptoKey,
  sourceContext: E2eeContext, sourcePlaintext: Uint8Array): Promise<E2eeEnvelope> {
  assertKey(root, 'AES-KW', 'wrapKey'); assertKey(deviceSigningKey, 'ECDSA', 'sign');
  const context = validateE2eeContext(sourceContext);
  if (!(sourcePlaintext instanceof Uint8Array) || sourcePlaintext.length > E2EE_MAX_PLAINTEXT) invalid();
  const plaintext = new Uint8Array(sourcePlaintext);
  try {
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = encodeE2eeBytes(new Uint8Array(await crypto.subtle.wrapKey('raw', dek, root, 'AES-KW')));
    const ciphertext = encodeE2eeBytes(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM',
      iv: nonce, additionalData: e2eeAdditionalData(context), tagLength: 128 }, dek, plaintext)));
    const envelope = { context, wrappedKey, nonce: encodeE2eeBytes(nonce), ciphertext };
    const signature = encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
      deviceSigningKey, await signatureData(envelope))));
    return validateE2eeEnvelope({ ...envelope, signature });
  } finally { plaintext.fill(0); }
}

/** The public key must come from a verified device directory, not network payload metadata. */
export async function verifyE2eeEnvelope(source: unknown, expectedContext: E2eeContext,
  trustedDeviceKey: CryptoKey): Promise<E2eeEnvelope> {
  const envelope = validateE2eeEnvelope(source);
  const expected = e2eeAdditionalData(expectedContext), actual = e2eeAdditionalData(envelope.context);
  if (expected.length !== actual.length || expected.some((byte, i) => byte !== actual[i])) {
    throw new Error('E2EE_CONTEXT_MISMATCH');
  }
  assertKey(trustedDeviceKey, 'ECDSA', 'verify');
  try {
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, trustedDeviceKey,
      decodeE2eeBytes(envelope.signature, 64), await signatureData(envelope))) corrupt();
  } catch { return corrupt(); }
  return envelope;
}

export async function openE2eeEnvelope(root: CryptoKey, trustedDeviceKey: CryptoKey,
  expectedContext: E2eeContext, source: unknown): Promise<Uint8Array<ArrayBuffer>> {
  assertKey(root, 'AES-KW', 'unwrapKey');
  const envelope = await verifyE2eeEnvelope(source, expectedContext, trustedDeviceKey);
  try {
    const dek = await crypto.subtle.unwrapKey('raw', decodeE2eeBytes(envelope.wrappedKey, 40), root, 'AES-KW',
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: decodeE2eeBytes(envelope.nonce, 12), additionalData: e2eeAdditionalData(envelope.context), tagLength: 128 },
    dek, decodeE2eeBytes(envelope.ciphertext, 16, E2EE_MAX_PLAINTEXT + 16)));
  } catch { return corrupt(); }
}
