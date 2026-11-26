// PUBLIC synthetic recovery material only. Never reads an account or real vault.
import {writeFileSync} from 'node:fs';
import {UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {createRecoveryKit,freshSecret,generateDeviceKeys,publicDeviceKeys} from '../../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {sealOriginalCustody} from '../../app/e2ee/original-custody.ts';
import {ProtectedSourceStage} from '../../app/e2ee/source-stage.ts';
class Records {
 rows=new Map();async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes){for(const row of changes){if((this.rows.get(row.key)?.serial??null)!==row.expected)throw new Error('CAS');this.rows.set(row.key,structuredClone(row.value));}}
}
const owner='public-custody-vector',recovery=await createRecoveryKit(owner),keys=await generateDeviceKeys(),root=freshSecret(),storage=new Records(),id='public-original-device';
const original={ownerId:owner,scopeId:`device:${id}`,deviceId:id,generation:1,cryptoEpoch:1,securityEpoch:1},keyId=`local:${id}`;
const vault=new UnlockedE2eeVault(storage,{...original,keyId,signingKey:keys.signing.privateKey,roots:new Map([[keyId,await importE2eeRoot(root)]]),trustedSigner:signer=>signer===id?keys.signing.publicKey:undefined});
const target={ownerId:'public-project-owner',scopeId:'project:public-custody',kind:'project'},current=()=>{};
const stage=await ProtectedSourceStage.create({vault,target,paths:['project.content'],capacity:{maximumBytes:1048576,maximumParts:8},assertCurrent:current,ensureDurableKeys:async()=>{},admit:async()=>{}});
await stage.capturePath('project.content',write=>write(Uint8Array.of(1,7,255)));const stageReference=await stage.finish();
const sealed=await sealOriginalCustody({original,keyId,signer:(await publicDeviceKeys(keys)).signingKey,root,primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,secret:recovery.secret,assertCurrent:current});
const vector={synthetic:true,warning:'PUBLIC TEST RECOVERY MATERIAL; NEVER USE FOR USER DATA',producer:'WebCrypto original custody v1',ownerId:owner,primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,
 secret:encodeE2eeBytes(recovery.secret),...sealed,target,stageReference,paths:[{id:'project.content',plaintext:encodeE2eeBytes(Uint8Array.of(1,7,255))}],records:[...storage.rows].map(([key,value])=>({key,...value}))};
vault.lock();root.fill(0);recovery.secret.fill(0);
writeFileSync(new URL('../../tests/fixtures/e2ee/original-custody-web-v1.json',import.meta.url),JSON.stringify(vector,null,2)+'\n');
console.log(JSON.stringify({status:'PUBLIC_SYNTHETIC_VECTOR_WRITTEN',records:vector.records.length,oldPrivateDeviceKeysExported:false}));
