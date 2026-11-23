import {exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {verifyDeviceDirectory,signingPublicKey,type VerifiedDirectory} from './directory.ts';
import {validateDeviceAccessTarget} from './device-access-contract.ts';
import {validateMembershipChanges,membershipFields} from './membership-contract.ts';
import {validateMembershipOperation} from './membership-operation-plan.ts';
import {membershipRotationShapeForHash,type MembershipPeerPorts} from './membership-exchange.ts';
import {verifyMembershipAtomicPacket} from './membership-atomic-proofs.ts';
import {validateMembershipAtomicPreviewPage,type MembershipAtomicPreviewPage,type MembershipAtomicScopePreview} from './membership-atomic-preview.ts';
import {membershipAtomicDigest,membershipAtomicPlanHash,membershipAtomicChangeHash,membershipAtomicPageRef,validateMembershipAtomicPage,validateMembershipAtomicPlan,validateMembershipAtomicRefs,
 type MembershipAtomicPlan,type MembershipAtomicPage,type MembershipAtomicPageRef,type MembershipAtomicAnchor,type MembershipAtomicProducts} from './membership-atomic-contract.ts';
import {commandBytes,verifyE2eeCommand,type SignedE2eeCommand} from './commands.ts';

export type MembershipAtomicPreviewRef={index:number;after:number;count:number;pageHash:string};
export type MembershipAtomicReview={format:'genesis-membership-atomic-review-v2';plan:MembershipAtomicPlan;previewPages:MembershipAtomicPreviewRef[];productPages:MembershipAtomicPageRef[];authorization:SignedE2eeCommand;createdAt?:string};
export type MembershipAtomicReviewPart={format:'genesis-membership-atomic-review-part-v2';fingerprint:string;kind:'plan'|'preview'|'products';index:number;page:MembershipAtomicPage|MembershipAtomicPreviewPage};
export type MembershipAtomicOwnerApproval={format:'genesis-membership-atomic-owner-approval-v2';requestFingerprint:string;scopeId:string;packet:SignedE2eeCommand};
export type MembershipAtomicProductOrigin={scopeId:string;intentId:string;actorId:string;deviceId:string;commandHash:string};
function invalid():never{throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');}
const integer=(value:unknown,max:number)=>{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>max)invalid();};
export function membershipAtomicPreviewRef(index:number,page:MembershipAtomicPreviewPage,after:number):MembershipAtomicPreviewRef{
 integer(index,5000);integer(after,5000);return{index,after,count:page.scopePlans.length,pageHash:membershipAtomicDigest({format:'genesis-membership-atomic-preview-page-v2',after,page})};
}
/** The header commits to EVERY effects page and the complete attributed roster.
 * Individual parts are bounded; importing a prefix never enables approval. */
export function validateMembershipAtomicReview(input:unknown):MembershipAtomicReview{
 exactKeys(input,['format','plan','previewPages','productPages','authorization',...(input&&typeof input==='object'&&Object.hasOwn(input,'createdAt')?['createdAt']:[])]);if(input.format!=='genesis-membership-atomic-review-v2')invalid();const plan=validateMembershipAtomicPlan(input.plan);
 if(Object.hasOwn(input,'createdAt')&&(typeof input.createdAt!=='string'||input.createdAt.length!==24||!Number.isFinite(Date.parse(input.createdAt))||new Date(input.createdAt).toISOString()!==input.createdAt))invalid();
 exactKeys(input.authorization,['command','signature']);const authorization=input.authorization as SignedE2eeCommand;commandBytes(authorization.command).fill(0);decodeE2eeBytes(authorization.signature,64);
 const command=authorization.command;exactKeys(command.payload,['intentId','planHash']);if(command.ownerId!==plan.actorId||command.action!=='membership-atomic-begin'||command.payload.intentId!==plan.intentId||command.payload.planHash!==membershipAtomicPlanHash(plan))invalid();
 if(!Array.isArray(input.previewPages)||input.previewPages.length<1||input.previewPages.length>plan.scopeIds.length)invalid();let next=0;
 for(const [index,ref]of input.previewPages.entries()){exactKeys(ref,['index','after','count','pageHash']);if(ref.index!==index||ref.after!==next)invalid();integer(ref.count,200);if(Number(ref.count)<1)invalid();next+=Number(ref.count);decodeE2eeBytes(ref.pageHash,32);}
 if(next!==plan.scopeIds.length)invalid();const products=validateMembershipAtomicRefs(input.productPages,true);if(products.some(ref=>ref.kind!=='product-packets'))invalid();
 return structuredClone(input) as MembershipAtomicReview;
}
export function membershipAtomicReviewFingerprint(input:MembershipAtomicReview){return membershipAtomicDigest(validateMembershipAtomicReview(input));}
export function createMembershipAtomicReview(plan:MembershipAtomicPlan,previews:MembershipAtomicPreviewPage[],products:MembershipAtomicPage[],authorization:SignedE2eeCommand,createdAt:string){
 let after=0;const refs=previews.map((page,index)=>{const ref=membershipAtomicPreviewRef(index,page,after);after+=page.scopePlans.length;return ref;});
 return validateMembershipAtomicReview({format:'genesis-membership-atomic-review-v2',plan,previewPages:refs,productPages:products.map((page,index)=>membershipAtomicPageRef(index,page)),authorization,createdAt});
}
export function validateMembershipAtomicReviewPart(input:unknown,request:MembershipAtomicReview):MembershipAtomicReviewPart{
 const header=validateMembershipAtomicReview(request);exactKeys(input,['format','fingerprint','kind','index','page']);
 if(input.format!=='genesis-membership-atomic-review-part-v2'||input.fingerprint!==membershipAtomicReviewFingerprint(header)||!['plan','preview','products'].includes(String(input.kind)))invalid();integer(input.index,9999);const index=Number(input.index);
 if(input.kind==='preview'){
  const ref=header.previewPages[index];if(!ref)invalid();exactKeys(input.page,['intentId','planHash','changeHash','scopePlans','next']);
  if(!Array.isArray(input.page.scopePlans)||input.page.scopePlans.length!==ref.count||!same(membershipAtomicPreviewRef(index,input.page as MembershipAtomicPreviewPage,ref.after),ref))invalid();
 }else{
  const page=validateMembershipAtomicPage(input.page),ref=(input.kind==='plan'?header.plan.pages:header.productPages)[index];
  if(!ref||!same(membershipAtomicPageRef(index,page),ref)||input.kind==='products'&&page.kind!=='product-packets')invalid();
 }return structuredClone(input) as MembershipAtomicReviewPart;
}
export function membershipAtomicRotationShape(input:unknown,request:MembershipAtomicReview,scope:MembershipAtomicScopePreview){
 return membershipRotationShapeForHash(input,membershipAtomicChangeHash(request.plan),{...scope,roles:scope.roles.map(({deviceId,role})=>({deviceId,role}))});
}
export function validateMembershipAtomicOwnerApproval(input:unknown,request:MembershipAtomicReview,scope:MembershipAtomicScopePreview):MembershipAtomicOwnerApproval{
 exactKeys(input,['format','requestFingerprint','scopeId','packet']);if(input.format!=='genesis-membership-atomic-owner-approval-v2'||input.requestFingerprint!==membershipAtomicReviewFingerprint(request)||input.scopeId!==scope.scopeId)invalid();
 membershipAtomicRotationShape(input.packet,request,scope);return structuredClone(input) as MembershipAtomicOwnerApproval;
}
/** The HTTP preview cannot assign user identities to public keys. Each claimed
 * user/device comes from an independently pinned signed directory frame. */
export async function verifyMembershipAtomicRecipients(anchor:MembershipAtomicAnchor,scope:MembershipAtomicScopePreview,ports:MembershipPeerPorts,request?:MembershipAtomicReview,retained=false){
 ports.current();const target=validateDeviceAccessTarget(await ports.target(anchor.scopeId));ports.current();
 if(['scopeId','ownerId','kind','resourceId'].some(key=>target[key as keyof typeof target]!==anchor[key as keyof MembershipAtomicAnchor]))invalid();
 const previous=await ports.checkpoint(anchor.scopeId);ports.current();const response=await ports.directory(anchor.scopeId);ports.current();const frames=new Map<number,VerifiedDirectory>();
 const current=await verifyDeviceDirectory(anchor.ownerId,anchor.scopeId,target.authority,response.events,previous,value=>{if(value.checkpoint.revision===anchor.directoryRevision)frames.set(anchor.directoryRevision,structuredClone(value));});ports.current();const frame=frames.get(anchor.directoryRevision);
 if(!frame||frame.checkpoint.hash!==anchor.checkpointHash||frame.generation!==anchor.generation||frame.kind!==anchor.kind||frame.resourceId!==anchor.resourceId||frame.cryptoEpoch!==scope.cryptoEpoch||frame.securityEpoch!==scope.securityEpoch)invalid();
 if(!retained&&current.checkpoint.revision!==anchor.directoryRevision)throw new Error('E2EE_MEMBERSHIP_STALE');const live=[...frame.devices.values()].filter(device=>!device.revoked);
 if(live.length!==scope.roles.length)invalid();for(const role of scope.roles){const device=frame.devices.get(role.deviceId);if(!device||device.revoked||device.userId!==role.userId||device.userId===anchor.ownerId&&role.role!=='owner'||device.userId!==anchor.ownerId&&role.role==='owner')invalid();}
 // The initiating device is identified through existing independent SHARED
 // pins. Its personal begin packet creates no new personal trust authority.
 let actorVerified=false;if(request){const signer=frame.devices.get(request.authorization.command.deviceId);if(signer&&!signer.revoked&&signer.userId===request.plan.actorId&&['owner','writer'].includes(signer.role)){
  await verifyE2eeCommand(request.authorization,await signingPublicKey(signer.signingKey));ports.current();actorVerified=true;
 }}
 await ports.remember(target,response.events);ports.current();return{roles:structuredClone(scope.roles),actorVerified};
}
/** One-use complete collector. Its ports only verify observed history. It has
 * no signer, root, ACL writer or HTTP mutation capability. */
export class MembershipAtomicReviewCollector{
 readonly header:MembershipAtomicReview;readonly fingerprint:string;
 #planAt=0;#previewAt=0;#productAt=0;#sealed=false;#actorVerified=false;#anchors=new Map<string,MembershipAtomicAnchor>();#scopes=new Map<string,MembershipAtomicScopePreview>();
 #products=new Map<string,MembershipAtomicProducts>();#origins=new Map<string,MembershipAtomicProductOrigin>();#operation:Record<string,unknown>|null=null;#grants:unknown[]=[];#unique=new Set<string>();
 constructor(input:MembershipAtomicReview,private readonly peers:MembershipPeerPorts,private readonly retained=false){this.header=validateMembershipAtomicReview(input);if(!retained&&!this.header.createdAt)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');this.fingerprint=membershipAtomicReviewFingerprint(this.header);}
 async consume(input:MembershipAtomicReviewPart){this.peers.current();if(this.#sealed)invalid();const part=validateMembershipAtomicReviewPart(input,this.header);
  if(part.kind==='plan'){
   if(part.index!==this.#planAt||this.#previewAt||this.#productAt)invalid();const page=part.page as MembershipAtomicPage;
   for(const row of page.items){let key:string;
    switch(page.kind){
     case'operation':if(this.#operation)invalid();this.#operation=structuredClone(row) as Record<string,unknown>;continue;
     case'operation-grants':this.#grants.push(row);key='grant:'+String((row as {projectId:string}).projectId);break;
     case'anchors':{const anchor=row as MembershipAtomicAnchor;if(!this.header.plan.scopeIds.includes(anchor.scopeId))invalid();if(!this.retained&&!anchor.productIndexHash)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');this.#anchors.set(anchor.scopeId,anchor);key='anchor:'+anchor.scopeId;break;}
     case'product-operations':{const product=row as MembershipAtomicProducts;if(!this.header.plan.scopeIds.includes(product.scopeId))invalid();key='product:'+product.scopeId+'\0'+product.intentId;this.#products.set(key,product);for(const op of product.operations){const entity='entity:'+product.scopeId+'\0'+op.entityId;if(this.#unique.has(entity))invalid();this.#unique.add(entity);}break;}
     case'acl':{const change=row as {table:string;key:Record<string,unknown>};key='acl:'+change.table+'\0'+membershipAtomicDigest(membershipFields(change.key));break;}
     case'clear-assignments':case'role-events':{const effect=row as {projectId:string;userId:string};key=page.kind+':'+effect.projectId+'\0'+effect.userId;break;}
     case'revoke-invitations':{const effect=row as {kind:string;resourceId:string;userId:string};key=page.kind+':'+effect.kind+'\0'+effect.resourceId+'\0'+effect.userId;break;}
     default:invalid();
    }if(this.#unique.has(key))invalid();this.#unique.add(key);
   }if(page.kind==='acl')validateMembershipChanges(page.items);this.#planAt++;return;
  }
  if(this.#planAt!==this.header.plan.pages.length||!this.#operation||!same([...this.#anchors.keys()].sort(),this.header.plan.scopeIds))invalid();
  validateMembershipOperation(this.#operation.kind==='project-grants'?{...this.#operation,grants:this.#grants}:this.#operation);if(this.#operation.kind!=='project-grants'&&this.#grants.length)invalid();
  if(part.kind==='preview'){
   if(part.index!==this.#previewAt||this.#productAt)invalid();const ref=this.header.previewPages[part.index],page=validateMembershipAtomicPreviewPage(part.page,this.header.plan,membershipAtomicPlanHash(this.header.plan),ref.after,this.#anchors);
   for(const scope of page.scopePlans){const checked=await verifyMembershipAtomicRecipients(this.#anchors.get(scope.scopeId)!,scope,this.peers,this.header,this.retained);this.peers.current();this.#actorVerified||=checked.actorVerified;this.#scopes.set(scope.scopeId,scope);}this.#previewAt++;return;
  }
  if(this.#previewAt!==this.header.previewPages.length||part.index!==this.#productAt)invalid();const page=part.page as Extract<MembershipAtomicPage,{kind:'product-packets'|'rotation-packets'}>;
  for(const packet of page.items){const command=packet.command,key='product:'+command.scopeId+'\0'+command.payload.intentId,expected=this.#products.get(key),anchor=this.#anchors.get(command.scopeId);
   if(!expected||!anchor||this.#origins.has(key)||!same(command.payload.operations,expected.operations))invalid();const proof=await verifyMembershipAtomicPacket(this.header.plan,anchor,packet,this.peers);this.peers.current();
   this.#origins.set(key,{scopeId:command.scopeId,intentId:String(command.payload.intentId),...proof});
  }this.#productAt++;
 }
 finish(){this.peers.current();if(this.#sealed||!this.#actorVerified||this.#planAt!==this.header.plan.pages.length||this.#previewAt!==this.header.previewPages.length||this.#productAt!==this.header.productPages.length||this.#origins.size!==this.#products.size||!same([...this.#scopes.keys()].sort(),this.header.plan.scopeIds))invalid();this.#sealed=true;
  return{fingerprint:this.fingerprint,scopes:structuredClone([...this.#scopes.values()]),products:structuredClone([...this.#origins.values()])};
 }
}
