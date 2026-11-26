import {canonicalE2eeValue,e2eeCommandHash,verifyE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {exactKeys} from './keys.ts';
import {signingPublicKey} from './directory.ts';
import type {MigrationState} from './migration.ts';
import type {RetainedMigrationFrame} from './retained-migration-proof.ts';

export type MigrationStartCancellation={packet:SignedE2eeCommand;result:Record<string,WireValue>|null};
function invalid():never{throw new Error('E2EE_MIGRATION_CANCELLATION_PENDING');}
function equal(a:unknown,b:unknown){const left=canonicalE2eeValue(a as WireValue),right=canonicalE2eeValue(b as WireValue);try{return left.length===right.length&&left.every((byte,at)=>byte===right[at]);}finally{left.fill(0);right.fill(0);}}
function unplanned(state:MigrationState){return [1,2,4].includes(state.protocol)&&state.lease===null&&state.resuming===null
 &&state.plan.length===0&&state.logical.length===0&&(state.local?.length??0)===0&&!state.planned&&state.uploaded===0
 &&state.manifestHash===null&&state.verifiedCheckpoint===null&&['preparing','uploading','cancelled'].includes(state.phase);}
/** Narrow custody classification of an unresolved old start, not cancellation
 * proof or permission to restart. Its full signed packet remains mandatory. */
export function unresolvedMigrationStart(state:MigrationState){
 return unplanned(state)&&state.pending?.command.action==='migration-start'&&state.sourceHash!==null
  &&state.pending.command.payload.migrationId===state.migrationId&&state.pending.command.payload.sourceHash===state.sourceHash;
}
export function validateMigrationStartCancellationShape(state:MigrationState){
 const saved=state.startCancellation;if(saved===undefined)return;
 exactKeys(saved,['packet','result']);if(!unplanned(state)||state.sourceHash===null)invalid();
 const outer=saved.packet?.command,original=outer?.payload.original as unknown as SignedE2eeCommand;
 if(outer?.action!=='migration-cancel-start'||!original?.command||original.command.action!=='migration-start')invalid();
 exactKeys(outer.payload,['original']);exactKeys(original.command.payload,['migrationId','sourceHash']);
 if(original.command.payload.migrationId!==state.migrationId||original.command.payload.sourceHash!==state.sourceHash)invalid();
 if(saved.result===null){if(!unresolvedMigrationStart(state)||!equal(state.pending,original))invalid();}
 else{
  exactKeys(saved.result,['migrationId','sourceHash','startOperationId','startHash','outcome']);decodeE2eeBytes(saved.result.startHash,32);
  if(state.phase!=='cancelled'||state.pending!==null||saved.result.migrationId!==state.migrationId||saved.result.sourceHash!==state.sourceHash
   ||saved.result.startOperationId!==original.command.operationId||!['not-started','cancelled','superseded'].includes(saved.result.outcome as string))invalid();
 }
}
export async function authenticateMigrationStartCancellation(state:MigrationState,frame:RetainedMigrationFrame,deviceId:string,current:()=>void){
 validateMigrationStartCancellationShape(state);const saved=state.startCancellation;if(!saved)return false;
 const own=frame.own;if(!own||own.revoked||own.deviceId!==deviceId||own.role!=='owner')invalid();
 const signer=await signingPublicKey(own.signingKey);current();
 const original=saved.packet.command.payload.original as unknown as SignedE2eeCommand;
 const outer=await verifyE2eeCommand(saved.packet,signer);current();const start=await verifyE2eeCommand(original,signer);current();
 for(const command of [outer,start]){
  if(command.ownerId!==frame.ownerId||command.scopeId!==frame.scopeId||command.deviceId!==deviceId||command.expectedRevision!==frame.checkpoint.revision
   ||command.checkpointHash!==frame.checkpoint.hash||command.securityEpoch!==frame.securityEpoch)invalid();
 }
 if(outer.operationId===start.operationId)invalid();
 if(saved.result!==null&&saved.result.startHash!==await e2eeCommandHash(start))invalid();current();return saved.result!==null;
}
