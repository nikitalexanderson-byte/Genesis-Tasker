import {canonicalE2eeValue,snapshotE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys,type PublicDeviceKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {signingPublicKey} from './directory.ts';

export type DeviceAccessTarget={ownerId:string;scopeId:string;kind:'personal'|'space'|'project';resourceId:string;authority:PublicDeviceKeys};
export type DeviceAccessChallenge={id:string;scopeId:string;userId:string;role:'owner'|'writer'|'commenter'|'reader';sessionHash:string;deviceId:string;signingKey:string;receivingKey:string;nonce:string;expiresAt:number};
export type DeviceAccessRequest={format:'genesis-device-access-request-v1';target:DeviceAccessTarget;challenge:DeviceAccessChallenge;selfProof:string};
const invalid=():never=>{throw new Error('E2EE_DEVICE_ACCESS_INVALID');};
export function validateDeviceAccessTarget(value:unknown):DeviceAccessTarget{
 exactKeys(value,['ownerId','scopeId','kind','resourceId','authority']);for(const field of ['ownerId','scopeId','resourceId'])assertTechnical(value[field]);
 if(!['personal','space','project'].includes(String(value.kind))||value.kind==='personal'&&value.ownerId!==value.resourceId)invalid();
 exactKeys(value.authority,['signingKey','receivingKey']);decodeE2eeBytes(value.authority.signingKey,91);decodeE2eeBytes(value.authority.receivingKey,65);return snapshotE2eeValue(value) as DeviceAccessTarget;
}
export function validateDeviceAccessChallenge(value:unknown,target:DeviceAccessTarget):DeviceAccessChallenge{
 exactKeys(value,['id','scopeId','userId','role','sessionHash','deviceId','signingKey','receivingKey','nonce','expiresAt']);
 for(const field of ['id','scopeId','userId','deviceId'])assertTechnical(value[field]);
 if(value.scopeId!==target.scopeId||value.deviceId==='recovery'||!['owner','writer','commenter','reader'].includes(String(value.role))
  ||(value.role==='owner')!==(value.userId===target.ownerId)||target.kind==='personal'&&value.userId!==target.ownerId
  ||typeof value.sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(value.sessionHash)||typeof value.nonce!=='string'||!/^[a-f0-9]{64}$/.test(value.nonce)
  ||!Number.isSafeInteger(value.expiresAt)||Number(value.expiresAt)<1)invalid();
 decodeE2eeBytes(value.signingKey,91);decodeE2eeBytes(value.receivingKey,65);return snapshotE2eeValue(value) as DeviceAccessChallenge;
}
export function validateDeviceAccessRequest(value:unknown):DeviceAccessRequest{
 exactKeys(value,['format','target','challenge','selfProof']);if(value.format!=='genesis-device-access-request-v1')invalid();
 const target=validateDeviceAccessTarget(value.target);validateDeviceAccessChallenge(value.challenge,target);decodeE2eeBytes(value.selfProof,64);return snapshotE2eeValue(value) as DeviceAccessRequest;
}
export function deviceAccessProofBytes(challenge:DeviceAccessChallenge){const prefix=new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge as unknown as WireValue),bytes=new Uint8Array(prefix.length+body.length);bytes.set(prefix);bytes.set(body,prefix.length);body.fill(0);return bytes;}
export async function verifyDeviceAccessRequest(value:unknown){const request=validateDeviceAccessRequest(value),bytes=deviceAccessProofBytes(request.challenge);
 try{if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await signingPublicKey(request.challenge.signingKey),decodeE2eeBytes(request.selfProof,64),bytes))invalid();return request;}finally{bytes.fill(0);}}
export async function deviceAccessFingerprint(value:DeviceAccessRequest){const request=validateDeviceAccessRequest(value),bytes=canonicalE2eeValue(request as unknown as WireValue);try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}finally{bytes.fill(0);}}
