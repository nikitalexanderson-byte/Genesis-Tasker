// Browser-only synthetic contract checks. The server exposes this module only on loopback.
import { importE2eeRoot, e2eeAdditionalData, encodeE2eeBytes, decodeE2eeBytes,
  sealE2eeEnvelope, openE2eeEnvelope, validateE2eeEnvelope } from '/envelope.js';

const result={runtime:navigator.userAgent,secureContext:isSecureContext,synthetic:true,checks:[]};
const check=(name,passed)=>{result.checks.push({name,status:passed?'PASS':'FAIL'});if(!passed)throw new Error(name);};
try{
  const fixture=await(await fetch('/fixture.json')).json();
  const bytes=value=>decodeE2eeBytes(value,1,8192), context=fixture.envelope.context;
  const root=await importE2eeRoot(bytes(fixture.rootKey));
  const peer=await crypto.subtle.importKey('spki',bytes(fixture.publicKeySpki),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const signer=await crypto.subtle.importKey('pkcs8',bytes(fixture.privateKeyPkcs8),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  check('native Web Crypto secure context',isSecureContext&&!!crypto.subtle);
  check('canonical AAD equals independent vector',encodeE2eeBytes(e2eeAdditionalData(context))===fixture.aad);
  const plaintext=await openE2eeEnvelope(root,peer,context,fixture.envelope);
  check('Node/RFC3394 ciphertext opens in browser',encodeE2eeBytes(plaintext)===fixture.plaintext);
  const sealed=await sealE2eeEnvelope(root,signer,context,plaintext);
  check('browser sign/seal/open',encodeE2eeBytes(await openE2eeEnvelope(root,peer,context,sealed))===fixture.plaintext);
  const another=await sealE2eeEnvelope(root,signer,context,plaintext);
  check('fresh DEK and nonce',sealed.wrappedKey!==another.wrappedKey&&sealed.nonce!==another.nonce);
  const expectRejection=async(name,code,operation)=>{
    let rejected=false;try{await operation();}catch(error){rejected=error.message===code;}
    check(name,rejected);
  };
  const changed=structuredClone(sealed);const cipher=decodeE2eeBytes(changed.ciphertext,16,4194320);cipher[0]^=1;
  changed.ciphertext=encodeE2eeBytes(cipher);
  await expectRejection('ciphertext tamper','E2EE_CORRUPT_ENVELOPE',()=>openE2eeEnvelope(root,peer,context,changed));
  await expectRejection('expected owner binding','E2EE_CONTEXT_MISMATCH',()=>openE2eeEnvelope(root,peer,{...context,ownerId:'other-owner'},sealed));
  const wrong=await importE2eeRoot(new Uint8Array(32).fill(111));
  await expectRejection('wrong root, no empty fallback','E2EE_CORRUPT_ENVELOPE',()=>openE2eeEnvelope(wrong,peer,context,sealed));
  await expectRejection('unknown fields rejected','E2EE_INVALID_ENVELOPE',()=>validateE2eeEnvelope({...sealed,key:'forbidden'}));
  check('no raw root or plaintext in serialized envelope',!JSON.stringify(sealed).includes(fixture.rootKey)&&
    !JSON.stringify(sealed).includes(new TextDecoder().decode(plaintext)));
  const jcaResponse=await fetch('/jca.json');
  if(jcaResponse.ok){
    const jca=await jcaResponse.json();
    check('JCA sealed ciphertext opens in browser',encodeE2eeBytes(await openE2eeEnvelope(root,peer,context,jca.envelope))===fixture.plaintext);
  }else result.checks.push({name:'JCA sealed ciphertext opens in browser',status:'BLOCKED'});
}catch(error){result.error=String(error.message).slice(0,160);}
result.summary=Object.fromEntries(['PASS','FAIL','BLOCKED'].map(status=>[status,result.checks.filter(row=>row.status===status).length]));
result.status=!result.error&&result.summary.FAIL===0&&result.summary.BLOCKED===0?'PASS':'FAIL';
document.querySelector('#result').textContent=JSON.stringify(result,null,2);
document.title=`${result.status} GENESIS E2EE synthetic contract`;
