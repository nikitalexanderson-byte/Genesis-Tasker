import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {snapshotE2eeValue} from './commands.ts';

export type PrivateProjectAnchor={scopeId:string;entityId:string;generation:number;directoryRevision:number;checkpointHash:string;revision:number;payloadHash:string};
export type PrivateProjectTopology={spaceId:string;parentId:string|null;categoryId:string|null;boardStatusId:string|null;kind:'project'|'task-list';layout:'list'|'board';
 spaceAnchor:PrivateProjectAnchor;parentAnchor:PrivateProjectAnchor|null;categoryAnchor:PrivateProjectAnchor|null;statusAnchor:PrivateProjectAnchor|null;
 reviewedMembers:{userId:string;role:'owner'|'manager'|'member'|'commenter'|'viewer'}[]};
const invalid=():never=>{throw new Error('E2EE_PROJECT_TOPOLOGY_REQUIRED');};
/** Technical shape/custody only. Actual creation must independently verify
 * current pinned directories/decrypted heads and explicit recipient review. */
export function validatePrivateProjectTopology(input:unknown,actorId:string):PrivateProjectTopology{
 exactKeys(input,['spaceId','parentId','categoryId','boardStatusId','kind','layout','spaceAnchor','parentAnchor','categoryAnchor','statusAnchor','reviewedMembers']);
 assertTechnical(input.spaceId);for(const key of ['parentId','categoryId','boardStatusId'])if(input[key]!==null)assertTechnical(input[key]);
 if(!['project','task-list'].includes(String(input.kind))||!['list','board'].includes(String(input.layout))
  ||input.kind==='task-list'&&(input.parentId===null||input.categoryId!==null)||input.boardStatusId!==null&&input.parentId===null)invalid();
 const anchor=(value:unknown,entityId:string|null)=>{
  if(entityId===null){if(value!==null)invalid();return;}
  exactKeys(value,['scopeId','entityId','generation','directoryRevision','checkpointHash','revision','payloadHash']);
  assertTechnical(value.scopeId);if(value.entityId!==entityId)invalid();
  for(const key of ['generation','directoryRevision','revision'])if(!Number.isSafeInteger(value[key])||Number(value[key])<1)invalid();
  decodeE2eeBytes(value.checkpointHash,32);decodeE2eeBytes(value.payloadHash,32);
 };
 anchor(input.spaceAnchor,'space:'+input.spaceId);anchor(input.parentAnchor,input.parentId===null?null:'project:'+input.parentId);
 anchor(input.categoryAnchor,input.categoryId===null?null:'category:'+input.categoryId);anchor(input.statusAnchor,input.boardStatusId===null?null:'status:'+input.boardStatusId);
 if(!Array.isArray(input.reviewedMembers)||input.reviewedMembers.length<1||input.reviewedMembers.length>200)invalid();
 let previous='',owners=0;
 for(const row of input.reviewedMembers){exactKeys(row,['userId','role']);assertTechnical(row.userId);
  if(row.userId<=previous||!['owner','manager','member','commenter','viewer'].includes(String(row.role))||(row.role==='owner')!==(row.userId===actorId))invalid();
  previous=row.userId;if(row.role==='owner')owners++;
 }
 if(owners!==1)invalid();return snapshotE2eeValue(input) as PrivateProjectTopology;
}
