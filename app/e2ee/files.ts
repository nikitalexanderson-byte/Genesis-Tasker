import { canonicalE2eeValue, snapshotE2eeValue, type WireValue } from './commands.ts';
import { decodeE2eeBytes, encodeE2eeBytes, e2eeAdditionalData, importE2eeRoot, openE2eeEnvelope, sealE2eeEnvelope,
  validateE2eeEnvelope, type E2eeContext, type E2eeEnvelope } from './envelope.ts';
import { exactKeys, freshSecret } from './keys.ts';

export const E2EE_CHUNK_BYTES = 256 * 1024;
export const E2EE_MAX_FILE_BYTES = 64 * 1024 * 1024;
type ChunkDescriptor = { objectId: string; operationId: string; index: number; size: number; hash: string };
type FileManifest = { protocol: 1; fileKey: string; size: number; chunkSize: number; filename: string; mediaType: string; chunks: ChunkDescriptor[] };
export type SealedE2eeFile = { manifest: E2eeEnvelope; chunks: E2eeEnvelope[] };
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function corrupt(): never { throw new Error('E2EE_CORRUPT_FILE'); }
export async function envelopePayloadHash(envelope: E2eeEnvelope) {
  const valid = validateE2eeEnvelope(envelope);
  const signatureData = new Uint8Array([
    ...encoder.encode('GENESIS-E2EE-SIGNATURE\0v1\0'),
  ]);
  // Same signature-free identity as the server. The cryptographic signature is verified separately.
  const aad = e2eeAdditionalData(valid.context), wrapped = decodeE2eeBytes(valid.wrappedKey, 40), nonce = decodeE2eeBytes(valid.nonce, 12);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', decodeE2eeBytes(valid.ciphertext, 16, 4 * 1024 * 1024 + 16)));
  const bytes = new Uint8Array(signatureData.length + aad.length + 84);
  let offset = 0; for (const part of [signatureData, aad, wrapped, nonce, digest]) { bytes.set(part, offset); offset += part.length; }
  return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
export async function sealE2eeFile(root: CryptoKey, signingKey: CryptoKey, context: E2eeContext,
  source: Uint8Array, metadata: { filename: string; mediaType: string }): Promise<SealedE2eeFile> {
  if (source.length > E2EE_MAX_FILE_BYTES || typeof metadata.filename !== 'string' || metadata.filename.length > 512
    || typeof metadata.mediaType !== 'string' || metadata.mediaType.length > 128) throw new Error('E2EE_FILE_TOO_LARGE');
  context = snapshotE2eeValue(context); metadata = { filename: metadata.filename, mediaType: metadata.mediaType };
  const copy = new Uint8Array(source), fileKey = freshSecret(), fileId = crypto.randomUUID();
  try {
    const chunkRoot = await importE2eeRoot(fileKey), chunks: E2eeEnvelope[] = [], descriptors: ChunkDescriptor[] = [];
    for (let offset = 0, index = 0; offset < copy.length; offset += E2EE_CHUNK_BYTES, index++) {
      const objectId = `${fileId}:${String(index).padStart(6,'0')}`, operationId = crypto.randomUUID();
      const bytes = copy.subarray(offset, Math.min(offset + E2EE_CHUNK_BYTES, copy.length));
      const chunk = await sealE2eeEnvelope(chunkRoot, signingKey, { ...context, domain: 'attachment', objectId, operationId, revision: 1 }, bytes);
      chunks.push(chunk); descriptors.push({ objectId, operationId, index, size: bytes.length, hash: await envelopePayloadHash(chunk) });
    }
    const manifest: FileManifest = { protocol: 1, fileKey: encodeE2eeBytes(fileKey), size: copy.length, chunkSize: E2EE_CHUNK_BYTES,
      filename: metadata.filename, mediaType: metadata.mediaType, chunks: descriptors };
    const privateBytes = encoder.encode(JSON.stringify(manifest));
    try { return { manifest: await sealE2eeEnvelope(root, signingKey, context, privateBytes), chunks }; }
    finally { privateBytes.fill(0); }
  } finally { copy.fill(0); fileKey.fill(0); }
}
export async function openE2eeFile(root: CryptoKey, signer: CryptoKey, expectedContext: E2eeContext, manifestEnvelope: E2eeEnvelope,
  fetchChunk: (objectId: string) => Promise<E2eeEnvelope>): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string; mediaType: string }> {
  const privateBytes = await openE2eeEnvelope(root, signer, expectedContext, manifestEnvelope);
  let keyBytes: Uint8Array | undefined, output: Uint8Array<ArrayBuffer> | undefined;
  try {
    const manifest: FileManifest = JSON.parse(decoder.decode(privateBytes));
    exactKeys(manifest, ['protocol','fileKey','size','chunkSize','filename','mediaType','chunks']);
    if (manifest.protocol !== 1 || manifest.chunkSize !== E2EE_CHUNK_BYTES || !Number.isSafeInteger(manifest.size)
      || manifest.size < 0 || manifest.size > E2EE_MAX_FILE_BYTES || typeof manifest.filename !== 'string' || manifest.filename.length > 512
      || typeof manifest.mediaType !== 'string' || manifest.mediaType.length > 128 || !Array.isArray(manifest.chunks)
      || manifest.chunks.length !== Math.ceil(manifest.size / E2EE_CHUNK_BYTES)) corrupt();
    keyBytes = decodeE2eeBytes(manifest.fileKey, 32); const chunkRoot = await importE2eeRoot(keyBytes);
    output = new Uint8Array(manifest.size); const seen = new Set<string>(); let offset = 0;
    for (let index = 0; index < manifest.chunks.length; index++) {
      const entry = manifest.chunks[index]; exactKeys(entry, ['objectId','operationId','index','size','hash']);
      if (entry.index !== index || entry.size !== Math.min(E2EE_CHUNK_BYTES, manifest.size - offset) || seen.has(entry.objectId)) corrupt();
      seen.add(entry.objectId);
      const envelope = validateE2eeEnvelope(await fetchChunk(entry.objectId));
      if (entry.hash !== await envelopePayloadHash(envelope)) corrupt();
      const bytes = await openE2eeEnvelope(chunkRoot, signer, { ...expectedContext, domain: 'attachment', objectId: entry.objectId, operationId: entry.operationId, revision: 1 }, envelope);
      try { if (bytes.length !== entry.size) corrupt(); output.set(bytes, offset); offset += bytes.length; }
      finally { bytes.fill(0); }
    }
    if (offset !== manifest.size) corrupt();
    return { bytes: output, filename: manifest.filename, mediaType: manifest.mediaType };
  } catch { output?.fill(0); return corrupt(); }
  finally { privateBytes.fill(0); keyBytes?.fill(0); }
}
export async function objectManifestHash(items: { domain: string; objectId: string; revision: number; payloadHash: string }[]) {
  const sorted = [...items].sort((a,b) => a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0);
  if (new Set(sorted.map(item => `${item.domain}\0${item.objectId}`)).size !== sorted.length) throw new Error('E2EE_DUPLICATE_OBJECT');
  return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalE2eeValue(sorted as unknown as WireValue))));
}
