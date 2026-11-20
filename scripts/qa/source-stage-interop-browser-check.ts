import {IndexedDbE2eeStorage,UnlockedE2eeVault,type VaultScope,type SealedLocalRecord} from '../../app/e2ee/storage.ts';
import {openSourceStage,inspectSourceStages,type SourceStageReference,type SourceStageTarget} from '../../app/e2ee/source-stage.ts';
import {decodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';

type PublicVector={synthetic:boolean;warning:string;producer:string;rootKey:string;privateKeyPkcs8:string;publicKeySpki:string;
 scope:Omit<VaultScope,'signingKey'|'roots'|'trustedSigner'>;target:SourceStageTarget;reference:SourceStageReference;historyStages:number;
 records:(SealedLocalRecord&{key:string})[];expectedPaths:{id:string;bytes:string}[]};
/** Public synthetic JCA fixture only. Same signed-AEAD checks as product read;
 * key custody and a complete recovery/product lifecycle are not inferred. */
export async function checkNativeSourceStageVector(fixture:PublicVector){
 if(fixture.synthetic!==true||fixture.warning!=='PUBLIC TEST KEYS; DO NOT USE FOR USER DATA'||fixture.records.length>128)throw new Error('SYNTHETIC_VECTOR_REQUIRED');
 const storage=new IndexedDbE2eeStorage();await storage.commit(fixture.records.map(row=>({key:row.key,expected:null,value:{serial:row.serial,envelope:row.envelope}})));
 const privateBytes=decodeE2eeBytes(fixture.privateKeyPkcs8,1,8192),publicBytes=decodeE2eeBytes(fixture.publicKeySpki,1,8192),rootBytes=decodeE2eeBytes(fixture.rootKey,32);
 let vault:UnlockedE2eeVault|undefined;
 try{
  const signingKey=await crypto.subtle.importKey('pkcs8',privateBytes,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const publicKey=await crypto.subtle.importKey('spki',publicBytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']),root=await importE2eeRoot(rootBytes);
  vault=new UnlockedE2eeVault(storage,{...fixture.scope,signingKey,roots:new Map([[fixture.scope.keyId,root]]),trustedSigner:id=>id===fixture.scope.deviceId?publicKey:undefined});
  const current=()=>vault!.assertUnlocked(),history=await inspectSourceStages(vault,fixture.target,current);
  if(history.length!==fixture.historyStages)throw new Error('SYNTHETIC_VECTOR_HISTORY');
  const opened=await openSourceStage(vault,fixture.target,fixture.reference,current);let bytes=0;
  if(JSON.stringify(opened.paths)!==JSON.stringify(fixture.expectedPaths.map(row=>row.id)))throw new Error('SYNTHETIC_VECTOR_PATHS');
  for(const row of fixture.expectedPaths){
   const expected=decodeE2eeBytes(row.bytes,1,1024*1024),reader=opened.openPath(row.id);let at=0;
   try{for await(const chunk of reader.chunks){if(at+chunk.length>expected.length||chunk.some((value,index)=>value!==expected[at+index]))throw new Error('SYNTHETIC_VECTOR_BYTES');at+=chunk.length;}
    reader.assertComplete();if(at!==expected.length)throw new Error('SYNTHETIC_VECTOR_EOF');bytes+=at;
   }finally{expected.fill(0);}
  }
  return{producer:fixture.producer,paths:opened.paths.length,bytes};
 }finally{vault?.lock();privateBytes.fill(0);publicBytes.fill(0);rootBytes.fill(0);}
}
