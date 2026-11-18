import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { decodeE2eeBytes, encodeE2eeBytes, importE2eeRoot } from './envelope.ts';

/** RFC 9180: DHKEM(P-256,HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM. */
export const HPKE_SUITE = 'DHKEM-P256-HKDFSHA256-A256GCM' as const;
const hpke = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const utf8 = new TextEncoder();
const text = new TextDecoder('utf-8', { fatal: true });
const MAX_BUNDLE = 64 * 1024;
const technical = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
function invalid(): never { throw new Error('E2EE_INVALID_KEY_BUNDLE'); }
export function assertTechnical(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !technical.test(value)) invalid();
}
export function exactKeys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) invalid();
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
  }
}
export function freshSecret(): Uint8Array<ArrayBuffer> { return crypto.getRandomValues(new Uint8Array(32)); }

export type PublicDeviceKeys = { signingKey: string; receivingKey: string };
export type DeviceKeys = { signing: CryptoKeyPair; receiving: CryptoKeyPair };
export type PrivateDeviceKeys = PublicDeviceKeys & { signingPrivate: string; receivingPrivate: string };

export async function generateDeviceKeys(): Promise<DeviceKeys> {
  return { signing: await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
    receiving: await hpke.kem.generateKeyPair() };
}
export async function publicDeviceKeys(keys: DeviceKeys): Promise<PublicDeviceKeys> {
  return { signingKey: encodeE2eeBytes(new Uint8Array(await crypto.subtle.exportKey('spki', keys.signing.publicKey))),
    receivingKey: encodeE2eeBytes(new Uint8Array(await hpke.kem.serializePublicKey(keys.receiving.publicKey))) };
}
export async function exportPrivateDeviceKeys(keys: DeviceKeys): Promise<PrivateDeviceKeys> {
  return { ...await publicDeviceKeys(keys),
    signingPrivate: encodeE2eeBytes(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.signing.privateKey))),
    receivingPrivate: encodeE2eeBytes(new Uint8Array(await hpke.kem.serializePrivateKey(keys.receiving.privateKey))) };
}
export async function importDeviceKeys(source: unknown): Promise<DeviceKeys> {
  exactKeys(source, ['signingKey', 'receivingKey', 'signingPrivate', 'receivingPrivate']);
  try {
    const signing = {
      publicKey: await crypto.subtle.importKey('spki', decodeE2eeBytes(source.signingKey, 91),
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
      privateKey: await crypto.subtle.importKey('pkcs8', decodeE2eeBytes(source.signingPrivate, 67, 200),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
    };
    const receiving = {
      publicKey: await hpke.kem.deserializePublicKey(decodeE2eeBytes(source.receivingKey, 65).buffer),
      privateKey: await hpke.kem.deserializePrivateKey(decodeE2eeBytes(source.receivingPrivate, 32).buffer),
    };
    // Fail on mismatched public/private key pairs before granting any trust.
    const probe = freshSecret();
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.privateKey, probe);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signing.publicKey, signature, probe)) invalid();
    const sender = await hpke.createSenderContext({ recipientPublicKey: receiving.publicKey, info: probe.buffer });
    const recipient = await hpke.createRecipientContext({ recipientKey: receiving.privateKey, enc: sender.enc, info: probe.buffer });
    const opened = new Uint8Array(await recipient.open(await sender.seal(probe.buffer)));
    if (opened.some((byte, i) => byte !== probe[i])) invalid();
    probe.fill(0); opened.fill(0);
    return { signing, receiving };
  } catch { return invalid(); }
}

/** Only accepts a CSPRNG-generated 256-bit secret, never a password or identity token. */
async function secretKey(secret: Uint8Array, salt: Uint8Array<ArrayBuffer>, ownerId: string, purpose: string) {
  assertTechnical(ownerId); assertTechnical(purpose);
  if (secret.length !== 32) invalid();
  const copy = new Uint8Array(secret);
  try {
    const material = await crypto.subtle.importKey('raw', copy, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt,
      info: utf8.encode(`GENESIS-E2EE-SECRET\0v1\0${ownerId}\0${purpose}`) }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { copy.fill(0); }
}
export type ProtectedBundle = { protocol: 1; ownerId: string; purpose: string; salt: string; nonce: string; ciphertext: string };
function bundleAad(ownerId: string, purpose: string) {
  assertTechnical(ownerId); assertTechnical(purpose);
  return utf8.encode(`GENESIS-E2EE-BUNDLE\0v1\0${ownerId}\0${purpose}`);
}
export async function protectBundle(ownerId: string, purpose: string, secret: Uint8Array, value: Uint8Array): Promise<ProtectedBundle> {
  if (value.length > MAX_BUNDLE) invalid();
  const salt = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await secretKey(secret, salt, ownerId, purpose);
  const copy = new Uint8Array(value);
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: bundleAad(ownerId, purpose), tagLength: 128 }, key, copy));
    return { protocol: 1, ownerId, purpose, salt: encodeE2eeBytes(salt), nonce: encodeE2eeBytes(nonce), ciphertext: encodeE2eeBytes(ciphertext) };
  } finally { copy.fill(0); }
}
export async function openBundle(ownerId: string, purpose: string, secret: Uint8Array, source: unknown): Promise<Uint8Array<ArrayBuffer>> {
  exactKeys(source, ['protocol', 'ownerId', 'purpose', 'salt', 'nonce', 'ciphertext']);
  if (source.protocol !== 1 || source.ownerId !== ownerId || source.purpose !== purpose) invalid();
  const salt = decodeE2eeBytes(source.salt, 32), nonce = decodeE2eeBytes(source.nonce, 12);
  const ciphertext = decodeE2eeBytes(source.ciphertext, 16, MAX_BUNDLE + 16);
  try {
    const key = await secretKey(secret, salt, ownerId, purpose);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: bundleAad(ownerId, purpose), tagLength: 128 }, key, ciphertext));
  } catch { throw new Error('E2EE_UNLOCK_REQUIRED'); }
}

export type RootRecipient = { ownerId: string; scopeId: string; cryptoEpoch: number; keyId: string; recipientId: string };
export type RootCapsule = { suite: typeof HPKE_SUITE; enc: string; ciphertext: string };
function rootInfo(context: RootRecipient) {
  exactKeys(context, ['ownerId', 'scopeId', 'cryptoEpoch', 'keyId', 'recipientId']);
  for (const field of ['ownerId', 'scopeId', 'keyId', 'recipientId'] as const) assertTechnical(context[field]);
  if (!Number.isSafeInteger(context.cryptoEpoch) || context.cryptoEpoch < 1) invalid();
  return utf8.encode(`GENESIS-E2EE-ROOT\0v1\0${context.ownerId}\0${context.scopeId}\0${context.cryptoEpoch}\0${context.keyId}\0${context.recipientId}`).buffer;
}
export async function sealRoot(root: Uint8Array, receivingKey: string, context: RootRecipient): Promise<RootCapsule> {
  if (root.length !== 32) invalid();
  const recipientPublicKey = await hpke.kem.deserializePublicKey(decodeE2eeBytes(receivingKey, 65).buffer);
  const sender = await hpke.createSenderContext({ recipientPublicKey, info: rootInfo(context) });
  const copy = new Uint8Array(root);
  try { return { suite: HPKE_SUITE, enc: encodeE2eeBytes(new Uint8Array(sender.enc)),
    ciphertext: encodeE2eeBytes(new Uint8Array(await sender.seal(copy.buffer))) }; }
  finally { copy.fill(0); }
}
export async function openRoot(capsule: unknown, privateKey: CryptoKey, context: RootRecipient): Promise<CryptoKey> {
  exactKeys(capsule, ['suite', 'enc', 'ciphertext']);
  if (capsule.suite !== HPKE_SUITE) invalid();
  const recipient = await hpke.createRecipientContext({ recipientKey: privateKey,
    enc: decodeE2eeBytes(capsule.enc, 65).buffer, info: rootInfo(context) });
  let root: Uint8Array | undefined;
  try {
    root = new Uint8Array(await recipient.open(decodeE2eeBytes(capsule.ciphertext, 48).buffer));
    return await importE2eeRoot(root);
  } catch { throw new Error('E2EE_CORRUPT_ROOT'); }
  finally { root?.fill(0); }
}
/** Re-address an already trusted capsule without making the root extractable/persistent. */
export async function forwardRoot(capsule: unknown, privateKey: CryptoKey, source: RootRecipient,
  receivingKey: string, target: RootRecipient): Promise<RootCapsule> {
  if (source.ownerId !== target.ownerId || source.scopeId !== target.scopeId || source.cryptoEpoch !== target.cryptoEpoch || source.keyId !== target.keyId) invalid();
  exactKeys(capsule,['suite','enc','ciphertext']);if(capsule.suite!==HPKE_SUITE)invalid();
  const recipient=await hpke.createRecipientContext({recipientKey:privateKey,enc:decodeE2eeBytes(capsule.enc,65).buffer,info:rootInfo(source)});
  let root:Uint8Array|undefined;
  try { root=new Uint8Array(await recipient.open(decodeE2eeBytes(capsule.ciphertext,48).buffer));return await sealRoot(root,receivingKey,target); }
  catch {throw new Error('E2EE_CORRUPT_ROOT');}finally{root?.fill(0);}
}

export type RecoveryKit = { protocol: 1; ownerId: string; authority: PublicDeviceKeys; protectedKeys: ProtectedBundle };
export async function createRecoveryKit(ownerId: string) {
  assertTechnical(ownerId);
  const secret = freshSecret(), keys = await generateDeviceKeys();
  const bytes = utf8.encode(JSON.stringify(await exportPrivateDeviceKeys(keys)));
  try {
    const kit: RecoveryKit = { protocol: 1, ownerId, authority: await publicDeviceKeys(keys),
      protectedKeys: await protectBundle(ownerId, 'recovery-authority', secret, bytes) };
    return { secret, keys, kit };
  } finally { bytes.fill(0); }
}
export async function recoverAuthority(ownerId: string, secret: Uint8Array, source: unknown): Promise<DeviceKeys> {
  exactKeys(source, ['protocol', 'ownerId', 'authority', 'protectedKeys']);
  if (source.protocol !== 1 || source.ownerId !== ownerId) invalid();
  exactKeys(source.authority, ['signingKey', 'receivingKey']);
  const bytes = await openBundle(ownerId, 'recovery-authority', secret, source.protectedKeys);
  try {
    const saved = JSON.parse(text.decode(bytes)) as PrivateDeviceKeys;
    if (saved.signingKey !== source.authority.signingKey || saved.receivingKey !== source.authority.receivingKey) invalid();
    return await importDeviceKeys(saved);
  } finally { bytes.fill(0); }
}
