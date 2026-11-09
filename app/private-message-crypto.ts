export type MessagingIdentity = { privateKey: CryptoKey; publicKey: JsonWebKey; keyId: string };
export type MessageContext = { conversationId: string; spaceId: string; id: string; senderId: string; revision: number };
export type MessagePayload = { version: 1; iv: string; ciphertext: string; keyIds: Record<string, string> };
export type PrivateFile = { id: string; name: string; type: string; size: number; iv: string; chunks: number };
export type PrivateContent = { format: 'genesis-private-content'; text: string; files: PrivateFile[] };
export const PRIVATE_FILE_LIMIT = 10 * 1024 * 1024;
export const PRIVATE_CHUNK_SIZE = 256 * 1024;
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const base64 = (data: ArrayBuffer | Uint8Array) => {
  const values = new Uint8Array(data); let binary = '';
  for (let offset = 0; offset < values.length; offset += 8192) binary += String.fromCharCode(...values.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
};
const unbase64 = (text: string) => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), char => char.charCodeAt(0));
export function canonicalPublicKey(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y ?? '')) throw new Error('INVALID_PUBLIC_KEY');
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}
export async function keyFingerprint(jwk: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes(JSON.stringify(canonicalPublicKey(jwk))));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('');
}
export async function createMessagingIdentity(): Promise<MessagingIdentity> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = canonicalPublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey, keyId: await keyFingerprint(publicKey) };
}
export async function conversationKey(identity: MessagingIdentity, peer: JsonWebKey, conversationId: string, spaceId: string): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey('jwk', canonicalPublicKey(peer), { name:'ECDH', namedCurve:'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name:'ECDH', public:publicKey }, identity.privateKey, 256);
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', bytes(JSON.stringify(['GENESIS private messages v1',spaceId,conversationId, ...[identity.keyId,await keyFingerprint(peer)].sort()])));
  return crypto.subtle.deriveKey({ name:'HKDF', hash:'SHA-256', salt, info:bytes('AES-GCM-256') }, material, { name:'AES-GCM',length:256 }, false, ['encrypt','decrypt']);
}
const aad = (context: MessageContext) => bytes(JSON.stringify([1,context.spaceId,context.conversationId,context.id,context.senderId,context.revision]));
const fileAad = (context: MessageContext, id: string) => bytes(JSON.stringify(['GENESIS private file v1', context.spaceId, context.conversationId, context.id, context.senderId, id]));
export async function encryptPrivateFile(key: CryptoKey, context: MessageContext, file: File, id = crypto.randomUUID()): Promise<{ metadata: PrivateFile; chunks: string[] }> {
  if (file.size > PRIVATE_FILE_LIMIT) throw new Error('PRIVATE_FILE_TOO_LARGE');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: fileAad(context, id) }, key, await file.arrayBuffer()));
  const chunks: string[] = [];
  for (let offset = 0; offset < cipher.length; offset += PRIVATE_CHUNK_SIZE) chunks.push(base64(cipher.subarray(offset, offset + PRIVATE_CHUNK_SIZE)));
  return { metadata: { id, name: file.name.slice(0, 255), type: file.type, size: file.size, iv: base64(iv), chunks: chunks.length }, chunks };
}
export async function decryptPrivateFile(key: CryptoKey, context: MessageContext, file: PrivateFile, chunks: string[]): Promise<Blob> {
  if (file.size < 0 || file.size > PRIVATE_FILE_LIMIT || chunks.length !== file.chunks || file.chunks !== Math.ceil((file.size + 16) / PRIVATE_CHUNK_SIZE)) throw new Error('INVALID_PRIVATE_FILE');
  const cipher = new Uint8Array(file.size + 16); let offset = 0;
  for (const chunk of chunks) { const part = unbase64(chunk); cipher.set(part, offset); offset += part.length; }
  if (offset !== cipher.length) throw new Error('INVALID_PRIVATE_FILE');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(file.iv), additionalData: fileAad(context, file.id) }, key, cipher);
  return new Blob([plain], { type: 'application/octet-stream' });
}
export function decodePrivateContent(source: string): PrivateContent {
  // Legacy messages remain plain strings inside the encrypted envelope.
  if (!source.startsWith('{"format":"genesis-private-content"')) return { format: 'genesis-private-content', text: source, files: [] };
  const content = JSON.parse(source) as PrivateContent;
  if (typeof content.text !== 'string' || !Array.isArray(content.files) || content.files.length > 5 || content.files.some(file => !/^[a-f0-9-]{36}$/.test(file.id) || typeof file.name !== 'string' || file.name.length > 255 || typeof file.iv !== 'string' || !Number.isInteger(file.size) || file.size < 0 || file.size > PRIVATE_FILE_LIMIT || !Number.isInteger(file.chunks) || file.chunks !== Math.ceil((file.size + 16) / PRIVATE_CHUNK_SIZE) || !/^[A-Za-z0-9_-]{16}$/.test(file.iv))) throw new Error('INVALID_PRIVATE_CONTENT');
  return content;
}
export async function encryptPrivateMessage(key: CryptoKey, context: MessageContext, text: string, keyIds: Record<string,string>): Promise<MessagePayload> {
  if (!text.trim() || bytes(text).length > 32000) throw new Error('INVALID_MESSAGE');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv, additionalData:aad(context) }, key, bytes(text));
  return { version:1, iv:base64(iv), ciphertext:base64(ciphertext), keyIds };
}
export async function decryptPrivateMessage(key: CryptoKey, context: MessageContext, payload: MessagePayload, expectedKeyIds: Record<string,string>): Promise<string> {
  if (payload.version!==1 || Object.keys(payload.keyIds).length!==2 || Object.entries(expectedKeyIds).some(([id,value])=>payload.keyIds[id]!==value)) throw new Error('MESSAGE_KEY_MISMATCH');
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:unbase64(payload.iv), additionalData:aad(context) },key,unbase64(payload.ciphertext));
  return new TextDecoder('utf-8',{fatal:true}).decode(plain);
}
export async function securityCode(keyIds: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes(JSON.stringify([...keyIds].sort())));
  return Array.from(new Uint8Array(digest).slice(0,20), value=>value.toString(16).padStart(2,'0')).join('').match(/.{1,5}/g)!.join(' ');
}
async function backupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length<12) throw new Error('BACKUP_PASSWORD_REQUIRED');
  const material=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:310000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function exportMessagingBackup(identity: MessagingIdentity, password: string): Promise<string> {
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const privateKey=await crypto.subtle.exportKey('jwk',identity.privateKey);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes('GENESIS messaging backup v1')},await backupKey(password,salt),bytes(JSON.stringify(privateKey)));
  return JSON.stringify({format:'genesis-messaging-key',version:1,salt:base64(salt),iv:base64(iv),ciphertext:base64(cipher)});
}
export async function importMessagingBackup(source: string, password: string): Promise<MessagingIdentity> {
  if(source.length>4000)throw new Error('INVALID_BACKUP');
  const saved=JSON.parse(source);
  if(saved.format!=='genesis-messaging-key'||saved.version!==1||! /^[A-Za-z0-9_-]{22}$/.test(saved.salt)||! /^[A-Za-z0-9_-]{16}$/.test(saved.iv)||typeof saved.ciphertext!=='string')throw new Error('INVALID_BACKUP');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(saved.iv),additionalData:bytes('GENESIS messaging backup v1')},await backupKey(password,unbase64(saved.salt)),unbase64(saved.ciphertext));
  const jwk: JsonWebKey=JSON.parse(new TextDecoder().decode(plain));
  const publicKey=canonicalPublicKey(jwk);
  const privateKey=await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  // Validate that the private part really corresponds to the announced public part.
  const probe=await createMessagingIdentity();
  const imported={privateKey,publicKey,keyId:await keyFingerprint(publicKey)};
  const [a,b]=await Promise.all([conversationKey(imported,probe.publicKey,'backup-check','backup'),conversationKey(probe,publicKey,'backup-check','backup')]);
  const context={conversationId:'backup-check',spaceId:'backup',id:'check',senderId:'sender',revision:1};
  const ids={self:imported.keyId,peer:probe.keyId};
  await decryptPrivateMessage(b,context,await encryptPrivateMessage(a,context,'verify',ids),ids);
  return imported;
}
