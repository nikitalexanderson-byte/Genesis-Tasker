import {sealE2eeFileStream,openE2eeFile,openE2eeFileStream,E2EE_CHUNK_BYTES,type E2eeFileReadStreamOptions} from '../../app/e2ee/files.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,type E2eeContext,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {parseE2eeFileManifestJson} from '../../app/e2ee/file-manifest-json.ts';
type Vector={synthetic:boolean;rootKey:string;publicKeySpki:string;context:E2eeContext;manifest:E2eeEnvelope;chunks:E2eeEnvelope[];plaintext:string;filenameUnits:number[];mediaType:string};
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function readVector(vector:Vector){
 const root=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const opened=await openE2eeFile(root,signer,vector.context,vector.manifest,async id=>vector.chunks.find(chunk=>chunk.context.objectId===id)!);
 try{const expected=decodeE2eeBytes(vector.plaintext,1,1024);return opened.bytes.length===expected.length&&opened.bytes.every((value,index)=>value===expected[index])
  &&JSON.stringify(Array.from({length:opened.filename.length},(_,index)=>opened.filename.charCodeAt(index)))===JSON.stringify(vector.filenameUnits)&&opened.mediaType===vector.mediaType;
 }finally{opened.bytes.fill(0);}
}
async function streamVector(vector:Vector){
 const root=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32)),signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const expected=decodeE2eeBytes(vector.plaintext,1,1024);let at=0,valid=true,previous:Uint8Array|undefined;
 try{const metadata=await openE2eeFileStream({root,signer,expectedContext:vector.context,manifestEnvelope:vector.manifest,assertCurrent:()=>{},
  fetchChunk:async id=>vector.chunks.find(chunk=>chunk.context.objectId===id)!,writeQuarantinedPlaintext:async bytes=>{
   valid=valid&&(!previous||previous.every(value=>value===0))&&bytes.length<=E2EE_CHUNK_BYTES&&bytes.every((value,index)=>value===expected[at+index]);at+=bytes.length;previous=bytes;await Promise.resolve();
  }});return valid&&at===expected.length&&!!previous&&previous.every(value=>value===0)&&metadata.size===at&&Object.isFrozen(metadata)
   &&JSON.stringify(Array.from({length:metadata.filename.length},(_,index)=>metadata.filename.charCodeAt(index)))===JSON.stringify(vector.filenameUnits)&&metadata.mediaType===vector.mediaType;
 }finally{expected.fill(0);}
}
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const [web,native,keys,syntax]=await Promise.all(['/web.json','/native.json','/keys.json','/syntax.json'].map(async path=>{const response=await fetch(path);if(!response.ok)throw new Error('SYNTHETIC_FIXTURE_UNAVAILABLE');return response.json();}));
 check('public web stream vector opens with all filename units',await readVector(web));check('actual JCA stream vector opens in the existing browser v1 reader',await readVector(native));
 check('public web vector opens in the bounded reader with wiped borrowed output',await streamVector(web));check('fresh actual JCA vector opens in the bounded browser reader',await streamVector(native));
 const root=await importE2eeRoot(decodeE2eeBytes(keys.rootKey,32)),signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(keys.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(keys.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const utf8=new TextEncoder();let strict=true;
 for(const row of syntax.valid){try{strict=strict&&JSON.stringify(parseE2eeFileManifestJson(utf8.encode(row.text)))===JSON.stringify(JSON.parse(row.text));}catch{strict=false;}}
 for(const row of syntax.invalid){let refused=false;try{parseE2eeFileManifestJson(row.hex?Uint8Array.from(String(row.hex).match(/../g)??[],part=>Number.parseInt(part,16)):utf8.encode(row.text));}catch(error){refused=(error as Error).message==='E2EE_CORRUPT_FILE';}strict=strict&&refused;}
 check('shared strict UTF8 JSON and decoded-name corpus',strict&&syntax.valid.length===4&&syntax.invalid.length===25);
 let noIo=true;const hash=encodeE2eeBytes(new Uint8Array(32));
 for(const mode of ['id-type','operation-type','hash','duplicate','index','size']){
  const bad:{objectId:string|number;operationId:string|number;index:number;size:number;hash:string}={objectId:'second-part',operationId:'second-operation',index:1,size:1,hash};
  if(mode==='id-type')bad.objectId=42;else if(mode==='operation-type')bad.operationId=42;else if(mode==='hash')bad.hash='invalid';else if(mode==='duplicate')bad.objectId='first-part';else if(mode==='index')bad.index=0;else bad.size=2;
  const value={protocol:1,fileKey:hash,size:E2EE_CHUNK_BYTES+1,chunkSize:E2EE_CHUNK_BYTES,filename:'private',mediaType:'application/octet-stream',chunks:[{objectId:'first-part',operationId:'first-operation',index:0,size:E2EE_CHUNK_BYTES,hash},bad]};
  const packet=await sealE2eeEnvelope(root,signingKey,web.context,utf8.encode(JSON.stringify(value)));
  for(const stream of [false,true]){let calls=0,refused=false;const fetchChunk=async()=>{calls++;throw new Error('UNEXPECTED_PRIVATE_IO');};
   try{if(stream)await openE2eeFileStream({root,signer,expectedContext:web.context,manifestEnvelope:packet,fetchChunk,assertCurrent:()=>{},writeQuarantinedPlaintext:async()=>{calls++;}});
    else await openE2eeFile(root,signer,web.context,packet,fetchChunk);}catch(error){refused=(error as Error).message==='E2EE_CORRUPT_FILE';}
   noIo=noIo&&refused&&calls===0;
  }
 }
 check('all six malformed later descriptors refuse before first IO in both readers',noIo);
 const storage=new IndexedDbE2eeStorage(),prefix='file-stream-synthetic:'+crypto.randomUUID()+':',size=9*1024*1024+7;let eof=false,chunks=0,live=true,immutable=true;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},filename=String.fromCharCode(...web.filenameUnits);
 const manifest=await sealE2eeFileStream({root,signingKey,context:web.context,size,metadata:{filename,mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){const bytes=new Uint8Array(65536);let at=0;try{while(at<size){const count=Math.min(bytes.length,size-at);for(let index=0;index<count;index++)bytes[index]=((at+index)*31)&255;yield bytes.subarray(0,count);at+=count;}eof=true;}finally{bytes.fill(0);}})(),
  writeQuarantinedChunk:async chunk=>{immutable=immutable&&Object.isFrozen(chunk)&&Object.isFrozen(chunk.context);await storage.commit([{key:prefix+chunk.context.objectId,expected:null,value:{serial:1,envelope:chunk}}]);chunks++;}});
 check('all37 quarantined chunks are immutable',immutable&&chunks===37);check('actual source EOF precedes the final manifest',eof&&chunks===37);await storage.commit([{key:prefix+'manifest',expected:null,value:{serial:1,envelope:manifest}}]);
 const cold=new IndexedDbE2eeStorage(),saved=await cold.get(prefix+'manifest');if(!saved)throw new Error('SYNTHETIC_MANIFEST_MISSING');
 const opened=await openE2eeFile(root,signer,web.context,saved.envelope,async id=>{const row=await cold.get(prefix+id);if(!row)throw new Error('SYNTHETIC_CHUNK_MISSING');return row.envelope;});
 try{check('new IDB connection opens all original9MiB bytes and filename units',opened.bytes.length===size&&opened.bytes.every((value,index)=>value===(index*31&255))&&opened.filename===filename);}finally{opened.bytes.fill(0);}
 let readBytes=0,readerChunks=0,readValid=true,previous:Uint8Array|undefined;
 const fetchCold=async(id:string)=>{const row=await cold.get(prefix+id);if(!row)throw new Error('SYNTHETIC_CHUNK_MISSING');return row.envelope;};
 const metadata=await openE2eeFileStream({root,signer,expectedContext:web.context,manifestEnvelope:saved.envelope,fetchChunk:fetchCold,assertCurrent:current,writeQuarantinedPlaintext:async bytes=>{
  readValid=readValid&&(!previous||previous.every(value=>value===0))&&bytes.length<=E2EE_CHUNK_BYTES&&bytes.every((value,index)=>value===((readBytes+index)*31&255));readBytes+=bytes.length;readerChunks++;previous=bytes;await Promise.resolve();
 }});
 check('cold IDB bounded reader authenticates all9MiB bytes and37 chunks before metadata receipt',readValid&&readBytes===size&&readerChunks===37&&metadata.size===size&&metadata.filename===filename&&metadata.mediaType===web.mediaType&&Object.isFrozen(metadata));
 check('every borrowed plaintext chunk expires before next fetch and after final sink',!!previous&&previous.every(value=>value===0));
 let readFailures=true;
 for(const mode of ['missing','tamper','space','before','fetch','sink']){
  let active=mode!=='before',fetches=0,writes=0,borrowed:Uint8Array|undefined,receipt=false,refused=false;
  try{await openE2eeFileStream({root,signer,expectedContext:web.context,manifestEnvelope:saved.envelope,assertCurrent:()=>{if(!active)throw new Error('E2EE_ACCOUNT_CHANGED');},
   fetchChunk:async id=>{fetches++;const chunk=await fetchCold(id);if(mode==='fetch')active=false;
    if(fetches===2&&mode==='missing')throw new Error('SYNTHETIC_CHUNK_MISSING');
    if(fetches===2&&mode==='tamper')return{...chunk,ciphertext:(chunk.ciphertext[0]==='A'?'B':'A')+chunk.ciphertext.slice(1)};return chunk;},
   writeQuarantinedPlaintext:async bytes=>{writes++;borrowed=bytes;if(mode==='space')throw new Error('SYNTHETIC_NO_SPACE');if(mode==='sink')active=false;await Promise.resolve();}
  });receipt=true;}catch(error){const expected=mode==='missing'?'SYNTHETIC_CHUNK_MISSING':mode==='tamper'?'E2EE_CORRUPT_FILE':mode==='space'?'SYNTHETIC_NO_SPACE':'E2EE_ACCOUNT_CHANGED';refused=(error as Error).message===expected;}
  readFailures=readFailures&&refused&&!receipt&&(!borrowed||borrowed.every(value=>value===0))&&fetches===(mode==='before'?0:mode==='missing'||mode==='tamper'?2:1)&&writes===(mode==='before'||mode==='fetch'?0:1);
 }
 check('late missing/tampered chunks sink refusal and actor retirement return no complete receipt',readFailures);
 const readOptions:E2eeFileReadStreamOptions={root,signer,expectedContext:structuredClone(web.context),manifestEnvelope:structuredClone(web.manifest),assertCurrent:current,
  fetchChunk:async id=>web.chunks.find((chunk:E2eeEnvelope)=>chunk.context.objectId===id)!,writeQuarantinedPlaintext:async bytes=>{readBytes+=bytes.length;}};
 readBytes=0;const pending=openE2eeFileStream(readOptions);readOptions.expectedContext.ownerId='different-owner';readOptions.manifestEnvelope.nonce='invalid';
 readOptions.fetchChunk=async()=>{throw new Error('REPLACED_FETCH');};readOptions.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};readOptions.writeQuarantinedPlaintext=async()=>{throw new Error('REPLACED_SINK');};
 const captured=await pending;check('reader captures context manifest guard and callbacks before crypto awaits',readBytes===9&&captured.filename===filename);
 const empty=await sealE2eeFileStream({root,signingKey,context:web.context,size:0,metadata:{filename:'empty',mediaType:web.mediaType},assertCurrent:current,source:(async function*(){})(),writeQuarantinedChunk:async()=>{throw new Error('IMPLICIT_EMPTY_CHUNK');}});
 const emptyMetadata=await openE2eeFileStream({root,signer,expectedContext:web.context,manifestEnvelope:empty,assertCurrent:current,fetchChunk:async()=>{throw new Error('IMPLICIT_EMPTY_FETCH');},writeQuarantinedPlaintext:async()=>{throw new Error('IMPLICIT_EMPTY_SINK');}});
 check('authenticated empty file returns metadata without a chunk or sink call',emptyMetadata.size===0&&emptyMetadata.filename==='empty');
 let failed=false,prefixes=0;try{await sealE2eeFileStream({root,signingKey,context:web.context,size:E2EE_CHUNK_BYTES,metadata:{filename:'failed',mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){yield new Uint8Array(E2EE_CHUNK_BYTES).fill(17);throw new Error('SYNTHETIC_FINAL_TAG_FAILURE');})(),writeQuarantinedChunk:async()=>{prefixes++;}});}catch(error){failed=(error as Error).message==='SYNTHETIC_FINAL_TAG_FAILURE';}
 check('declared byte count cannot suppress final tag failure',failed&&prefixes===1);
 const borrowed=new Uint8Array(E2EE_CHUNK_BYTES).fill(23);let closed=false;failed=false;
 try{await sealE2eeFileStream({root,signingKey,context:web.context,size:borrowed.length,metadata:{filename:'retired',mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){try{yield borrowed;}finally{borrowed.fill(0);closed=true;}})(),writeQuarantinedChunk:async()=>{live=false;}});}catch(error){failed=(error as Error).message==='E2EE_ACCOUNT_CHANGED';}
 check('retirement returns no manifest and closes/wipes borrowed source',failed&&closed&&borrowed.every(value=>value===0));
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS file stream';
