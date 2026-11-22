import {E2eeSharedTrust,type SharedScopeTrust} from './shared-trust.ts';
import {validatePrivateProjectLocation,validatePrivateProjectSelection,type PrivateProjectLocation,type PrivateProjectAnchor} from './project-create-contract.ts';
import {sharedBodyMetadata,type SharedRecordBody} from './shared-domain.ts';
import {samePrivateJson as same} from './product-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {E2eeSharedRecords} from './shared-records.ts';
import type {ProductEntity,ProductKind} from './product-contract.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {VerifiedDirectory} from './directory.ts';

type Opened={trust:SharedScopeTrust;client:E2eeScopeClient;directory:VerifiedDirectory;stamp:(string|number)[];coordinates:Omit<PrivateProjectAnchor,'entityId'|'revision'|'payloadHash'>;records:E2eeSharedRecords;index:ProductEntity[];heads:Map<string,ProductEntity>};
const changed=():never=>{throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');};
const frame=(directory:VerifiedDirectory)=>[directory.ownerId,directory.scopeId,directory.kind,directory.resourceId,directory.state,
 directory.generation,directory.cryptoEpoch,directory.securityEpoch,directory.keyId,directory.checkpoint.revision,directory.checkpoint.hash];
/** Called only after the complete draft is durable. This composes actual
 * pinned scope clients and decrypted normal repositories, never server-only
 * directory proposals, namespace discovery or an opaque supplied anchor. */
export async function capturePrivateProjectSelection(account:WebPrivateAccount,raw:PrivateProjectLocation,guard:()=>void){
 const location=validatePrivateProjectLocation(raw),current=()=>{guard();account.requireOpen();};current();
 if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');
 const trust=new E2eeSharedTrust(account.ownerId),known=await trust.list();current();const opened=new Map<string,Opened>();
 const open=async(kind:'space'|'project',resourceId:string)=>{
  const key=kind+':'+resourceId,prior=opened.get(key);if(prior)return prior;
  const matches=known.filter(row=>row.kind===kind&&row.resourceId===resourceId);if(matches.length!==1)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
  const pin=matches[0],scope=await trust.open(pin.scopeId);current();const directory=scope.directory,own=directory.devices.get(account.device.deviceId);
  if(directory.ownerId!==pin.ownerId||directory.kind!==kind||directory.resourceId!==resourceId||directory.scopeId!==pin.scopeId||directory.state!=='active'
   ||!same(directory.recoveryKit.authority,pin.authority)||!own||own.revoked||own.userId!==account.ownerId)changed();
  const {records}=await account.sharedRecords(pin.scopeId,kind,resourceId);current();const index=await records.index();current();
  const value:Opened={trust:pin,client:scope.client,directory,stamp:frame(directory),coordinates:{scopeId:directory.scopeId,generation:directory.generation,
   directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash},records,index,heads:new Map()};opened.set(key,value);return value;
 };
 const head=async(scope:Opened,kind:ProductKind,id:string)=>{
  const entity=scope.index.find(row=>row.entityId===kind+':'+id&&row.kind===kind);
  if(!entity||entity.deleted)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');
  const value=await scope.records.read(entity);current();
  if(value.deleted||value.body===null)throw new Error('E2EE_PRODUCT_DELETED');
  const body=value.body as SharedRecordBody;
  if(body.kind!==kind||body.scopeId!==scope.directory.scopeId||body.scopeKind!==scope.directory.kind||body.resourceId!==scope.directory.resourceId)changed();
  if(kind==='project'&&(entity.metadata.protocol!==2||!same(entity.metadata,sharedBodyMetadata(body))))throw new Error('E2EE_PROJECT_TOPOLOGY_REQUIRED');
  scope.heads.set(entity.entityId,entity);
  const anchor:PrivateProjectAnchor={...scope.coordinates,entityId:entity.entityId,revision:entity.revision,payloadHash:entity.payloadHash};
  return{anchor,body};
 };
 const space=await open('space',location.spaceId),spaceRoot=await head(space,'space',location.spaceId);current();
 let parent:Opened|null=null,parentAnchor:PrivateProjectAnchor|null=null;
 if(location.parentId!==null){
  parent=await open('project',location.parentId);const root=await head(parent,'project',location.parentId);current();
  if(root.body.record.space_id!==location.spaceId||root.body.record.is_inbox!==0||root.body.record.archived_at!==null)changed();
  parentAnchor=root.anchor;
 }
 let categoryAnchor:PrivateProjectAnchor|null=null,statusAnchor:PrivateProjectAnchor|null=null;
 if(location.categoryId!==null){const category=await head(space,'category',location.categoryId);current();
  if(category.body.table!=='shared_space_project_categories'||category.body.record.space_id!==location.spaceId)changed();categoryAnchor=category.anchor;}
 if(location.boardStatusId!==null){if(!parent)changed();const status=await head(parent,'status',location.boardStatusId);current();
  if(status.body.table!=='shared_project_statuses'||status.body.record.project_id!==location.parentId||status.body.record.is_chaos!==0)changed();statusAnchor=status.anchor;}
 // Chosen heads and directory generations must still match after all decrypts.
 // Unrelated task edits do not change this selected set.
 for(const scope of opened.values()){
  const after=await scope.client.refresh();current();if(!same(frame(after),scope.stamp))changed();
  const index=await scope.records.index();current();for(const expected of scope.heads.values()){
   const actual=index.find(row=>row.entityId===expected.entityId);if(!actual||!same(actual,expected))changed();
  }
  const final=await scope.client.refresh();current();if(!same(frame(final),scope.stamp))changed();
 }
 const pins=await trust.list();current();for(const scope of opened.values()){
  const row=pins.find(value=>value.scopeId===scope.trust.scopeId);if(!row||!same(row,scope.trust))changed();
 }
 return validatePrivateProjectSelection({...location,spaceAnchor:spaceRoot.anchor,parentAnchor,categoryAnchor,statusAnchor});
}
