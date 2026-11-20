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
  const copy = new Uint8Array(source),chunks:E2eeEnvelope[]=[];
  try {
    const source=(async function*(){for(let offset=0;offset<copy.length;offset+=E2EE_CHUNK_BYTES)yield copy.subarray(offset,Math.min(offset+E2EE_CHUNK_BYTES,copy.length));})();
    const manifest=await sealE2eeFileStream({root,signingKey,context,size:copy.length,source,metadata,assertCurrent:()=>{},
      writeQuarantinedChunk:async chunk=>{chunks.push(chunk);}});
    return{manifest,chunks};
  } finally { copy.fill(0); }
}

export type E2eeFileStreamOptions={root:CryptoKey;signingKey:CryptoKey;context:E2eeContext;size:number;
 source:AsyncIterable<Uint8Array>;metadata:{filename:string;mediaType:string};assertCurrent:()=>void;
 /** Local ciphertext quarantine only. Caller retains the protected original;
  * no transport/restore authority exists before the COMPLETE manifest and
  * coordinator plan have authenticated/read back and committed. */
 writeQuarantinedChunk:(chunk:E2eeEnvelope)=>Promise<void>};

/** Same v1 file format, bounded plaintext and ciphertext working set. The
 * mandatory source EOF includes a legacy source's final tag check. A prefix
 * chunk accepted by quarantine is not a completed file or input-save receipt.
 * The caller owns quota/key custody and must keep output local until publication. */
export async function sealE2eeFileStream(input:E2eeFileStreamOptions):Promise<E2eeEnvelope>{
 const options={...input,context:snapshotE2eeValue(input.context),metadata:{filename:input.metadata.filename,mediaType:input.metadata.mediaType}};
 const {root,signingKey,context,size,metadata,assertCurrent,writeQuarantinedChunk}=options;
 assertCurrent();e2eeAdditionalData(context);
 if(!Number.isSafeInteger(size)||size<0||size>E2EE_MAX_FILE_BYTES||typeof metadata.filename!=='string'||metadata.filename.length>512
  ||typeof metadata.mediaType!=='string'||metadata.mediaType.length>128)throw new Error('E2EE_FILE_TOO_LARGE');
 const source=options.source[Symbol.asyncIterator](),fileKey=freshSecret(),fileId=crypto.randomUUID(),buffer=new Uint8Array(E2EE_CHUNK_BYTES),descriptors:ChunkDescriptor[]=[];
 let filled=0,total=0,ended=false,failed=false,failure:unknown,result:E2eeEnvelope|undefined;
 try{
  const chunkRoot=await importE2eeRoot(fileKey);assertCurrent();
  const append=async(count:number)=>{
   assertCurrent();const objectId=`${fileId}:${String(descriptors.length).padStart(6,'0')}`,operationId=crypto.randomUUID();
   const chunk=snapshotE2eeValue(await sealE2eeEnvelope(chunkRoot,signingKey,{...context,domain:'attachment',objectId,operationId,revision:1},buffer.subarray(0,count)));
   assertCurrent();const hash=await envelopePayloadHash(chunk);assertCurrent();
   await writeQuarantinedChunk(chunk);assertCurrent();descriptors.push({objectId,operationId,index:descriptors.length,size:count,hash});
  };
  while(true){
   assertCurrent();const next=await source.next();assertCurrent();if(next.done){ended=true;break;}
   const value=next.value;if(!(value instanceof Uint8Array)||value.length<1||value.length>E2EE_CHUNK_BYTES||total+value.length>size)throw new Error('E2EE_INVALID_FILE_STREAM');
   // Snapshot a borrowed source chunk before the next await/iterator advance.
   const bytes=new Uint8Array(value);let at=0;
   try{total+=bytes.length;while(at<bytes.length){assertCurrent();const count=Math.min(bytes.length-at,buffer.length-filled);buffer.set(bytes.subarray(at,at+count),filled);at+=count;filled+=count;
    if(filled===buffer.length){await append(filled);buffer.fill(0);filled=0;}}}
   finally{bytes.fill(0);}
  }
  if(total!==size)throw new Error('E2EE_INVALID_FILE_STREAM');assertCurrent();if(filled)await append(filled);buffer.fill(0);
  const manifest:FileManifest={protocol:1,fileKey:encodeE2eeBytes(fileKey),size,chunkSize:E2EE_CHUNK_BYTES,filename:metadata.filename,mediaType:metadata.mediaType,chunks:descriptors};
  const privateBytes=encoder.encode(JSON.stringify(manifest));
  try{assertCurrent();const sealed=await sealE2eeEnvelope(root,signingKey,context,privateBytes);assertCurrent();result=snapshotE2eeValue(sealed);}
  finally{privateBytes.fill(0);}
 }catch(error){failed=true;failure=error;}
 finally{buffer.fill(0);fileKey.fill(0);if(!ended)try{await source.return?.();}catch(error){if(!failed){failed=true;failure=error;}}}
 if(failed)throw failure;if(!result)throw new Error('E2EE_INVALID_FILE_STREAM');return result;
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
