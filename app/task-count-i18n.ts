import type { Language } from "./i18n";

export const TASK_SUMMARY_LABELS: Record<Language, { total: string; active: string; completed: string; list: string }> = {
  ru: { total: "всего", active: "активных", completed: "завершено", list: "Список" },
  en: { total: "total", active: "active", completed: "completed", list: "List" },
  el: { total: "συνολικά", active: "ενεργές", completed: "ολοκληρωμένες", list: "Λίστα" },
  de: { total: "insgesamt", active: "offen", completed: "erledigt", list: "Liste" },
  fr: { total: "au total", active: "en cours", completed: "terminées", list: "Liste" },
  es: { total: "en total", active: "activas", completed: "completadas", list: "Lista" },
  it: { total: "totali", active: "attive", completed: "completate", list: "Elenco" },
  pt: { total: "no total", active: "ativas", completed: "concluídas", list: "Lista" },
  pl: { total: "łącznie", active: "aktywne", completed: "ukończone", list: "Lista" },
  sr: { total: "укупно", active: "активних", completed: "завршених", list: "Списак" },
  uk: { total: "усього", active: "активних", completed: "завершених", list: "Список" },
  zh: { total: "总计", active: "进行中", completed: "已完成", list: "列表" },
  tr: { total: "toplam", active: "etkin", completed: "tamamlanan", list: "Liste" },
  ja: { total: "合計", active: "進行中", completed: "完了", list: "リスト" },
};

function slavicForm(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

export function formatTaskCount(count: number, language: Language): string {
  const noun = (() => {
    switch (language) {
      case "ru": return slavicForm(count, "задача", "задачи", "задач");
      case "uk": return slavicForm(count, "завдання", "завдання", "завдань");
      case "pl": return count === 1 ? "zadanie" : count % 100 >= 12 && count % 100 <= 14
        ? "zadań" : count % 10 >= 2 && count % 10 <= 4 ? "zadania" : "zadań";
      case "sr": return slavicForm(count, "задатак", "задатка", "задатака");
      case "en": return count === 1 ? "task" : "tasks";
      case "el": return count === 1 ? "εργασία" : "εργασίες";
      case "de": return count === 1 ? "Aufgabe" : "Aufgaben";
      case "fr": return count === 1 ? "tâche" : "tâches";
      case "es": return count === 1 ? "tarea" : "tareas";
      case "it": return "attività";
      case "pt": return count === 1 ? "tarefa" : "tarefas";
      case "tr": return "görev";
      case "zh": return "项任务";
      case "ja": return "件のタスク";
    }
  })();
  return `${count} ${noun}`;
}

export function formatTaskListCount(count: number, language: Language): string {
  return `${TASK_SUMMARY_LABELS[language].list} · ${formatTaskCount(count, language)}`;
}

export function formatProjectCount(count: number, language: Language): string {
  if(language==='ru')return `${count} ${slavicForm(count,'проект','проекта','проектов')}`;
  if(language==='uk')return `${count} ${slavicForm(count,'проєкт','проєкти','проєктів')}`;
  if(language==='sr')return `${count} ${slavicForm(count,'пројекат','пројекта','пројеката')}`;
  if(language==='pl')return `${count} ${count===1?'projekt':count%100>=12&&count%100<=14?'projektów':count%10>=2&&count%10<=4?'projekty':'projektów'}`;
  const forms={en:['project','projects'],el:['έργο','έργα'],de:['Projekt','Projekte'],fr:['projet','projets'],es:['proyecto','proyectos'],it:['progetto','progetti'],pt:['projeto','projetos'],zh:['个项目','个项目'],tr:['proje','proje'],ja:['件のプロジェクト','件のプロジェクト']};
  return `${count} ${forms[language][count===1?0:1]}`;
}
