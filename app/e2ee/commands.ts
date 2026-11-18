import { decodeE2eeBytes, encodeE2eeBytes } from './envelope.ts';
import { assertTechnical, exactKeys } from './keys.ts';

export type WireValue = null | boolean | number | string | WireValue[] | { [key: string]: WireValue };
const encoder = new TextEncoder();
const MAX_BYTES = 6 * 1024 * 1024;
/** Own data descriptors only; never invokes toJSON/getters or reads a Proxy through get. */
export function snapshotE2eeValue<T>(source: T): T {
  let remaining = MAX_BYTES;
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 16 || --remaining < 0) throw new Error('E2EE_INVALID_COMMAND');
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') { remaining -= value.length; if (remaining < 0) throw new Error('E2EE_COMMAND_TOO_LARGE'); return value; }
    if (!value || typeof value !== 'object') throw new Error('E2EE_INVALID_COMMAND');
    const list = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!list && ![Object.prototype, null].includes(prototype)) throw new Error('E2EE_INVALID_COMMAND');
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) throw new Error('E2EE_INVALID_COMMAND');
    if (list) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 10000 || keys.length !== length + 1) throw new Error('E2EE_INVALID_COMMAND');
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const item = descriptors[String(index)];
        if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw new Error('E2EE_INVALID_COMMAND');
        result.push(visit(item.value, depth + 1));
      }
      return Object.freeze(result);
    }
    if (keys.length > 128) throw new Error('E2EE_INVALID_COMMAND');
    const result = Object.create(null);
    for (const key of keys as string[]) {
      const item = descriptors[key];
      if (!item.enumerable || !Object.hasOwn(item, 'value')) throw new Error('E2EE_INVALID_COMMAND');
      result[key] = visit(item.value, depth + 1);
    }
    return Object.freeze(result);
  };
  try { return visit(source, 0) as T; } catch { throw new Error('E2EE_INVALID_COMMAND'); }
}
/** Bounded tagged encoding, independent of JSON property order/number spelling. */
export function canonicalE2eeValue(value: WireValue): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []; let size = 0;
  const append = (part: Uint8Array) => { size += part.length; if (size > MAX_BYTES) throw new Error('E2EE_COMMAND_TOO_LARGE'); parts.push(part); };
  const u32 = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); append(bytes); };
  function visit(item: WireValue, depth: number) {
    if (depth > 16) throw new Error('E2EE_INVALID_COMMAND');
    if (item === null) { append(Uint8Array.of(0)); return; }
    if (typeof item === 'boolean') { append(Uint8Array.of(item ? 2 : 1)); return; }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || item < 0) throw new Error('E2EE_INVALID_COMMAND');
      const bytes = new Uint8Array(9); bytes[0] = 3;
      const view = new DataView(bytes.buffer); view.setUint32(1, Math.floor(item / 0x100000000)); view.setUint32(5, item % 0x100000000);
      append(bytes); return;
    }
    if (typeof item === 'string') {
      // All wire strings are technical metadata/ciphertext, never user text.
      if (!/^[\x20-\x7e]*$/.test(item)) throw new Error('E2EE_INVALID_COMMAND');
      const bytes = encoder.encode(item); append(Uint8Array.of(4)); u32(bytes.length); append(bytes); return;
    }
    if (Array.isArray(item)) {
      if (item.length > 10000) throw new Error('E2EE_INVALID_COMMAND');
      append(Uint8Array.of(5)); u32(item.length);
      for (let index = 0; index < item.length; index++) {
        const entry = Object.getOwnPropertyDescriptor(item, String(index));
        if (!entry || !Object.hasOwn(entry, 'value')) throw new Error('E2EE_INVALID_COMMAND');
        visit(entry.value, depth + 1);
      }
      if (Reflect.ownKeys(item).length !== item.length + 1) throw new Error('E2EE_INVALID_COMMAND');
      return;
    }
    if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('E2EE_INVALID_COMMAND');
    const keys = Reflect.ownKeys(item);
    if (keys.length < 1 || keys.length > 128 || keys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key))) throw new Error('E2EE_INVALID_COMMAND');
    const names = (keys as string[]).sort(); append(Uint8Array.of(6)); u32(names.length);
    for (const name of names) {
      const property = Object.getOwnPropertyDescriptor(item, name);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw new Error('E2EE_INVALID_COMMAND');
      visit(name, depth + 1); visit(property.value, depth + 1);
    }
  }
  visit(value, 0);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export type E2eeCommand = { protocol: 1; ownerId: string; scopeId: string; deviceId: string;
  action: string; expectedRevision: number; checkpointHash: string; securityEpoch: number; operationId: string; payload: { [key: string]: WireValue } };
export type SignedE2eeCommand = { command: E2eeCommand; signature: string };
export function commandBytes(source: E2eeCommand): Uint8Array<ArrayBuffer> {
  source = snapshotE2eeValue(source);
  exactKeys(source, ['protocol', 'ownerId', 'scopeId', 'deviceId', 'action', 'expectedRevision', 'checkpointHash', 'securityEpoch', 'operationId', 'payload']);
  if (source.protocol !== 1 || !Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0
    || !Number.isSafeInteger(source.securityEpoch) || source.securityEpoch < 1) throw new Error('E2EE_INVALID_COMMAND');
  for (const field of ['ownerId', 'scopeId', 'deviceId', 'action', 'operationId'] as const) assertTechnical(source[field]);
  if (source.checkpointHash !== 'genesis') decodeE2eeBytes(source.checkpointHash, 32);
  const prefix = encoder.encode('GENESIS-E2EE-COMMAND\0v1\0'), body = canonicalE2eeValue(source as unknown as WireValue);
  const bytes = new Uint8Array(prefix.length + body.length); bytes.set(prefix); bytes.set(body, prefix.length); return bytes;
}
export async function signE2eeCommand(command: E2eeCommand, privateKey: CryptoKey): Promise<SignedE2eeCommand> {
  // The returned snapshot is also the retry record. Mutating the caller's object cannot change it.
  const snapshot = snapshotE2eeValue(command), bytes = commandBytes(snapshot);
  return { command: snapshot, signature: encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes))) };
}
export async function verifyE2eeCommand(source: SignedE2eeCommand, publicKey: CryptoKey): Promise<E2eeCommand> {
  source = snapshotE2eeValue(source);
  exactKeys(source, ['command', 'signature']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    decodeE2eeBytes(source.signature, 64), commandBytes(source.command))) throw new Error('E2EE_UNTRUSTED_COMMAND');
  return JSON.parse(JSON.stringify(source.command)) as E2eeCommand;
}
export async function e2eeCommandHash(command: E2eeCommand) {
  command = snapshotE2eeValue(command);
  // Signatures are proofs, not operation identity (ES256 permits r,s / r,n-s).
  const withoutProofs = (value: WireValue): WireValue => Array.isArray(value) ? value.map(withoutProofs)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'signature' && key !== 'selfProof').map(([key, item]) => [key, withoutProofs(item)])) : value;
  const stable = withoutProofs(command as unknown as WireValue);
  return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalE2eeValue(stable))));
}
