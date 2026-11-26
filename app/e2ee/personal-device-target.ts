import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {validateDeviceAccessTarget,type DeviceAccessTarget} from './device-access-contract.ts';

const compared=new WeakSet<object>();
/** Created only after the caller compares the independently exchanged public
 * target with the trusted device. Discovery supplies no authority here. */
export class ComparedPersonalDeviceTarget{
 #target:DeviceAccessTarget;
 private constructor(target:DeviceAccessTarget){this.#target=structuredClone(target);compared.add(this);Object.freeze(this);}
 get target(){return structuredClone(this.#target);}
 static compare(input:unknown,fingerprint:string,ownerId:string){const target=validateDeviceAccessTarget(input);
  if(target.kind!=='personal'||target.ownerId!==ownerId||target.resourceId!==ownerId||personalDeviceTargetFingerprint(target)!==fingerprint)throw new Error('E2EE_DEVICE_FINGERPRINT_REQUIRED');
  return new ComparedPersonalDeviceTarget(Object.freeze(structuredClone(target)));
 }
 static require(value:ComparedPersonalDeviceTarget){if(!compared.has(value))throw new Error('E2EE_DEVICE_FINGERPRINT_REQUIRED');return validateDeviceAccessTarget(value.target);}
}
export function personalDeviceTargetFingerprint(input:unknown){const target=validateDeviceAccessTarget(input);if(target.kind!=='personal')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const bytes=canonicalE2eeValue({format:'genesis-personal-device-target-v1',target} as unknown as WireValue);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}
}
