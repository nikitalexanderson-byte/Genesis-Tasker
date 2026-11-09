import copy from "./gantt-copy.json";
import { getRuntimeLanguage } from "./i18n";

export function ganttCopy(key: keyof typeof copy.ru) {
  return copy[getRuntimeLanguage()]?.[key] ?? copy.en[key];
}
