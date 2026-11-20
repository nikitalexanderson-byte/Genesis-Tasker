import {sealE2eeFileStream,openE2eeFile,E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';
import {decodeE2eeBytes,importE2eeRoot,type E2eeContext,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
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
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const [web,native,keys]=await Promise.all(['/web.json','/native.json','/keys.json'].map(async path=>{const response=await fetch(path);if(!response.ok)throw new Error('SYNTHETIC_FIXTURE_UNAVAILABLE');return response.json();}));
 check('public web stream vector opens with all filename units',await readVector(web));check('actual JCA stream vector opens in the existing browser v1 reader',await readVector(native));
 const root=await importE2eeRoot(decodeE2eeBytes(keys.rootKey,32)),signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(keys.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(keys.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const storage=new IndexedDbE2eeStorage(),prefix='file-stream-synthetic:'+crypto.randomUUID()+':',size=9*1024*1024+7;let eof=false,chunks=0,live=true,immutable=true;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},filename=String.fromCharCode(...web.filenameUnits);
 const manifest=await sealE2eeFileStream({root,signingKey,context:web.context,size,metadata:{filename,mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){const bytes=new Uint8Array(65536);let at=0;try{while(at<size){const count=Math.min(bytes.length,size-at);for(let index=0;index<count;index++)bytes[index]=((at+index)*31)&255;yield bytes.subarray(0,count);at+=count;}eof=true;}finally{bytes.fill(0);}})(),
  writeQuarantinedChunk:async chunk=>{immutable=immutable&&Object.isFrozen(chunk)&&Object.isFrozen(chunk.context);await storage.commit([{key:prefix+chunk.context.objectId,expected:null,value:{serial:1,envelope:chunk}}]);chunks++;}});
 check('all37 quarantined chunks are immutable',immutable&&chunks===37);check('actual source EOF precedes the final manifest',eof&&chunks===37);await storage.commit([{key:prefix+'manifest',expected:null,value:{serial:1,envelope:manifest}}]);
 const cold=new IndexedDbE2eeStorage(),saved=await cold.get(prefix+'manifest');if(!saved)throw new Error('SYNTHETIC_MANIFEST_MISSING');
 const opened=await openE2eeFile(root,signer,web.context,saved.envelope,async id=>{const row=await cold.get(prefix+id);if(!row)throw new Error('SYNTHETIC_CHUNK_MISSING');return row.envelope;});
 try{check('new IDB connection opens all original9MiB bytes and filename units',opened.bytes.length===size&&opened.bytes.every((value,index)=>value===(index*31&255))&&opened.filename===filename);}finally{opened.bytes.fill(0);}
 let failed=false,prefixes=0;try{await sealE2eeFileStream({root,signingKey,context:web.context,size:E2EE_CHUNK_BYTES,metadata:{filename:'failed',mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){yield new Uint8Array(E2EE_CHUNK_BYTES).fill(17);throw new Error('SYNTHETIC_FINAL_TAG_FAILURE');})(),writeQuarantinedChunk:async()=>{prefixes++;}});}catch(error){failed=(error as Error).message==='SYNTHETIC_FINAL_TAG_FAILURE';}
 check('declared byte count cannot suppress final tag failure',failed&&prefixes===1);
 const borrowed=new Uint8Array(E2EE_CHUNK_BYTES).fill(23);let closed=false;failed=false;
 try{await sealE2eeFileStream({root,signingKey,context:web.context,size:borrowed.length,metadata:{filename:'retired',mediaType:web.mediaType},assertCurrent:current,
  source:(async function*(){try{yield borrowed;}finally{borrowed.fill(0);closed=true;}})(),writeQuarantinedChunk:async()=>{live=false;}});}catch(error){failed=(error as Error).message==='E2EE_ACCOUNT_CHANGED';}
 check('retirement returns no manifest and closes/wipes borrowed source',failed&&closed&&borrowed.every(value=>value===0));
}catch(error){report.error=(error as Error).message.slice(0,180);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS file stream';
