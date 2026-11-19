import {PersonalTasksSource,readMigratedPersonalTasks,type TasksMigrationMemory} from '../../app/e2ee/tasks-source.ts';
import {createRecoveryKit} from '../../app/e2ee/keys.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault.ts';
import {encodeE2eeBytes} from '../../app/e2ee/envelope.ts';

const report:{synthetic:true;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
function check(name:string,passed:boolean){report.checks.push({name,passed});if(!passed)throw new Error(name);}
const owner='browser-task-source-'+crypto.randomUUID(),scopeId='personal:'+owner;
const sourceKeys=[`genesis-calendar-v2:${owner}`,`genesis-pending-mutations-v2:${owner}`,`genesis-pending-mutations-v2-deleted:${owner}`];
let identity:UnlockedWebDevice|undefined,recovery:Awaited<ReturnType<typeof createRecoveryKit>>|undefined;
try{
 check('actual secure WebCrypto, localStorage and IndexedDB',isSecureContext&&!!crypto.subtle&&!!localStorage&&!!indexedDB);
 recovery=await createRecoveryKit(owner);const storage=new IndexedDbE2eeStorage();identity=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,storage,new IndexedDbDeviceKeyStorage());
 const currentDevice=identity,canary='Synthetic task browser canary '+crypto.randomUUID();
 const old={id:'private-task-2026-11-19',title:'Older synthetic display',description:'Exact original text',dueDate:'2026-11-19',done:false,updatedAt:1,googleTaskId:'old-external-copy',syncToGoogle:true,
  recurrenceOriginalDate:'2026-11-18',recurrenceSeriesId:'private-series',recurrenceMode:'lunar',recurrencePattern:'lunar-days',recurrenceDays:[3,8]};
 const changed={...old,title:canary},memory:TasksMigrationMemory={ownerId:owner,legacyKey:'',generation:0,reconciliationRequired:false,tasks:[old],editors:[]};
 localStorage.setItem(sourceKeys[0],JSON.stringify({tasks:[old]}));localStorage.setItem(sourceKeys[1],JSON.stringify([{key:'task:'+old.id,path:'/tasks/'+old.id,method:'PUT',body:JSON.stringify(changed)}]));
 localStorage.setItem(sourceKeys[2],'[ "removed-private-task" ]');const before=sourceKeys.map(key=>localStorage.getItem(key));
 const lease={ownerId:owner,scopeId,migrationId:crypto.randomUUID(),fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32)),generation:2};let reads=0;
 const source=new PersonalTasksSource(owner,scopeId,{storage:localStorage,memory:()=>memory,assertCurrent:()=>currentDevice.requireOpen(),legacyTasks:async context=>{
  check('source IO follows durable encrypted capture',!!await currentDevice.vault.read('local-snapshot','task-source').then(row=>{row?.value.fill(0);return row;}));
  check('source receives the exact owner/lease',JSON.stringify(context)===JSON.stringify(lease));reads++;
  return{protocol:1,ownerId:owner,scopeId,migrationId:lease.migrationId,fence:1,sourceHash:lease.sourceHash,legacyGeneration:0,checkpointHash:lease.sourceHash,directoryRevision:1,
   tasks:[],deletions:[],links:[],recovered:[],recoveredDeletions:[],creations:[],creationTargets:[],legacyKey:{keyMode:'empty',key:null}};
 }});
 const snapshot=await source.captureLocal();check('capture cannot perform an early private read',reads===0);await currentDevice.ensureDurableKeys();
 try{await currentDevice.vault.write([{domain:'local-snapshot',objectId:'task-source',value:snapshot,expected:null}]);}finally{snapshot.fill(0);}
 const saved=(await currentDevice.vault.read('local-snapshot','task-source'))!;let result:Awaited<ReturnType<PersonalTasksSource['reconcile']>>;
 try{result=await source.reconcile(saved.value,[],lease);}finally{saved.value.fill(0);}
 check('task reconciliation is complete with exactly one source read',result.complete&&reads===1);
 for(const row of result.content){try{await currentDevice.vault.write([{domain:row.domain,objectId:row.objectId,value:row.bytes,expected:null}]);}finally{row.bytes.fill(0);}}
 check('raw task queue and tombstones remain byte-identical',sourceKeys.every((key,index)=>localStorage.getItem(key)===before[index]));
 const rawStorage=JSON.stringify(await Promise.all((await storage.list('')).map(id=>storage.get(id))));
 check('new IndexedDB storage contains no task plaintext or recovery secret',!rawStorage.includes(canary)&&!rawStorage.includes(encodeE2eeBytes(recovery.secret)));
 currentDevice.lock();let blocked=false;try{await currentDevice.vault.read('workspace','personal-task-index-v1');}catch{blocked=true;}check('locked device denies task read',blocked);
 identity=await UnlockedWebDevice.unlock(owner,recovery.secret,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());const reopened=identity;
 const values=await readMigratedPersonalTasks(owner,async id=>(await reopened.vault.read('workspace',id))?.value??null,()=>reopened.requireOpen());
 check('fresh device-vault connection reads unsent content',values.tasks.length===1&&values.tasks[0].title===canary&&values.tasks[0].description===old.description);
 check('fresh connection preserves detached identity and deletions',values.tasks[0].recurrenceOriginalDate==='2026-11-18'&&values.deletedIds[0]==='removed-private-task');
 check('provider copy requires new consent after read',values.tasks[0].syncToGoogle===false&&Array.isArray(values.tasks[0].syncAccountIds)&&values.tasks[0].syncAccountIds.length===0);
 check('ordinary new-root read never reopens legacy source',reads===1);
 const duplicate='{"tasks":[{"id":"duplicate-private","title":"First original","ti\\u0074le":"Second original"}]}';
 localStorage.setItem(sourceKeys[0],duplicate);let unexpectedReads=0;
 const strictSource=new PersonalTasksSource(owner,scopeId,{storage:localStorage,memory:()=>memory,assertCurrent:()=>reopened.requireOpen(),legacyTasks:async()=>{unexpectedReads++;throw new Error('Unexpected synthetic IO');}});
 const duplicateCapture=await strictSource.captureLocal();try{
  await reopened.vault.write([{domain:'local-snapshot',objectId:'duplicate-task-source',value:duplicateCapture,expected:null}]);let code='';
  try{await strictSource.reconcile(duplicateCapture,[],lease);}catch(error){code=error instanceof Error?error.message:'';}
  check('escaped duplicate names cannot silently discard task content',code==='E2EE_TASK_SOURCE_INVALID');
  check('duplicate JSON is retained exactly with no private source IO',localStorage.getItem(sourceKeys[0])===duplicate&&unexpectedReads===0);
 }finally{duplicateCapture.fill(0);}
}catch(error){report.error=error instanceof Error&&/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'BROWSER_TASK_SOURCE_ACCEPTANCE_FAILED';}
finally{identity?.lock();recovery?.secret.fill(0);for(const key of sourceKeys)localStorage.removeItem(key);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS task source';
