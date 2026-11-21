import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,commandBytes,snapshotE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {exactKeys} from './keys.ts';
import type {RemoteOriginalRegistration} from './remote-original.ts';
import type {SourceStageTarget} from './source-stage.ts';

type OriginalPacket=Readonly<{registration:RemoteOriginalRegistration;packet:SignedE2eeCommand}>;
export type OwnedRemoteOriginal=OriginalPacket&Readonly<{completion:import('./remote-original.ts').RemoteOriginalReference|null}>;
type OwnershipBase=Readonly<{attemptId:string;sourceState:Readonly<{objectId:string;hash:string;originalSerial:number}>;signer:string;securityEpoch:number}>;
export type StreamedPlanningOwnership=OwnershipBase&({protocol:1;originals:readonly OriginalPacket[]}|{protocol:2;originals:readonly OwnedRemoteOriginal[]});
type Expected={migrationId:string;target:SourceStageTarget;actor:{ownerId:string;scopeId:string;deviceId:string};sourceHash:string|null;
 lease:{fence:number;generation:number;leaseUntil:number}|null;checkpointHash:string;directoryRevision:number};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const actions=new Set(['legacy-workspace','legacy-aurora','legacy-stoicheion','legacy-advice','legacy-tasks','legacy-diary','legacy-mindmaps','legacy-physis','legacy-reminders','legacy-archives']);
function invalid():never{throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');}
function positive(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<1)invalid();}
function fields(value:unknown,expected:Record<string,unknown>){exactKeys(value,Object.keys(expected));for(const key of Object.keys(expected))if(value[key]!==expected[key])invalid();}

/** Local state4 ownership only. Each saved packet is inert original material,
 * never a replay grant, body proof, content plan or activation receipt. */
export function validateStreamedPlanningOwnership(source:unknown,expected:Expected):StreamedPlanningOwnership{
 const value=snapshotE2eeValue(source);exactKeys(value,['protocol','attemptId','sourceState','signer','securityEpoch','originals']);
 if(![1,2].includes(value.protocol as number)||typeof value.attemptId!=='string'||!uuid.test(value.attemptId)||!uuid.test(expected.migrationId))invalid();
 exactKeys(value.sourceState,['objectId','hash','originalSerial']);
 if(value.sourceState.objectId!==`${expected.migrationId}:preparation:3`)invalid();
 decodeE2eeBytes(value.sourceState.hash,32);positive(value.sourceState.originalSerial);decodeE2eeBytes(value.signer,91);positive(value.securityEpoch);
 positive(expected.directoryRevision);decodeE2eeBytes(expected.checkpointHash,32);
 if(expected.sourceHash!==null)decodeE2eeBytes(expected.sourceHash,32);
 if(expected.lease){exactKeys(expected.lease,['fence','generation','leaseUntil']);Object.values(expected.lease).forEach(positive);if(expected.sourceHash===null)invalid();}
 if(!Array.isArray(value.originals)||value.originals.length>1000||value.originals.length&&(!expected.lease||expected.sourceHash===null))invalid();
 const seen=new Set<string>();
 for(const original of value.originals){
  exactKeys(original,['registration','packet',...(value.protocol===2?['completion']:[])]);const reg=original.registration;
  exactKeys(reg,['protocol','purpose','id','context','binding']);
  if(reg.protocol!==1||reg.purpose!=='remote-original/v1'||typeof reg.id!=='string'||!uuid.test(reg.id)||seen.has(reg.id))invalid();seen.add(reg.id);
  fields(reg.context,{ownerId:expected.target.ownerId,scopeId:expected.target.scopeId,kind:expected.target.kind,actorId:expected.actor.ownerId,actorScopeId:expected.actor.scopeId,deviceId:expected.actor.deviceId});
  if(value.protocol===2&&original.completion!==null){
   const ref=original.completion;exactKeys(ref,['id','manifestHash','rawHash','size']);
   if(ref.id!==reg.id||!Number.isSafeInteger(ref.size)||(ref.size as number)<0||(ref.size as number)>128*1024*1024)invalid();
   decodeE2eeBytes(ref.manifestHash,32);decodeE2eeBytes(ref.rawHash,32);
  }
  const binding=reg.binding;exactKeys(binding,['packetHash','signer','generation','migrationId','fence','sourceHash','action','directoryRevision','checkpointHash','securityEpoch']);
  if(binding.signer!==value.signer||binding.generation!==expected.lease!.generation||binding.migrationId!==expected.migrationId||binding.sourceHash!==expected.sourceHash
   ||binding.directoryRevision!==expected.directoryRevision||binding.checkpointHash!==expected.checkpointHash||binding.securityEpoch!==value.securityEpoch
   ||typeof binding.action!=='string'||!actions.has(binding.action))invalid();
  positive(binding.fence);if(binding.fence>expected.lease!.fence)invalid();decodeE2eeBytes(binding.packetHash,32);
  exactKeys(original.packet,['command','signature']);const packet=original.packet as SignedE2eeCommand,command=packet.command;
  commandBytes(command).fill(0);decodeE2eeBytes(packet.signature,64);
  if(command.ownerId!==expected.target.ownerId||command.scopeId!==expected.target.scopeId||command.deviceId!==expected.actor.deviceId||command.action!==binding.action
   ||command.expectedRevision!==binding.directoryRevision||command.checkpointHash!==binding.checkpointHash||command.securityEpoch!==binding.securityEpoch
   ||command.payload.migrationId!==binding.migrationId||command.payload.fence!==binding.fence||command.payload.sourceHash!==binding.sourceHash)invalid();
  const bytes=canonicalE2eeValue(packet as unknown as WireValue);
  try{if(bytes.length>128*1024||encodeE2eeBytes(sha256(bytes))!==binding.packetHash)invalid();}finally{bytes.fill(0);}
 }
 return value as unknown as StreamedPlanningOwnership;
}
