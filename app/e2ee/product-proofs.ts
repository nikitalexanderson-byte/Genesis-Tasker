import {assertTechnical,exactKeys} from './keys.ts';
import {productEntity,productMutation,productMetadata,type ProductEntity,type ProductMutation} from './product-contract.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {samePrivateJson} from './product-json.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {SignedE2eeCommand,E2eeCommand,WireValue} from './commands.ts';

export type VerifiedProductProposal={proposalId:string;entityId:string;baseRevision:number;operation:ProductMutation;actorId:string;createdAt:string;approvals?:{userId:string;createdAt:string}[]};
export type VerifiedProductOrigin={entityId:string;revision:number;actorId:string;bootstrap:boolean;action:string;operationId:string};
type Proof={command:E2eeCommand;actorId:string;proofHash:string};
const invalid=():never=>{throw new Error('E2EE_PRODUCT_PROOF_INVALID');};
/** The index is an untrusted server projection. Active heads and completion
 * approvals are accepted only when their exact references are covered by signed
 * business intents from the pinned directory at that historical checkpoint. */
export async function verifyProductPage(input:unknown,verify:(packet:SignedE2eeCommand)=>Promise<Proof>){
 exactKeys(input,['entities','heads','proofs','proposals','attestations','bootstrapProofHash','checkpointHash','directoryRevision']);decodeE2eeBytes(input.bootstrapProofHash,32);
 for(const key of ['entities','heads','proofs','proposals','attestations'] as const)if(!Array.isArray(input[key])||input[key].length>(key==='entities'||key==='heads'?50:10000))invalid();
 const entities=(input.entities as unknown[]).map(productEntity),heads=input.heads as unknown[],rawProofs=input.proofs as unknown[],proposals=input.proposals as unknown[],attestations=input.attestations as unknown[];
 if(new Set(entities.map(row=>row.entityId)).size!==entities.length||heads.length!==entities.length)invalid();
 const proofs=new Map<string,Proof>();for(const row of rawProofs){exactKeys(row,['proofHash','packet']);decodeE2eeBytes(row.proofHash,32);if(typeof row.packet!=='string'||row.packet.length>4*1024*1024||proofs.has(row.proofHash as string))invalid();
  const packet=parseLegacyMigrationJson(row.packet,'E2EE_PRODUCT_PROOF_INVALID',4*1024*1024) as SignedE2eeCommand,proof=await verify(packet);if(proof.proofHash!==row.proofHash)invalid();proofs.set(proof.proofHash,proof);
   const command=proof.command;if(command.action==='product-commit'||command.action==='product-commit-bound'){exactKeys(command.payload,['intentId','operations',...(command.action==='product-commit-bound'?['membershipHash']:[])]);if(command.action==='product-commit-bound')decodeE2eeBytes(command.payload.membershipHash,32);assertTechnical(command.payload.intentId);if(!Array.isArray(command.payload.operations)||command.payload.operations.length<1||command.payload.operations.length>100)invalid();
   const ops=command.payload.operations.map(productMutation);if(new Set(ops.map(row=>row.entityId)).size!==ops.length)invalid();
  }else if(command.action==='product-approve'){exactKeys(command.payload,['intentId','proposalId','entityId','baseRevision','payloadHash']);for(const key of ['intentId','proposalId','entityId'] as const)assertTechnical(command.payload[key]);decodeE2eeBytes(command.payload.payloadHash,32);
   if(!Number.isSafeInteger(command.payload.baseRevision)||Number(command.payload.baseRevision)<1)invalid();
  }else if(command.action==='product-bootstrap-stage'){
   exactKeys(command.payload,['intentId','bootstrapId','partIndex','items']);assertTechnical(command.payload.intentId);assertTechnical(command.payload.bootstrapId);
   if(!Number.isSafeInteger(command.payload.partIndex)||Number(command.payload.partIndex)<0||Number(command.payload.partIndex)>4095||!Array.isArray(command.payload.items)||command.payload.items.length<1||command.payload.items.length>100)invalid();
   const seen=new Set<string>();for(const item of command.payload.items){exactKeys(item,['operation','authorId']);assertTechnical(item.authorId);const operation=productMutation(item.operation);if(!['create','delete'].includes(operation.action)||operation.expectedRevision!==0||seen.has(operation.entityId))invalid();seen.add(operation.entityId);}
  }else if(command.action==='product-bootstrap-complete'){
   exactKeys(command.payload,['intentId','bootstrapId','parts','expectedCount']);assertTechnical(command.payload.intentId);assertTechnical(command.payload.bootstrapId);
   if(!Number.isSafeInteger(command.payload.expectedCount)||Number(command.payload.expectedCount)<1||Number(command.payload.expectedCount)>100000||!Array.isArray(command.payload.parts)||command.payload.parts.length<1||command.payload.parts.length>4096)invalid();
   for(const [index,part]of command.payload.parts.entries()){exactKeys(part,['partIndex','proofHash']);if(part.partIndex!==index)invalid();decodeE2eeBytes(part.proofHash,32);}
  }else invalid();
 }
 const baseline=proofs.get(input.bootstrapProofHash as string);if(!baseline||baseline.command.action!=='product-bootstrap-complete')invalid();
 const reviewed=new Map<string,VerifiedProductProposal>();for(const row of proposals){exactKeys(row,['proposalId','entityId','baseRevision','objectId','payloadHash','metadataJson','actorId','createdAt','proofHash']);
  for(const key of ['proposalId','entityId','objectId','actorId','proofHash'] as const)assertTechnical(row[key]);if(reviewed.has(row.proposalId as string)||typeof row.metadataJson!=='string'||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))invalid();
  const proof=proofs.get(row.proofHash as string),entity=entities.find(entity=>entity.entityId===row.entityId);if(!proof||proof.command.action!=='product-commit'||proof.actorId!==row.actorId||!entity||entity.kind!=='task')invalid();
  const operation=(proof.command.payload.operations as WireValue[]).map(productMutation).find(operation=>operation.entityId===row.entityId&&operation.proposalId===row.proposalId);
  if(!operation||operation.action!=='propose-complete'||operation.expectedRevision!==row.baseRevision||operation.objectId!==row.objectId||operation.payloadHash!==row.payloadHash||operation.parentId!==entity.parentId
   ||!samePrivateJson(operation.metadata,productMetadata('task',parseLegacyMigrationJson(row.metadataJson,'E2EE_PRODUCT_PROOF_INVALID',4*1024*1024))))invalid();
  if(operation.expectedRevision!==entity.revision&&!(operation.expectedRevision+1===entity.revision&&operation.objectId===entity.objectId&&operation.payloadHash===entity.payloadHash))invalid();
  reviewed.set(row.proposalId as string,{proposalId:row.proposalId as string,entityId:row.entityId as string,baseRevision:row.baseRevision as number,operation,actorId:row.actorId as string,createdAt:row.createdAt as string});
 }
 const approvals=new Map<string,Set<string>>();for(const row of attestations){exactKeys(row,['proposalId','userId','deviceId','payloadHash','createdAt','proofHash']);const proposal=reviewed.get(String(row.proposalId)),proof=proofs.get(String(row.proofHash));
  if(!proposal||!proof||proof.command.action!=='product-approve'||proof.actorId!==row.userId||proof.command.deviceId!==row.deviceId||proof.command.payload.proposalId!==row.proposalId
   ||proof.command.payload.entityId!==proposal.entityId||proof.command.payload.baseRevision!==proposal.baseRevision||proof.command.payload.payloadHash!==proposal.operation.payloadHash||row.payloadHash!==proposal.operation.payloadHash
   ||!proposal.operation.metadata.approverIds!.includes(proof.actorId))invalid();
  if(!approvals.has(proposal.proposalId))approvals.set(proposal.proposalId,new Set());const users=approvals.get(proposal.proposalId)!;if(users.has(proof.actorId))invalid();users.add(proof.actorId);
 }
 const origins:VerifiedProductOrigin[]=[],seen=new Set<string>();for(const row of heads){exactKeys(row,['entityId','revision','proofHash']);const entity=entities.find(value=>value.entityId===row.entityId),proof=proofs.get(String(row.proofHash));
  if(!entity||!proof||seen.has(entity.entityId)||row.revision!==entity.revision)invalid();seen.add(entity.entityId);
  if(proof.command.action==='product-commit'||proof.command.action==='product-commit-bound'){
   const operation=(proof.command.payload.operations as WireValue[]).map(productMutation).find(row=>row.entityId===entity.entityId);if(!operation||operation.action==='propose-complete'||!matches(operation,entity))invalid();
   if(operation.action==='create'&&entity.authorId!==proof.actorId)invalid();
  }else if(proof.command.action==='product-bootstrap-stage'){
   const payload=proof.command.payload,parts=baseline.command.payload.parts as {partIndex:number;proofHash:string}[];
   if(payload.bootstrapId!==baseline.command.payload.bootstrapId||parts[Number(payload.partIndex)]?.proofHash!==proof.proofHash)invalid();
   const item=(payload.items as {operation:ProductMutation;authorId:string}[]).find(row=>row.operation.entityId===entity.entityId);
   if(!item||!matches(item.operation,entity)||entity.authorId!==item.authorId)invalid();
  }else{const proposal=reviewed.get(String(proof.command.payload.proposalId));if(!proposal||proposal.entityId!==entity.entityId||!matches(proposal.operation,entity)
    ||!proposal.operation.metadata.completed||!proposal.operation.metadata.approverIds?.length||proposal.operation.metadata.approverIds.some(user=>!approvals.get(proposal.proposalId)?.has(user)))invalid();}
  const action=['product-commit','product-commit-bound'].includes(proof.command.action)?(proof.command.payload.operations as unknown as ProductMutation[]).find(row=>row.entityId===entity.entityId)!.action:proof.command.action==='product-approve'?'complete':'baseline';
  origins.push({entityId:entity.entityId,revision:entity.revision,actorId:proof.actorId,bootstrap:proof.command.action==='product-bootstrap-stage',action,operationId:proof.command.operationId});
 }
 return{entities,origins,proposals:[...reviewed.values()].map(proposal=>({...proposal,approvals:attestations.filter(row=>row.proposalId===proposal.proposalId).map(row=>{if(typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))invalid();return{userId:String(row.userId),createdAt:row.createdAt};})})),bootstrap:{bootstrapId:baseline.command.payload.bootstrapId as string,proofHash:baseline.proofHash,expectedCount:baseline.command.payload.expectedCount as number,parts:baseline.command.payload.parts as {partIndex:number;proofHash:string}[]}};
}
function matches(operation:ProductMutation,entity:ProductEntity){return operation.expectedRevision+1===entity.revision&&operation.kind===entity.kind&&operation.domain===entity.domain
 &&operation.objectId===entity.objectId&&operation.payloadHash===entity.payloadHash&&operation.parentId===entity.parentId&&(operation.action==='delete')===entity.deleted&&samePrivateJson(operation.metadata,entity.metadata);}
