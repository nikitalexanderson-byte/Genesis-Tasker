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
export function exactKeys<const N extends readonly string[]>(value: unknown, names: N): asserts value is Record<N[number], unknown> & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) invalid();
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
  }
}
/** Capture key metadata once before any asynchronous cryptographic operation.
 * Do not invoke accessors, toJSON or later caller-owned property reads. */
function keyFields<T>(source: T, names: readonly string[]): T {
  try {
    if (!source || typeof source !== 'object' || Array.isArray(source)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(source), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) invalid();
    const captured = Object.create(null);
    for (const name of names) {
      const field = descriptors[name];
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) invalid();
      captured[name] = field.value;
    }
    return Object.freeze(captured) as T;
  } catch { return invalid(); }
}
function ownedBytes(source: Uint8Array, minimum: number, maximum: number): Uint8Array<ArrayBuffer> {
  if (!(source instanceof Uint8Array) || source.length < minimum || source.length > maximum) invalid();
  const copy = new Uint8Array(source);
  if (copy.length < minimum || copy.length > maximum) { copy.fill(0); invalid(); }
  return copy;
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
  const saved = keyFields(source, ['signingKey', 'receivingKey', 'signingPrivate', 'receivingPrivate']) as PrivateDeviceKeys;
  try {
    const signing = {
      publicKey: await crypto.subtle.importKey('spki', decodeE2eeBytes(saved.signingKey, 91),
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
      privateKey: await crypto.subtle.importKey('pkcs8', decodeE2eeBytes(saved.signingPrivate, 67, 200),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
    };
    const receiving = {
      publicKey: await hpke.kem.deserializePublicKey(decodeE2eeBytes(saved.receivingKey, 65).buffer),
      privateKey: await hpke.kem.deserializePrivateKey(decodeE2eeBytes(saved.receivingPrivate, 32).buffer),
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
/** Recovery reader: import the receiving key and verification key only. The
 * historical signing private key is never imported or exposed. */
export async function importDeviceReadKeys(source:unknown){
 const saved=keyFields(source,['signingKey','receivingKey','receivingPrivate']) as PublicDeviceKeys&{receivingPrivate:string};
 const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(saved.signingKey,91),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const receiving={publicKey:await hpke.kem.deserializePublicKey(decodeE2eeBytes(saved.receivingKey,65).buffer),privateKey:await hpke.kem.deserializePrivateKey(decodeE2eeBytes(saved.receivingPrivate,32).buffer)};
 const probe=freshSecret();let opened:Uint8Array|undefined;try{const sender=await hpke.createSenderContext({recipientPublicKey:receiving.publicKey,info:probe.buffer}),recipient=await hpke.createRecipientContext({recipientKey:receiving.privateKey,enc:sender.enc,info:probe.buffer});opened=new Uint8Array(await recipient.open(await sender.seal(probe.buffer)));if(opened.length!==probe.length||opened.some((value,at)=>value!==probe[at]))invalid();return{signer,receivingKey:receiving.privateKey,publicKeys:{signingKey:saved.signingKey,receivingKey:saved.receivingKey}};}finally{probe.fill(0);opened?.fill(0);}
}

/** Only accepts a CSPRNG-generated 256-bit secret, never a password or identity token. */
async function secretKey(secret: Uint8Array, salt: Uint8Array<ArrayBuffer>, ownerId: string, purpose: string) {
  assertTechnical(ownerId); assertTechnical(purpose);
  const copy = ownedBytes(secret, 32, 32);
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
  const copy = ownedBytes(value, 0, MAX_BUNDLE);
  try {
    const salt = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await secretKey(secret, salt, ownerId, purpose);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: bundleAad(ownerId, purpose), tagLength: 128 }, key, copy));
    return { protocol: 1, ownerId, purpose, salt: encodeE2eeBytes(salt), nonce: encodeE2eeBytes(nonce), ciphertext: encodeE2eeBytes(ciphertext) };
  } finally { copy.fill(0); }
}
export async function openBundle(ownerId: string, purpose: string, secret: Uint8Array, source: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const saved = keyFields(source, ['protocol', 'ownerId', 'purpose', 'salt', 'nonce', 'ciphertext']) as ProtectedBundle;
  if (saved.protocol !== 1 || saved.ownerId !== ownerId || saved.purpose !== purpose) invalid();
  const salt = decodeE2eeBytes(saved.salt, 32), nonce = decodeE2eeBytes(saved.nonce, 12);
  const ciphertext = decodeE2eeBytes(saved.ciphertext, 16, MAX_BUNDLE + 16);
  try {
    const key = await secretKey(secret, salt, ownerId, purpose);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: bundleAad(ownerId, purpose), tagLength: 128 }, key, ciphertext));
  } catch { throw new Error('E2EE_UNLOCK_REQUIRED'); }
}

export type RootRecipient = { ownerId: string; scopeId: string; cryptoEpoch: number; keyId: string; recipientId: string };
export type RootCapsule = { suite: typeof HPKE_SUITE; enc: string; ciphertext: string };
function rootInfo(context: RootRecipient) {
  context = keyFields(context, ['ownerId', 'scopeId', 'cryptoEpoch', 'keyId', 'recipientId']);
  for (const field of ['ownerId', 'scopeId', 'keyId', 'recipientId'] as const) assertTechnical(context[field]);
  if (!Number.isSafeInteger(context.cryptoEpoch) || context.cryptoEpoch < 1) invalid();
  return utf8.encode(`GENESIS-E2EE-ROOT\0v1\0${context.ownerId}\0${context.scopeId}\0${context.cryptoEpoch}\0${context.keyId}\0${context.recipientId}`).buffer;
}
export async function sealRoot(root: Uint8Array, receivingKey: string, context: RootRecipient): Promise<RootCapsule> {
  const copy = ownedBytes(root, 32, 32);
  try {
    const info = rootInfo(context), encodedRecipient = decodeE2eeBytes(receivingKey, 65);
    const recipientPublicKey = await hpke.kem.deserializePublicKey(encodedRecipient.buffer);
    const sender = await hpke.createSenderContext({ recipientPublicKey, info });
    return { suite: HPKE_SUITE, enc: encodeE2eeBytes(new Uint8Array(sender.enc)),
      ciphertext: encodeE2eeBytes(new Uint8Array(await sender.seal(copy.buffer))) };
  }
  finally { copy.fill(0); }
}
export async function openRoot(capsule: unknown, privateKey: CryptoKey, context: RootRecipient): Promise<CryptoKey> {
  const saved = keyFields(capsule, ['suite', 'enc', 'ciphertext']) as RootCapsule;
  if (saved.suite !== HPKE_SUITE) invalid();
  const enc = decodeE2eeBytes(saved.enc, 65), ciphertext = decodeE2eeBytes(saved.ciphertext, 48), info = rootInfo(context);
  const recipient = await hpke.createRecipientContext({ recipientKey: privateKey,
    enc: enc.buffer, info });
  let root: Uint8Array | undefined;
  try {
    root = new Uint8Array(await recipient.open(ciphertext.buffer));
    return await importE2eeRoot(root);
  } catch { throw new Error('E2EE_CORRUPT_ROOT'); }
  finally { root?.fill(0); }
}
/** Re-address an already trusted capsule without making the root extractable/persistent. */
export async function forwardRoot(capsule: unknown, privateKey: CryptoKey, source: RootRecipient,
  receivingKey: string, target: RootRecipient): Promise<RootCapsule> {
  source = keyFields(source, ['ownerId', 'scopeId', 'cryptoEpoch', 'keyId', 'recipientId']);
  target = keyFields(target, ['ownerId', 'scopeId', 'cryptoEpoch', 'keyId', 'recipientId']);
  if (source.ownerId !== target.ownerId || source.scopeId !== target.scopeId || source.cryptoEpoch !== target.cryptoEpoch || source.keyId !== target.keyId) invalid();
  const saved = keyFields(capsule, ['suite', 'enc', 'ciphertext']) as RootCapsule;
  if(saved.suite!==HPKE_SUITE)invalid();
  const enc=decodeE2eeBytes(saved.enc,65),ciphertext=decodeE2eeBytes(saved.ciphertext,48),info=rootInfo(source);
  rootInfo(target);
  const recipient=await hpke.createRecipientContext({recipientKey:privateKey,enc:enc.buffer,info});
  let root:Uint8Array|undefined;
  try { root=new Uint8Array(await recipient.open(ciphertext.buffer));return await sealRoot(root,receivingKey,target); }
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
  const savedKit = keyFields(source, ['protocol', 'ownerId', 'authority', 'protectedKeys']) as RecoveryKit;
  if (savedKit.protocol !== 1 || savedKit.ownerId !== ownerId) invalid();
  const authority = keyFields(savedKit.authority, ['signingKey', 'receivingKey']);
  const bytes = await openBundle(ownerId, 'recovery-authority', secret, savedKit.protectedKeys);
  try {
    const saved = JSON.parse(text.decode(bytes)) as PrivateDeviceKeys;
    if (saved.signingKey !== authority.signingKey || saved.receivingKey !== authority.receivingKey) invalid();
    return await importDeviceKeys(saved);
  } finally { bytes.fill(0); }
}
