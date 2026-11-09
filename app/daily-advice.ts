import type { Habit } from "./habits";
import { habitLifecycleState } from "./habit-lifecycle.ts";
import affinity from "./daily-advice-affinity.json" with { type: "json" };
import topicAffinity from "./daily-advice-topics.json" with { type: "json" };
import familyAffinity from "./daily-advice-family.json" with { type: "json" };
import {adviceNotificationPreferences,type AdviceNotifications} from './advice-notifications.ts';
import {advicePsychopompiaPreferences,advicePsychopompiaAllowed,type AdvicePsychopompiaPreferences} from './advice-age-access.ts';

export const ADVICE_CATEGORIES = ["aretology", "hermetica", "kourotrophy", "hestiology", "aphrodisia", "psychopompia"] as const;
export type AdviceCategory = typeof ADVICE_CATEGORIES[number];
export const ADVICE_COLLECTIONS = ["aurora", "philosophers"] as const;
export type AdviceCollection = typeof ADVICE_COLLECTIONS[number];
export type AdvicePreferences = { enabled: boolean; smart: boolean; categories: AdviceCategory[]; aphrodisiaAdult?: boolean | null; collections: AdviceCollection[]; philosophersPerDay: number; notifications:AdviceNotifications;psychopompia:AdvicePsychopompiaPreferences };
export type AdviceScores = Record<AdviceCategory, number>;
export const ADVICE_TOPICS = ["nutrition", "training", "recovery", "discipline", "clothing", "attributes", "cleaning", "home_order", "parenting", "sons", "heritage", "fatherhood", "motherhood"] as const;
export type AdviceTopicScores = Record<typeof ADVICE_TOPICS[number], number>;
export type DailyAdvice = {
  id: string; dayKey: string; categories: AdviceCategory[]; title?: string; image?: string; body: string; language: string; dismissed: boolean;
  sources: { author?: string; work: string; reference?: string; kind: "inspired" | "quote" }[];
  aphrodisiaTheme?: "love" | "aesthetics" | "consciousness"; requiresAdult?: boolean; sequence?: number;
  collection?: AdviceCollection;
  subcategories?:string[];containsAlcohol?:boolean;psychopompiaPublished?:boolean;review?:{status?:string};
};
export type DailyAdviceResponse = { dayKey: string; advice: DailyAdvice | null; history?: DailyAdvice[]; state: "disabled" | "empty" | "no-match" | "ready"; sequence?: number; dailyLimit?: number; remaining?: number; canNext?: boolean };

export function todayAdviceHistory(result: DailyAdviceResponse, preferences: AdvicePreferences): DailyAdvice[] {
  const cards = result.history ?? (result.advice ? [{ ...result.advice, sequence: result.sequence ?? 1 }] : []);
  return cards.filter(card => card.dayKey === result.dayKey && adviceCardVisible(card,preferences));
}

export function adviceCardVisible(card:DailyAdvice,preferences:AdvicePreferences):boolean{
  if(!preferences.enabled||card.dismissed||!preferences.collections.includes(card.collection??'aurora'))return false;
  if(card.categories.includes('aphrodisia')&&(!preferences.categories.includes('aphrodisia')||preferences.aphrodisiaAdult==null||(card.requiresAdult&&preferences.aphrodisiaAdult!==true)))return false;
  if(card.categories.includes('psychopompia'))return advicePsychopompiaAllowed(card,preferences.psychopompia,preferences.categories);
  return card.containsAlcohol!==true&&(!card.requiresAdult||card.categories.includes('aphrodisia'));
}

export function advicePreferences(value?: Partial<AdvicePreferences> | null): AdvicePreferences {
  const categories = ADVICE_CATEGORIES.filter(id => (!value?.categories || value.categories.includes(id))
    && (id !== "aphrodisia" || typeof value?.aphrodisiaAdult === "boolean"));
  const collections = ADVICE_COLLECTIONS.filter(id => Array.isArray(value?.collections) && value.collections.includes(id));
  const count = value?.philosophersPerDay;
  const philosophersPerDay = typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 3 ? count : 1;
  return { enabled: value?.enabled !== false, smart: value?.smart !== false, categories: categories.length ? categories : ADVICE_CATEGORIES.filter(id => id !== "aphrodisia"), collections: collections.length ? collections : ["aurora"],
    aphrodisiaAdult: typeof value?.aphrodisiaAdult === "boolean" ? value.aphrodisiaAdult : null, philosophersPerDay, notifications:adviceNotificationPreferences(value?.notifications),psychopompia:advicePsychopompiaPreferences(value?.psychopompia) };
}

function adviceHabitSignals(habits: readonly Habit[], day: string) {
  const signals = [];
  for (const habit of habits) {
    const state = habitLifecycleState(habit, day);
    if (state.status !== "active" || state.conflict || habit.createdDate > day
      || habit.schedule.startDate > day || (habit.schedule.endDate && habit.schedule.endDate < day)) continue;
    const text = `${habit.title} ${habit.description} ${habit.ritualName}`.normalize("NFKC").toLocaleLowerCase();
    const tokens = text.split(/[^\p{L}\p{N}]+/u);
    const weight = 1 + (habit.isKeyHabit ? 1 : 0) + Math.min(3, Math.max(0, habit.priority || 0)) / 3;
    signals.push({ habit, tokens, weight });
  }
  return signals;
}

function adviceWordMatches(tokens: string[], words: readonly string[], exactShort = false) {
  return words.reduce((count, word) => count + (tokens.some(token => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)
    ? token.includes(word) : (exactShort && word.length <= 3) || (word.length <= 4 && /^[a-z]+$/.test(word)) ? token === word : token.startsWith(word)) ? 1 : 0), 0);
}

/** Only bounded numeric affinities leave the device. Habit text stays local. */
export function adviceHabitScores(habits: readonly Habit[], day: string): AdviceScores {
  const scores = Object.fromEntries(ADVICE_CATEGORIES.map(id => [id, 0])) as AdviceScores;
  for (const { habit, tokens, weight } of adviceHabitSignals(habits, day)) {
    for (const id of ADVICE_CATEGORIES) {
      const rule = affinity[id];
      const templateMatch = (rule.templates as string[]).includes(habit.sourceTemplateId || "");
      const practiceMatch = (rule.sectors as string[]).includes(habit.sacredSectorId || "");
      const words = adviceWordMatches(tokens, rule.words);
      scores[id] = Math.min(1000, scores[id] + weight * (Number(templateMatch) * 3 + Number(practiceMatch) * 2 + Math.min(3, words)));
    }
  }
  return scores;
}

/** Topic interests stay numeric; no demographic or health profile is inferred. */
export function adviceHabitTopicScores(habits: readonly Habit[], day: string): AdviceTopicScores {
  const scores = Object.fromEntries(ADVICE_TOPICS.map(id => [id, 0])) as AdviceTopicScores;
  for (const { habit, tokens, weight } of adviceHabitSignals(habits, day)) {
    for (const id of ADVICE_TOPICS) {
      const rule = id in familyAffinity ? familyAffinity[id as keyof typeof familyAffinity] : topicAffinity[id as keyof typeof topicAffinity];
      const templateMatch = (rule.templates as string[]).includes(habit.sourceTemplateId || "");
      const words = adviceWordMatches(tokens, rule.words, id in familyAffinity);
      scores[id] = Math.min(1000, scores[id] + weight * (Number(templateMatch) * 3 + Math.min(3, words)));
    }
  }
  return scores;
}

export type AdvicePersonalTask = { title: string; description?: string; done: boolean; entryType?: string; dueDate?: string };

/** This input is the private task collection, never shared-project tasks. Only numeric scores leave the device. */
export function adviceTaskContext(tasks: readonly AdvicePersonalTask[], day: string) {
  const scores = Object.fromEntries(ADVICE_CATEGORIES.map(id => [id, 0])) as AdviceScores;
  const topics = Object.fromEntries(ADVICE_TOPICS.map(id => [id, 0])) as AdviceTopicScores;
  for (const task of tasks) {
    if (task.done || (task.entryType && task.entryType !== "task")) continue;
    // Unscheduled, current, overdue and near-future intentions matter; distant plans do not dominate today.
    if (task.dueDate && task.dueDate > day && (Date.parse(task.dueDate) - Date.parse(day)) / 86400000 > 30) continue;
    const tokens = `${task.title} ${task.description ?? ""}`.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u);
    for (const topic of ["parenting", "sons", "heritage", "fatherhood", "motherhood"] as const) {
      const count = adviceWordMatches(tokens, familyAffinity[topic].words, true);
      if (count) {
        topics[topic] = Math.min(1000, topics[topic] + Math.min(3, count) * 4);
        scores.kourotrophy = Math.min(1000, scores.kourotrophy + (topic === "motherhood" ? 1 : 4));
      }
    }
    for (const topic of ["clothing", "attributes", "cleaning", "home_order"] as const) {
      let count = adviceWordMatches(tokens, topicAffinity[topic].words);
      if (topic === "clothing" && !adviceWordMatches(tokens, topicAffinity.clothing.shoppingExclusions)) {
        count += adviceWordMatches(tokens, topicAffinity.clothing.shoppingWords);
      }
      if (count) { topics[topic] = Math.min(1000, topics[topic] + Math.min(3, count) * 4); scores.hestiology = Math.min(1000, scores.hestiology + 4); }
    }
    const buying = adviceWordMatches(tokens, topicAffinity.attributes.purchaseWords);
    if (buying && adviceWordMatches(tokens, topicAffinity.attributes.genericWords)) {
      topics.attributes = Math.min(1000, topics.attributes + 8); scores.hestiology = Math.min(1000, scores.hestiology + 4);
    }
  }
  return { scores, topics };
}

export function adviceAvailableCategories(value?: readonly AdviceCategory[]): AdviceCategory[] {
  // A cached account from before this release has no availability metadata yet.
  return ADVICE_CATEGORIES.filter(id => (value ?? ["aretology", "hermetica", "kourotrophy", "hestiology"]).includes(id));
}
