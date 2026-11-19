import {signE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {E2EE_DOMAINS,decodeE2eeBytes,validateE2eeEnvelope,type E2eeContext,type E2eeEnvelope} from './envelope.ts';
import {assertTechnical} from './keys.ts';
import type {VerifiedDirectory} from './directory.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import type {MigrationTransport,MigrationSourceContext} from './migration.ts';

export type E2eeMigrationRequest=(path:'/source'|'/command'|'/read',body:unknown)=>Promise<Record<string,WireValue>>;
/** Signed, paginated shadow readback through the real authenticated channel.
 * The source request must only be reached by the coordinator after prepare(). */
export class SignedMigrationTransport implements MigrationTransport {
  #device:UnlockedWebDevice;#owner:string;#scope:string;#securityEpoch:number;#revision:number;#checkpoint:string;
  #domains:readonly E2eeContext['domain'][];#request:E2eeMigrationRequest;
  constructor(device:UnlockedWebDevice,directory:VerifiedDirectory,domains:readonly E2eeContext['domain'][],request:E2eeMigrationRequest){
    this.#device=device;this.#owner=directory.ownerId;this.#scope=directory.scopeId;this.#securityEpoch=directory.securityEpoch;
    this.#revision=directory.checkpoint.revision;this.#checkpoint=directory.checkpoint.hash;this.#request=request;
    assertTechnical(this.#owner);assertTechnical(this.#scope);
    if(domains.length<1||domains.some(domain=>!E2EE_DOMAINS.includes(domain)))throw new Error('E2EE_COVERAGE_REQUIRED');
    this.#domains=Object.freeze([...new Set([...domains,'attachment' as const])]);
  }
  async #call(path:'/source'|'/command'|'/read',body:unknown){
    this.#device.requireOpen();const response=await this.#request(path,body);this.#device.requireOpen();return response;
  }
  async sourceHash(){const result=await this.#call('/source',{scopeId:this.#scope});decodeE2eeBytes(result.sourceHash,32);return result.sourceHash as string;}
  async command(packet:SignedE2eeCommand){
    if(packet.command.ownerId!==this.#owner||packet.command.scopeId!==this.#scope||packet.command.deviceId!==this.#device.deviceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    return this.#call('/command',packet);
  }
  async legacyWorkspace(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-workspace',context);
  }
  async legacyAurora(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-aurora',context);
  }
  async legacyStoicheion(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-stoicheion',context);
  }
  async legacyAdvice(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-advice',context);
  }
  async legacyTasks(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-tasks',context);
  }
  async legacyDiary(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-diary',context);
  }
  async legacyMindmaps(context:MigrationSourceContext):Promise<unknown>{
    return this.#legacyPersonal('legacy-mindmaps',context);
  }
  async legacyMindmapsPage(context:MigrationSourceContext,table:string,offset:number):Promise<unknown>{
    if(!['maps','versions','receipts','deletions'].includes(table)||!Number.isSafeInteger(offset)||offset<0||offset>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_LEGACY_PAGE_INVALID');
    return this.#legacyPersonal('legacy-mindmaps',context,{table,offset});
  }
  async legacyPhysisPage(context:MigrationSourceContext,table:string,offset:number):Promise<unknown>{
    if(!['owners','records','usedIds','receipts'].includes(table)||!Number.isSafeInteger(offset)||offset<0||offset>=Number.MAX_SAFE_INTEGER)throw new Error('E2EE_LEGACY_PAGE_INVALID');
    return this.#legacyPersonal('legacy-physis',context,{table,offset});
  }
  async #legacyPersonal(action:'legacy-workspace'|'legacy-aurora'|'legacy-stoicheion'|'legacy-advice'|'legacy-tasks'|'legacy-diary'|'legacy-mindmaps'|'legacy-physis',context:MigrationSourceContext,page?:{table:string;offset:number}):Promise<unknown>{
    if(context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const packet=await signE2eeCommand({protocol:1,ownerId:this.#owner,scopeId:this.#scope,deviceId:this.#device.deviceId,action,
      expectedRevision:this.#revision,checkpointHash:this.#checkpoint,securityEpoch:this.#securityEpoch,operationId:crypto.randomUUID(),
      payload:{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,...page}},this.#device.keys().signing.privateKey);
    const response=await this.#call('/read',packet);
    if(response.checkpointHash!==this.#checkpoint||response.directoryRevision!==this.#revision)throw new Error('E2EE_DIRECTORY_CONFLICT');
    return response;
  }
  async readAll():Promise<E2eeEnvelope[]>{
    const result:E2eeEnvelope[]=[];let bytes=0;
    for(const domain of this.#domains){
      let after='';
      for(;;){
        this.#device.requireOpen();
        const packet=await signE2eeCommand({protocol:1,ownerId:this.#owner,scopeId:this.#scope,deviceId:this.#device.deviceId,action:'read',
          expectedRevision:this.#revision,checkpointHash:this.#checkpoint,securityEpoch:this.#securityEpoch,operationId:crypto.randomUUID(),payload:{domain,after,limit:50}},this.#device.keys().signing.privateKey);
        const page=await this.#call('/read',packet);
        if(page.directoryRevision!==this.#revision||page.checkpointHash!==this.#checkpoint)throw new Error('E2EE_DIRECTORY_CONFLICT');
        if(!Array.isArray(page.envelopes)||page.envelopes.length>50)throw new Error('E2EE_INVALID_RESPONSE');
        if(page.envelopes.length===0)break;
        for(const raw of page.envelopes){
          const envelope=validateE2eeEnvelope(raw),ctx=envelope.context;
          if(ctx.ownerId!==this.#owner||ctx.scopeId!==this.#scope||ctx.domain!==domain||ctx.objectId<=after)throw new Error('E2EE_INVALID_RESPONSE');
          after=ctx.objectId;bytes+=JSON.stringify(envelope).length;
          if(result.length>=8000||bytes>256*1024*1024)throw new Error('E2EE_MIGRATION_TOO_LARGE');
          result.push(envelope);
        }
        // A server byte cap may return fewer than50; only an empty page proves EOF.
      }
    }
    return result;
  }
}
