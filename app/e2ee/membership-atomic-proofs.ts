import {sha256} from '@noble/hashes/sha2.js';
import {e2eeCommandHash,verifyE2eeCommand,type SignedE2eeCommand} from './commands.ts';
import {exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {signingPublicKey,verifyDeviceDirectory,type VerifiedDirectory} from './directory.ts';
import {validateDeviceAccessTarget} from './device-access-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import {productMutation} from './product-contract.ts';
import {validateMembershipAtomicPlan,validateMembershipAtomicRefs,validateMembershipAtomicAnchor,validateMembershipAtomicPage,membershipAtomicPageRef,membershipAtomicChangeHash,MembershipAtomicPacketBindings,
 type MembershipAtomicPlan,type MembershipAtomicAnchor,type MembershipAtomicPageRef} from './membership-atomic-contract.ts';
import {validateMembershipAtomicReceipt,membershipAtomicReceiptPageRef,validateMembershipAtomicReceiptPage,
 type MembershipAtomicReceipt,type MembershipAtomicScopeReceipt,type MembershipAtomicProductReceipt} from './membership-atomic-receipts.ts';
import type {MembershipPeerPorts} from './membership-exchange.ts';

const invalid=():never=>{throw new Error('E2EE_INVALID_RECEIPT');};
/** Verify actual author/device against independently accepted pins. This does
 * not require another owner's root or promote an authority from packet bytes. */
export async function verifyMembershipAtomicPacket(plan:MembershipAtomicPlan,rawAnchor:MembershipAtomicAnchor,raw:SignedE2eeCommand,ports:MembershipPeerPorts,confirmed=false){
 ports.current();const anchor=validateMembershipAtomicAnchor(rawAnchor),kind=raw.command.action==='rotate-membership'?'rotation-packets':'product-packets';
 const packet=(validateMembershipAtomicPage({kind,items:[raw]}).items as SignedE2eeCommand[])[0],command=packet.command;
 if(!plan.scopeIds.includes(anchor.scopeId)||command.scopeId!==anchor.scopeId||command.ownerId!==anchor.ownerId||command.expectedRevision!==anchor.directoryRevision
  ||command.checkpointHash!==anchor.checkpointHash||command.payload.membershipHash!==membershipAtomicChangeHash(plan))invalid();
 const target=validateDeviceAccessTarget(await ports.target(anchor.scopeId));ports.current();
 if(target.scopeId!==anchor.scopeId||target.ownerId!==anchor.ownerId||target.kind!==anchor.kind||target.resourceId!==anchor.resourceId)invalid();
 const previous=await ports.checkpoint(anchor.scopeId);ports.current();const response=await ports.directory(anchor.scopeId);ports.current();const frames=new Map<number,VerifiedDirectory>();
 const directory=await verifyDeviceDirectory(anchor.ownerId,anchor.scopeId,target.authority,response.events,previous,value=>{if(value.checkpoint.revision===anchor.directoryRevision)frames.set(value.checkpoint.revision,structuredClone(value));});ports.current();const frame=frames.get(anchor.directoryRevision);
 if(!frame||frame.checkpoint.hash!==anchor.checkpointHash||frame.ownerId!==anchor.ownerId||frame.kind!==anchor.kind||frame.resourceId!==anchor.resourceId||frame.generation!==anchor.generation||frame.securityEpoch!==command.securityEpoch)invalid();
 const signer=frame.devices.get(command.deviceId);if(!signer||signer.revoked||!['owner','writer'].includes(signer.role)||kind==='rotation-packets'&&(signer.role!=='owner'||signer.userId!==anchor.ownerId))invalid();
 await verifyE2eeCommand(packet,await signingPublicKey(signer.signingKey));ports.current();const commandHash=await e2eeCommandHash(command);ports.current();
 const next=response.events[anchor.directoryRevision];
 if(kind==='rotation-packets'){
  if(next){if(await e2eeCommandHash(next.command)!==commandHash)throw new Error('E2EE_MEMBERSHIP_STALE');}
  else{if(confirmed||directory.checkpoint.revision!==anchor.directoryRevision)throw new Error('E2EE_MEMBERSHIP_STALE');
   await verifyDeviceDirectory(anchor.ownerId,anchor.scopeId,target.authority,[...response.events,packet],directory.checkpoint);ports.current();}
 }else{
  exactKeys(command.payload,['intentId','membershipHash','operations']);if(!Array.isArray(command.payload.operations)||command.payload.operations.length<1||command.payload.operations.length>100)invalid();
  for(const operation of command.payload.operations)if(productMutation(operation).action==='propose-complete')invalid();
  if(confirmed&&(!next||next.command.action!=='rotate-membership'||next.command.payload.membershipHash!==command.payload.membershipHash))invalid();
 }
 // Persist only observed signed history; hypothetical approval is never a pin.
 await ports.remember(target,response.events);ports.current();return {actorId:signer.userId,deviceId:signer.deviceId,commandHash};
}
export interface MembershipAtomicReadbackPorts{
 peers:MembershipPeerPorts;current:()=>void;
 /** These mandatory adapters read verified normal repositories; they cannot
  * be replaced with an HTTP response, optimistic cache or generic true value. */
 scope:(packet:SignedE2eeCommand,receipt:MembershipAtomicScopeReceipt)=>Promise<void>;
 product:(packet:SignedE2eeCommand,receipt:MembershipAtomicProductReceipt)=>Promise<void>;
}
/** An immutable receipt is not acknowledgement. Complete plan/packet hashes,
 * signed origins, all pages and ordinary repository readback must agree. */
export class MembershipAtomicReceiptVerifier{
 readonly #plan:MembershipAtomicPlan;readonly #packetRefs:MembershipAtomicPageRef[];readonly #header:MembershipAtomicReceipt;readonly #binding:MembershipAtomicPacketBindings;
 #anchors=new Map<string,MembershipAtomicAnchor>();#planPages=new Set<number>();#packetPages=new Set<number>();#pages=new Map<number,string>();
 #rotations=new Map<string,{packet:SignedE2eeCommand;commandHash:string}>();#products=new Map<string,{packet:SignedE2eeCommand;actorId:string}>();
 #scopes=new Set<string>();#readProducts=new Set<string>();#ready=false;#serial:Promise<unknown>=Promise.resolve();
 constructor(plan:MembershipAtomicPlan,packetPages:MembershipAtomicPageRef[],header:MembershipAtomicReceipt,private readonly ports:MembershipAtomicReadbackPorts){
  this.#plan=validateMembershipAtomicPlan(plan);this.#packetRefs=validateMembershipAtomicRefs(packetPages,true);this.#header=validateMembershipAtomicReceipt(header,this.#plan,this.#packetRefs);this.#binding=new MembershipAtomicPacketBindings(this.#plan);
 }
 #run<T>(action:()=>Promise<T>){const next=this.#serial.catch(()=>undefined).then(action);this.#serial=next;return next;}
 planPage(index:number,input:unknown){this.ports.current();if(this.#ready||this.#packetPages.size||this.#planPages.has(index))invalid();const page=validateMembershipAtomicPage(input);
  if(!same(membershipAtomicPageRef(index,page),this.#plan.pages[index]))invalid();this.#binding.planPage(page);
  if(page.kind==='anchors')for(const anchor of page.items){if(this.#anchors.has(anchor.scopeId))invalid();this.#anchors.set(anchor.scopeId,anchor);}this.#planPages.add(index);
 }
 packetPage(index:number,input:unknown){const page=validateMembershipAtomicPage(input);return this.#run(async()=>{
  this.ports.current();if(this.#ready||this.#planPages.size!==this.#plan.pages.length||this.#packetPages.has(index)||!same(membershipAtomicPageRef(index,page),this.#packetRefs[index]))invalid();
  if(page.kind!=='rotation-packets'&&page.kind!=='product-packets')invalid();
  const verified:Awaited<ReturnType<typeof verifyMembershipAtomicPacket>>[]=[];
  for(const packet of page.items){const anchor=this.#anchors.get(packet.command.scopeId);if(!anchor)invalid();verified.push(await verifyMembershipAtomicPacket(this.#plan,anchor,packet,this.ports.peers,true));this.ports.current();}
  this.#binding.packetPage(page);
  for(const [at,packet]of page.items.entries())if(page.kind==='rotation-packets')this.#rotations.set(packet.command.scopeId,{packet,commandHash:verified[at].commandHash});
   else this.#products.set(packet.command.scopeId+'\0'+packet.command.payload.intentId,{packet,actorId:verified[at].actorId});
  this.#packetPages.add(index);
 });}
 seal(){return this.#run(async()=>{this.ports.current();if(this.#planPages.size!==this.#plan.pages.length||this.#packetPages.size!==this.#packetRefs.length)invalid();this.#binding.complete();this.#ready=true;});}
 consume(index:number,input:unknown){const page=validateMembershipAtomicReceiptPage(input);return this.#run(async()=>{
  this.ports.current();if(!this.#ready)invalid();const ref=membershipAtomicReceiptPageRef(index,page);if(!same(ref,this.#header.pages[index]))invalid();
  const previous=this.#pages.get(index);if(previous){if(previous!==ref.pageHash)invalid();return;}
  if(page.kind==='scopes'){
   for(const row of page.items){const stored=this.#rotations.get(row.scopeId);if(!stored||this.#scopes.has(row.scopeId))invalid();const c=stored.packet.command,p=c.payload;
    const bytes=new TextEncoder().encode(c.checkpointHash+'\0'+stored.commandHash);let checkpoint:string;try{checkpoint=encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}
    if(row.ownerId!==c.ownerId||row.result.directoryRevision!==c.expectedRevision+1||row.result.checkpointHash!==checkpoint||row.result.cryptoEpoch!==p.cryptoEpoch||row.result.securityEpoch!==p.securityEpoch
     ||!Array.isArray(p.revokedDeviceIds)||row.result.signInRequired!==(p.revokedDeviceIds.length>0))invalid();
   }
   for(const row of page.items){await this.ports.scope(structuredClone(this.#rotations.get(row.scopeId)!.packet),structuredClone(row));this.ports.current();}
   for(const row of page.items)this.#scopes.add(row.scopeId);
  }else{
   for(const row of page.items){const key=row.scopeId+'\0'+row.intentId,stored=this.#products.get(key);if(!stored||stored.actorId!==row.actorId||this.#readProducts.has(key))invalid();const operations=(stored.packet.command.payload.operations as unknown[]).map(productMutation);
    if(row.result.results.length!==operations.length)invalid();for(const operation of operations){const result=row.result.results.find(value=>value.entityId===operation.entityId);if(!result||result.revision!==operation.expectedRevision+1||result.payloadHash!==operation.payloadHash)invalid();}
   }
   for(const row of page.items){await this.ports.product(structuredClone(this.#products.get(row.scopeId+'\0'+row.intentId)!.packet),structuredClone(row));this.ports.current();}
   for(const row of page.items)this.#readProducts.add(row.scopeId+'\0'+row.intentId);
  }this.#pages.set(index,ref.pageHash);
 });}
 finish(){return this.#run(async()=>{this.ports.current();if(!this.#ready||this.#pages.size!==this.#header.pages.length||!same([...this.#scopes].sort(),this.#plan.scopeIds)||this.#readProducts.size!==this.#products.size)invalid();return structuredClone(this.#header);});}
}
