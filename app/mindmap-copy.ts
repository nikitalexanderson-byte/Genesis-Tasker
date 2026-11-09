import copy from './mindmap-feature-copy.json';
import { getRuntimeLanguage } from './i18n';
export type MindmapCopyKey = keyof typeof copy.ru;
export function mindmapCopy(key: MindmapCopyKey, language = getRuntimeLanguage()) {
  return (copy as Record<string, Record<MindmapCopyKey, string>>)[language]?.[key] ?? copy.en[key];
}
