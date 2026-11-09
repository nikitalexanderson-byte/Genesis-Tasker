import type {Language} from './i18n';
import translations from './sprint-report-translations.json';
export type SprintReportCopyKey=keyof typeof translations.ru;
const copy:Record<Language,Record<SprintReportCopyKey,string>>=translations;
export const sprintReportText=(key:SprintReportCopyKey,language:Language)=>copy[language][key];
