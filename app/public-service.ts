import releaseLegalCopy from "./release-318-legal-copy.json";
import refundContactCopy from './refund-contact-copy.json';
export const SUPPORT_TIPS_URL = "https://pay.cloudtips.ru/p/4d58d20a";
export const SERVICE_CONTACT = "nikitalexanderson@gmail.com";
export const DOMAIN_CONTACT = "demiurge.soft@gmail.com";
export const REFUND_CONTACTS = [SERVICE_CONTACT,DOMAIN_CONTACT] as const;
export function refundContactLabel(language:string):string {
  return refundContactCopy[language as keyof typeof refundContactCopy]??refundContactCopy.en;
}
export const SERVICE_IDENTITY = { ru: releaseLegalCopy.ru.identity, en: releaseLegalCopy.en.identity };
