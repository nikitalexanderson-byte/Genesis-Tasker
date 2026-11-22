import {canonicalE2eeValue,snapshotE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {sha256} from '@noble/hashes/sha2.js';

export type MembershipChange={table:'shared_project_members'|'shared_space_members'|'shared_member_categories'|'shared_member_project_grants';key:Record<string,string>;expectedHash:string;after:Record<string,WireValue>|null};
export const MEMBERSHIP_HASH_FORMAT='acl-name-value-v1';
export const MEMBERSHIP_SPECS={
 shared_project_members:{keys:['project_id','user_id'],fields:['role']},
 shared_space_members:{keys:['space_id','user_id'],fields:['role','can_organize_tasks','all_projects','permissions_json','member_category_id','project_access_restricted','project_access_revision']},
 shared_member_categories:{keys:['id','space_id'],fields:['permissions_json','revision']},
 shared_member_project_grants:{keys:['space_id','user_id','project_id'],fields:['role','include_descendants','excluded']}
} as const;
const invalid=():never=>{throw new Error('E2EE_MEMBERSHIP_BATCH_INVALID');};
/** SQL names are values in this projection, never new canonical object keys.
 * Strings retain their exact UTF8 bytes, including permissions JSON whitespace. */
export function membershipFields(value:Record<string,unknown>):WireValue[]{
 return Object.keys(value).sort().map(name=>{if(!/^[a-z_]{1,64}$/.test(name))invalid();const raw=value[name];
  if(raw===null||typeof raw==='boolean'||typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0)return{name,value:raw};
  if(typeof raw==='string'){const bytes=new TextEncoder().encode(raw);try{return{name,value:{utf8:encodeE2eeBytes(bytes)}};}finally{bytes.fill(0);}}return invalid();
 });
}
export function membershipGrantReviewRequired(input:unknown){return Array.isArray(input)&&input.some(row=>row&&typeof row==='object'&&row.table==='shared_member_project_grants'&&row.after!==null&&typeof row.after==='object'&&!Object.hasOwn(row.after,'excluded'));}
export function validateMembershipChanges(input:unknown,allowMissingExcluded=false):MembershipChange[]{
 if(!Array.isArray(input)||input.length<1||input.length>200)invalid();const seen=new Set<string>();
 for(const row of input){exactKeys(row,['table','key','expectedHash','after']);if(typeof row.table!=='string'||!Object.hasOwn(MEMBERSHIP_SPECS,row.table))invalid();
  const table=row.table as keyof typeof MEMBERSHIP_SPECS,spec=MEMBERSHIP_SPECS[table];exactKeys(row.key,spec.keys);for(const value of Object.values(row.key))assertTechnical(value);
  const key=encodeE2eeBytes(canonicalE2eeValue({table,key:membershipFields(row.key)}));if(seen.has(key))invalid();seen.add(key);
  if(row.expectedHash!=='absent')decodeE2eeBytes(row.expectedHash,32);if(row.after===null)continue;
  const fields=allowMissingExcluded&&table==='shared_member_project_grants'&&row.after&&typeof row.after==='object'&&!Object.hasOwn(row.after,'excluded')?spec.fields.filter(field=>field!=='excluded'):spec.fields;exactKeys(row.after,fields);
  for(const [field,value]of Object.entries(row.after)){
   if(['can_organize_tasks','all_projects','project_access_restricted','include_descendants','excluded'].includes(field)&&value!==0&&value!==1)invalid();
   if(['revision','project_access_revision'].includes(field)&&(!Number.isSafeInteger(value)||Number(value)<1))invalid();
   if(field==='member_category_id'&&value!==null)assertTechnical(value);
   if(field==='role'&&!(table==='shared_space_members'?['owner','admin','member','guest']:table==='shared_project_members'?['owner','manager','member','commenter','viewer']:['member','commenter','viewer']).includes(String(value)))invalid();
   if(field==='permissions_json'){
    if(value===null){if(table==='shared_member_categories')invalid();continue;}if(typeof value!=='string')invalid();
    const permissions=parseLegacyMigrationJson(value,'E2EE_MEMBERSHIP_PERMISSION_INVALID',16384);exactKeys(permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);if(Object.values(permissions).some(item=>typeof item!=='boolean'))invalid();
   }
  }
  membershipFields(row.after);
 }
 return snapshotE2eeValue(input) as MembershipChange[];
}
export function membershipChangesProjection(input:unknown):WireValue[]{return validateMembershipChanges(input).map(row=>({table:row.table,key:membershipFields(row.key),expectedHash:row.expectedHash,after:row.after===null?null:membershipFields(row.after)}));}
export function membershipChangeHashValue(actorId:string,intentId:string,changes:unknown,scopeIds:string[]):WireValue{
 assertTechnical(actorId);assertTechnical(intentId);return{protocol:1,hashFormat:MEMBERSHIP_HASH_FORMAT,actorId,intentId,changes:membershipChangesProjection(changes),scopeIds};
}
export function membershipBeforeHash(table:MembershipChange['table'],input:unknown){
 if(input===null)return'absent';const spec=MEMBERSHIP_SPECS[table];exactKeys(input,[...spec.keys,...spec.fields]);
 const bytes=canonicalE2eeValue({hashFormat:MEMBERSHIP_HASH_FORMAT,fields:membershipFields(input)});try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}
}
