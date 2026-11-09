import {sharedCollaborationRequest} from './cloud-sync';
import type {MessagePayload} from './private-message-crypto';
export type ChatKind='direct'|'group'|'project'|'secret';
export type ChatMember={userId:string;name:string;role:string;status:'active'|'pending'|'left';deviceId?:string|null;keyId?:string|null;publicKey?:JsonWebKey|null;revokedAt?:string|null};
export type MessengerChat={id:string;kind:ChatKind;title:string;projectId:string|null;updatedAt:string;unread:number;members:ChatMember[]};
export type MessengerContact={userId:string;name:string;email:string};
export type MessengerMessage={id:string;seq:number;senderId:string;revision:number;text:string|null;payload:MessagePayload|null;createdAt:string;updatedAt:string;deletedAt:string|null};
export type MessengerDevice={id:string;keyId:string;label:string;createdAt:string;lastSeenAt:string;revokedAt:string|null};
export function messengerRequest<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{return sharedCollaborationRequest<T>('/messenger'+path,{method,...(body===undefined?{}:{body:JSON.stringify(body)}),signal});}
export const messengerInbox=(signal?:AbortSignal)=>messengerRequest<{conversations:MessengerChat[];hiddenConversations?:MessengerChat[]}>('/conversations','GET',undefined,signal);
export const messengerChat=(id:string)=>messengerRequest<MessengerChat>('/conversations/'+encodeURIComponent(id));
export const messengerContacts=()=>messengerRequest<{contacts:MessengerContact[];blocked:MessengerContact[]}>('/contacts');
export const messengerProjects=()=>messengerRequest<{projects:{id:string;title:string}[]}>('/projects');
