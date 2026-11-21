import {exactKeys} from './keys.ts';
import {normalizeNativeArchiveCapture} from './archives-native-forms.ts';
import {normalizeNativeArchiveRows} from './archive-fragments.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {readLegacyArchiveOperations,type ArchiveContentReaderPorts} from './archives-content.ts';
import {materializeLegacyBackupPayload,type PortableArchiveCapture} from './archives-source.ts';
import type {MigrationSourceContext} from './migration.ts';

type Row=Record<string,unknown>;
/** Native plaintext remains original JSON text until the shared duplicate-name
 * parser sees it. Keys are removed by native before this boundary is called. */
export async function normalizeNativeArchivesSource(input:unknown,ports:ArchiveContentReaderPorts):Promise<PortableArchiveCapture>{
 exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','platform','histories','nativeOriginal']);
 const original=await normalizeNativeArchiveCapture(input.nativeOriginal,ports.assertCurrent);
 if(input.protocol!==2||input.ownerId!==original.ownerId||input.scopeId!==original.scopeId||input.generation!==original.generation||input.platform!=='android'
  ||input.capturedAt!==original.capturedAt||original.pendingGeneration!==null||!Array.isArray(input.histories))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const histories:{source:string;value:unknown}[]=[];
 async function state(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
  const copy=structuredClone(value) as Row;delete copy.key;delete copy.savedKey;delete copy.consent;delete copy.confirmed;
  if(copy.payload!==null&&copy.payload!==undefined)copy.materializedPayload=await materializeLegacyBackupPayload(original.ownerId,copy.payload,ports);
  if(copy.plan!==null&&copy.plan!==undefined){const plan=copy.plan as Row;
   if(!plan||!Array.isArray(plan.operations))throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
   copy.materializedPlan=await readLegacyArchiveOperations(JSON.stringify(plan.operations),original.ownerId,ports);
  }
  return copy;
 }
 for(const candidate of input.histories){
  exactKeys(candidate,['source','value']);if(typeof candidate.source!=='string')throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
  if(candidate.source==='native-forms'){
   const forms=[];
   for(const form of original.forms){
    const states=[];if(form.form)states.push({source:'current',state:await state(form.form.state)});
    for(const [index,manifest] of (form.valueForm?.manifests??[]).entries())states.push({source:`manifest:${index}`,state:await state(manifest.state)});
    // Preserve detached/unreferenced field variants too, without copying a
    // recovery input next to selected archive bytes.
    const values=[];for(const value of form.valueForm?.values??[]){if(['key','savedKey','consent','confirmed'].includes(value.name))continue;
     const portable=value.name==='plan'&&value.value!==null?await state({plan:value.value}):{value:value.value};values.push({id:value.id,name:value.name,...portable});}
    forms.push({id:form.id,mounted:form.mounted,states,values,files:form.files,execution:'history-only'});
   }
   histories.push({source:candidate.source,value:forms});continue;
  }
  if(candidate.source==='backup-history'){
   const parsed=parseLegacyMigrationJson(candidate.value,'E2EE_ARCHIVE_SOURCE_INVALID',1024);
   histories.push({source:candidate.source,value:parsed});continue;
  }
  const value=candidate.value as Row;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');
  if(value.portableBackup!==undefined)value.materializedBackup=await materializeLegacyBackupPayload(original.ownerId,value.portableBackup,ports);
  for(const list of ['documents','tasks'])if(Array.isArray(value[list]))for(const entry of value[list] as Row[]){
   if(typeof entry.rawDocument==='string')parseLegacyMigrationJson(entry.rawDocument,'E2EE_ARCHIVE_SOURCE_INVALID',64*1024*1024);
  }
  histories.push({source:candidate.source,value});
 }
 ports.assertCurrent();return{protocol:2,ownerId:original.ownerId,scopeId:original.scopeId,capturedAt:original.capturedAt,generation:original.generation,platform:'android',histories};
}
export function nativeArchivesRemote(input:unknown,context:MigrationSourceContext,current:()=>void){return normalizeNativeArchiveRows(input,context,current);}
