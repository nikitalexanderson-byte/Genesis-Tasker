import copy from './messenger-copy.json';
export function messengerText(key:keyof typeof copy.ru,language:string):string{return ((copy as Record<string,Record<string,string>>)[language]??copy.en)[key]??copy.en[key];}
