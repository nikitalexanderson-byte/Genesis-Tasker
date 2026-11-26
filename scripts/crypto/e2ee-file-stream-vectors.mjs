// PUBLIC synthetic keys and opaque bytes. Never use this fixture for real data.
import {readFileSync,writeFileSync} from 'node:fs';
import {sealE2eeFileStream} from '../../app/e2ee/files.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
const output=process.argv[2];if(!output)throw new Error('Supply a fresh synthetic output path');
const original=JSON.parse(readFileSync(new URL('../../tests/fixtures/e2ee/v1.json',import.meta.url),'utf8'));
const root=await importE2eeRoot(decodeE2eeBytes(original.rootKey,32));
const signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(original.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const plaintext=Uint8Array.of(0,255,216,0,34,92,13,10,254),filename='\ufefforiginal\ud800😀.bin',mediaType='application/octet-stream',chunks=[];
const manifest=await sealE2eeFileStream({root,signingKey,context:original.envelope.context,size:plaintext.length,metadata:{filename,mediaType},source:(async function*(){yield plaintext.subarray(0,3);yield plaintext.subarray(3);})(),assertCurrent:()=>{},writeQuarantinedChunk:async chunk=>{chunks.push(chunk);}});
const fixture={synthetic:true,warning:'PUBLIC TEST KEYS; DO NOT USE FOR USER DATA',producer:'Node WebCrypto streaming file writer',rootKey:original.rootKey,publicKeySpki:original.publicKeySpki,
 context:original.envelope.context,manifest,chunks,plaintext:encodeE2eeBytes(plaintext),filenameUnits:Array.from({length:filename.length},(_,index)=>filename.charCodeAt(index)),mediaType};
writeFileSync(output,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});plaintext.fill(0);console.log(JSON.stringify({synthetic:true,chunks:chunks.length,output}));
