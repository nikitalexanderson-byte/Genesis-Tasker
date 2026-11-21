import {E2eeDeviceDocument} from './device-document.ts';
import {exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {WebPrivateAccount} from './product-session.ts';

export type MessageCell={protocol:1;ownerId:string;name:string;value:unknown};
export type MessagingLocalAccount=Pick<WebPrivateAccount,'ownerId'|'device'|'requireOpen'>;
/** Device-only custody is independent of account/root and message key identity.
 * No transport or flush capability exists here. Old messages keep their keys;
 * content imports can never create a message cell or replay a saved command. */
export class E2eeMessageLocal{
 constructor(private readonly account:MessagingLocalAccount){}
 private async document(name:string){if(name.length<1||name.length>512)throw new Error('E2EE_MESSAGE_CELL_INVALID');const hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name))));this.account.requireOpen();
  return new E2eeDeviceDocument<MessageCell>(this.account.device,`message-cell:${hash}`,value=>{
   exactKeys(value,['protocol','ownerId','name','value']);if(value.protocol!==1||value.ownerId!==this.account.ownerId||value.name!==name)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return value as MessageCell;
  },()=>this.account.requireOpen());
 }
 async read(name:string){this.account.requireOpen();return(await this.document(name)).load();}
 async retain(name:string,value:unknown,expected:number|null){this.account.requireOpen();return(await this.document(name)).save({protocol:1,ownerId:this.account.ownerId,name,value:structuredClone(value)},expected);}
}
