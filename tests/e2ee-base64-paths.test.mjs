import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeE2eeBytes,encodeE2eeBytes} from '../app/e2ee/envelope.ts';

function vectors(){return Array.from({length:260},(_,index)=>Uint8Array.from({length:index+1},(_,at)=>(index*19+at*37)&255));}
function verify(){
 for(const bytes of vectors()){
  const encoded=Buffer.from(bytes).toString('base64url');assert.equal(encodeE2eeBytes(bytes),encoded);assert.deepEqual(decodeE2eeBytes(encoded,bytes.length),bytes);
  assert.throws(()=>decodeE2eeBytes(encoded,bytes.length+1),/E2EE_/);
 }
 // Every nonzero unused tail bit is forbidden, even in a permissive native
 // decoder. Whitespace, padding and the standard base64 alphabet also refuse.
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 for(let tail=1;tail<64;tail++){
  if(tail&15)assert.throws(()=>decodeE2eeBytes('A'+alphabet[tail],1),/E2EE_/);
  if(tail&3)assert.throws(()=>decodeE2eeBytes('AA'+alphabet[tail],2),/E2EE_/);
 }
 for(const value of ['A','AAAAA','AA==','A A','AA\n','AA+','AA/','éA','💠A'])assert.throws(()=>decodeE2eeBytes(value,1,16),/E2EE_/);
}
test('native base64url paths retain exact protocol bytes and canonical refusals',verify);
test('older WebView fallback has the identical bytes and refusal rules',()=>{
 const decode=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64'),encode=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toBase64');
 try{
  Object.defineProperty(Uint8Array,'fromBase64',{value:undefined,configurable:true});Object.defineProperty(Uint8Array.prototype,'toBase64',{value:undefined,configurable:true});verify();
 }finally{
  if(decode)Object.defineProperty(Uint8Array,'fromBase64',decode);else delete Uint8Array.fromBase64;
  if(encode)Object.defineProperty(Uint8Array.prototype,'toBase64',encode);else delete Uint8Array.prototype.toBase64;
 }
});
