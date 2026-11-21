import { canonicalE2eeValue, commandBytes, e2eeCommandHash, snapshotE2eeValue, verifyE2eeCommand, type SignedE2eeCommand, type WireValue } from './commands.ts';
import { decodeE2eeBytes, encodeE2eeBytes, type E2eeContext } from './envelope.ts';
import { assertTechnical, exactKeys, type PublicDeviceKeys, type RecoveryKit, type RootCapsule } from './keys.ts';

export type DirectoryCheckpoint = { revision: number; hash: string };
export type DeviceRole = 'owner'|'writer'|'commenter'|'reader';
export type HistoricalRoot = { cryptoEpoch:number; keyId:string; capsule:RootCapsule };
export type VerifiedDevice = PublicDeviceKeys & { deviceId: string; userId: string; role: DeviceRole; revoked: boolean; capsule: RootCapsule; historyCapsules:HistoricalRoot[] };
export type VerifiedDirectory = { ownerId: string; scopeId: string; resourceId: string; kind: 'personal'|'project'|'space';
  cryptoEpoch: number; securityEpoch: number; keyId: string; generation: number; state: 'preparing'|'active';
  checkpoint: DirectoryCheckpoint; recoveryKit: RecoveryKit; recoveryCapsule: RootCapsule; devices: Map<string, VerifiedDevice>;
  sealedHeads:{cryptoEpoch:number;hash:string;count:number}|null };
export async function signingPublicKey(spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', decodeE2eeBytes(spki, 91), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}
function requireState(ok: boolean): asserts ok { if (!ok) throw new Error('E2EE_UNTRUSTED_DIRECTORY'); }
function objectPayload(value: WireValue): Record<string, WireValue> {
  requireState(!!value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, WireValue>;
}
/** Rebuilds trust from signatures. The server's devices/approved flags are not consulted.
 * pin is saved independently (recovery kit or a trusted-device QR/fingerprint exchange).
 * A fresh client without such a pin cannot claim to detect a complete server fork/rollback.
 */
export async function verifyDeviceDirectory(ownerId: string, scopeId: string, pinnedAuthority: PublicDeviceKeys,
  events: SignedE2eeCommand[], previous?: DirectoryCheckpoint, onVerified?:(directory:VerifiedDirectory)=>void): Promise<VerifiedDirectory> {
  assertTechnical(ownerId); assertTechnical(scopeId); exactKeys(pinnedAuthority, ['signingKey', 'receivingKey']);
  if (!Array.isArray(events) || events.length < 1 || events.length > 2048) throw new Error('E2EE_UNTRUSTED_DIRECTORY');
  pinnedAuthority = snapshotE2eeValue(pinnedAuthority);
  events = snapshotE2eeValue(events);
  previous = previous ? snapshotE2eeValue(previous) : undefined;
  const authority = await signingPublicKey(pinnedAuthority.signingKey);
  let directory: VerifiedDirectory | undefined, checkedPrevious = !previous;
  const epochs=new Map<number,string>();
  // Snapshot network input before the first async operation; accessors are rejected by the encoder.
  for (const event of events) commandBytes(event.command);
  const packets = JSON.parse(JSON.stringify(events)) as SignedE2eeCommand[];
  for (let index = 0; index < packets.length; index++) {
    const packet = packets[index], command = packet.command;
    requireState(command.ownerId === ownerId && command.scopeId === scopeId);
    if (!directory) {
      requireState(command.action === 'bootstrap' && command.expectedRevision === 0 && command.checkpointHash === 'genesis' && command.securityEpoch === 1);
      await verifyE2eeCommand(packet, authority);
      const payload = command.payload;
      const kit = payload.recoveryKit as unknown as RecoveryKit;
      requireState(kit.protocol === 1 && kit.ownerId === ownerId
        && kit.authority.signingKey === pinnedAuthority.signingKey && kit.authority.receivingKey === pinnedAuthority.receivingKey);
      const publicKeys = objectPayload(payload.deviceKeys);
      requireState(typeof publicKeys.signingKey === 'string' && typeof publicKeys.receivingKey === 'string');
      const self = structuredClone(command); delete self.payload.selfProof;
      await verifyE2eeCommand({ command: self, signature: payload.selfProof as string }, await signingPublicKey(publicKeys.signingKey));
      requireState(['personal','project','space'].includes(payload.kind as string));
      assertTechnical(payload.resourceId); assertTechnical(payload.keyId);
      requireState(Number.isSafeInteger(payload.generation) && (payload.generation as number) >= 1);
      directory = { ownerId, scopeId, resourceId: payload.resourceId, kind: payload.kind as VerifiedDirectory['kind'], cryptoEpoch: 1, securityEpoch: 1,
        keyId: payload.keyId, generation: payload.generation as number, state: 'preparing', checkpoint: { revision: 1, hash: await e2eeCommandHash(command) },
        recoveryKit: kit, recoveryCapsule: payload.recoveryCapsule as unknown as RootCapsule, sealedHeads:null,
        devices: new Map([[command.deviceId, { ...publicKeys as PublicDeviceKeys, deviceId: command.deviceId, userId: ownerId, role: 'owner', revoked: false,
          capsule: payload.deviceCapsule as unknown as RootCapsule, historyCapsules:[] }]]) };
      epochs.set(1,payload.keyId);
    } else {
      requireState(command.expectedRevision === directory.checkpoint.revision && command.checkpointHash === directory.checkpoint.hash
        && command.securityEpoch === directory.securityEpoch);
      const signer = directory.devices.get(command.deviceId);
      // Directory authority belongs to the pinned owner. An ACL boolean or a valid
      // reader signature cannot delegate authority over future encryption keys.
      requireState(command.deviceId === 'recovery' || (!!signer && !signer.revoked && signer.userId === ownerId && signer.role === 'owner'));
      await verifyE2eeCommand(packet, command.deviceId === 'recovery' ? authority : await signingPublicKey(signer!.signingKey));
      const payload = command.payload;
      if (command.action === 'enroll') {
        const challenge = objectPayload(payload.challenge);
        requireState(challenge.scopeId === scopeId && typeof challenge.deviceId === 'string' && !directory.devices.has(challenge.deviceId)
          && typeof challenge.userId === 'string' && (directory.kind !== 'personal' || challenge.userId === ownerId));
        assertTechnical(challenge.deviceId); assertTechnical(challenge.userId);
        requireState(['owner','writer','commenter','reader'].includes(challenge.role as string)
          && (challenge.role === 'owner') === (challenge.userId === ownerId));
        requireState(typeof challenge.signingKey === 'string' && typeof challenge.receivingKey === 'string');
        requireState(Array.isArray(payload.historyCapsules)&&payload.historyCapsules.length===epochs.size-1);
        const historical=new Set<number>();
        for(const entry of payload.historyCapsules) {
          const grant=objectPayload(entry);requireState(typeof grant.cryptoEpoch==='number'&&grant.cryptoEpoch<directory.cryptoEpoch
            &&!historical.has(grant.cryptoEpoch)&&epochs.get(grant.cryptoEpoch)===grant.keyId);historical.add(grant.cryptoEpoch);
        }
        await signingPublicKey(challenge.signingKey); decodeE2eeBytes(challenge.receivingKey, 65);
        const enrollmentPrefix = new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0');
        const challengeBytes = canonicalE2eeValue(challenge), proofBytes = new Uint8Array(enrollmentPrefix.length + challengeBytes.length);
        proofBytes.set(enrollmentPrefix); proofBytes.set(challengeBytes,enrollmentPrefix.length);
        requireState(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await signingPublicKey(challenge.signingKey),
          decodeE2eeBytes(payload.selfProof,64),proofBytes));
        directory.devices.set(challenge.deviceId, { deviceId: challenge.deviceId, userId: challenge.userId, role: challenge.role as DeviceRole, signingKey: challenge.signingKey,
          receivingKey: challenge.receivingKey, revoked: false, capsule: payload.capsule as unknown as RootCapsule, historyCapsules:payload.historyCapsules as unknown as HistoricalRoot[] });
      } else if (command.action === 'rotate'||command.action==='rotate-membership') {
        decodeE2eeBytes(payload.retiredManifestHash,32);
        requireState(Number.isSafeInteger(payload.retiredObjectCount)&&(payload.retiredObjectCount as number)>=0&&(payload.retiredObjectCount as number)<=10000);
        directory.sealedHeads={cryptoEpoch:directory.cryptoEpoch,hash:payload.retiredManifestHash as string,count:payload.retiredObjectCount as number};
        requireState(payload.cryptoEpoch === directory.cryptoEpoch + 1 && payload.securityEpoch === directory.securityEpoch + 1
          && ![...epochs.values()].includes(payload.keyId as string) && typeof payload.keyId === 'string' && Array.isArray(payload.revokedDeviceIds) && Array.isArray(payload.capsules));
        for (const id of payload.revokedDeviceIds) {
          requireState(typeof id === 'string' && !!directory.devices.get(id) && !directory.devices.get(id)!.revoked);
          directory.devices.get(id)!.revoked = true;
        }
        const updated = new Set<string>();
        for (const item of payload.capsules) {
          const entry = objectPayload(item);
          requireState(typeof entry.deviceId === 'string' && !updated.has(entry.deviceId));
          const device = directory.devices.get(entry.deviceId);
          requireState(!!device && !device.revoked);
          device.historyCapsules.push({cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,capsule:device.capsule});
          device.capsule = entry.capsule as unknown as RootCapsule; updated.add(entry.deviceId);
        }
        requireState([...directory.devices.values()].every(device => device.revoked || updated.has(device.deviceId)));
        if(command.action==='rotate-membership'){
          decodeE2eeBytes(payload.membershipHash,32);requireState(Array.isArray(payload.roleChanges)&&payload.roleChanges.length===updated.size);const changed=new Set<string>();
          for(const raw of payload.roleChanges){const change=objectPayload(raw);requireState(Object.keys(change).length===2&&typeof change.deviceId==='string'&&updated.has(change.deviceId)&&!changed.has(change.deviceId));
            const device=directory.devices.get(change.deviceId)!;requireState(['owner','writer','commenter','reader'].includes(String(change.role))&&(change.role==='owner')===(device.userId===ownerId));
            device.role=change.role as DeviceRole;changed.add(change.deviceId);}
        }
        directory.cryptoEpoch++; directory.securityEpoch++; directory.keyId = payload.keyId;
        epochs.set(directory.cryptoEpoch,directory.keyId);
        directory.recoveryCapsule = payload.recoveryCapsule as unknown as RootCapsule;
      } else requireState(command.action === 'migration-commit' && directory.state === 'preparing');
      if (command.action === 'migration-commit') {
        requireState(Number.isSafeInteger(payload.generation) && (payload.generation as number) >= directory.generation);
        decodeE2eeBytes(payload.manifestHash,32);requireState(Number.isSafeInteger(payload.objectCount)&&(payload.objectCount as number)>=0&&(payload.objectCount as number)<=10000);
        directory.sealedHeads={cryptoEpoch:0,hash:payload.manifestHash as string,count:payload.objectCount as number};
        directory.state = 'active'; directory.generation = payload.generation as number;
      }
      const digest = new TextEncoder().encode(`${directory.checkpoint.hash}\0${await e2eeCommandHash(command)}`);
      directory.checkpoint = { revision: directory.checkpoint.revision + 1,
        hash: encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', digest))) };
    }
    if (previous?.revision === directory.checkpoint.revision) {
      requireState(previous.hash === directory.checkpoint.hash); checkedPrevious = true;
    }
    // A detached frame for provisional history collection only. Whole-chain
    // trust, the saved checkpoint and durable CAS still require final success.
    onVerified?.(structuredClone(directory));
  }
  requireState(!!directory && checkedPrevious);
  return directory;
}

/** Fingerprint contains only public keys and the verified checkpoint. Compare out of band. */
export async function directoryFingerprint(directory: VerifiedDirectory) {
  return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalE2eeValue({
    ownerId: directory.ownerId, scopeId: directory.scopeId, authority: directory.recoveryKit.authority,
    revision: directory.checkpoint.revision, checkpointHash: directory.checkpoint.hash,
  }))));
}

/** Resolve content authority from the signed roster at this envelope's epoch.
 * Historical envelopes require their verified historical directory, never an
 * unsigned server role or the latest revoked-device boolean. */
export async function contentSigningKey(directory:VerifiedDirectory,context:E2eeContext):Promise<CryptoKey> {
  requireState(context.domain!=='shared-comment'||context.revision===1);
  requireState(context.ownerId===directory.ownerId&&context.scopeId===directory.scopeId
    &&context.cryptoEpoch===directory.cryptoEpoch&&context.securityEpoch===directory.securityEpoch
    &&context.keyId===directory.keyId&&context.dataGeneration===directory.generation);
  const device=directory.devices.get(context.deviceId);
  requireState(!!device&&!device.revoked&&(device.role==='owner'||device.role==='writer'
    ||device.role==='commenter'&&context.domain==='shared-comment'));
  requireState(directory.kind==='personal'? !['shared-project','shared-comment'].includes(context.domain)
    :['shared-project','shared-comment','mindmap','attachment','key-check'].includes(context.domain));
  return signingPublicKey(device.signingKey);
}
