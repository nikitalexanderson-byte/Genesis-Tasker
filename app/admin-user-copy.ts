import copy from "./admin-user-copy.json";
import { getRuntimeLanguage } from "./i18n";
export function adminUserCopy(key: keyof typeof copy.ru) {
  return copy[getRuntimeLanguage()]?.[key] ?? copy.en[key];
}
