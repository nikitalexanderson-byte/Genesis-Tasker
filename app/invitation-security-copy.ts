import copy from '../contracts/e2ee/invitation-recipient-copy-v1.json';
export function invitationSecurityCopy(language:string){return copy[language as keyof typeof copy]??copy.en;}
