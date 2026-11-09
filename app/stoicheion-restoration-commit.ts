import type { CalendarMode } from "./calendar-data";
import type { Language } from "./i18n";
import type { Habit } from "./habits";
import { SACRED_PRACTICES } from "./sacred-practices";
import { getStoicheionLetters } from "./stoicheion-data";
import { RESTORATION_AUXILIARIES, RESTORATION_LETTER_FOCI, RESTORATION_SECTORS } from "./stoicheion-restoration-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import { createRestorationHabit, isEligibleRestorationHabit } from "./stoicheion-restoration-habits";
import { normalizeRestorationSnapshot, RESTORATION_POSITION_IDS } from "./stoicheion-restoration-state";
import { restorationPlanEquation, restorationPlanReady, reversedSectors, snapshotMatchesSource,
  validateRestorationStrategy, type RestorationStrategy, type RestorationPlan, type RestorationSource } from "./stoicheion-restoration-strategy";
import { markTrackerEntityChanged } from "./tracker-core";
import { defaultPracticeGoal } from "./habit-practice-goal";
import { habitRuleForDate, normalizeHabitRuleHistory } from "./habit-measurement";
import { habitRuleFrontier } from "./habit-rule-history";
import { calendarModeForRecurrence } from "./task-recurrence";
import { restorationExpired, restorationWorks, workFromSnapshot, type RestorationWork, type RestorationWorkspace } from "./stoicheion-restoration-work";

export function restorationRecommendation(source: RestorationSource, sectorId: string, plan: Pick<RestorationPlan, "need" | "supportIds" | "resourceLetterId">, language: Language) {
  const local = (value: { ru: string; en: string }) => restorationLocal(value, language);
  const sector = RESTORATION_SECTORS.find(item => item.id === sectorId)!;
  const guidance = sector.needs[plan.need];
  const card = source.cards[RESTORATION_POSITION_IDS.indexOf(sectorId as typeof RESTORATION_POSITION_IDS[number])];
  const focus = RESTORATION_LETTER_FOCI[card.letterId];
  const letters = getStoicheionLetters(language);
  const resource = letters.find(item => item.id === plan.resourceLetterId);
  const helpers = RESTORATION_AUXILIARIES.filter(item => plan.supportIds.includes(item.id));
  return {
    practiceText: [local(guidance.practice), local(focus.needs[plan.need].practice), resource
      ? `${resource.symbol} · ${resource.name}: ${local(RESTORATION_LETTER_FOCI[resource.id].quality)}` : ""].filter(Boolean).join("\n\n"),
    action: [local(guidance.action), local(focus.needs[plan.need].action), ...helpers.map(item => {
      const practice = SACRED_PRACTICES.find(practice => practice.id === item.practiceId)!;
      return `${local(practice.title)}: ${local(practice.description)}`;
    })].join("\n\n"),
  };
}

/** Prepare every update before changing the workspace: a rejected card saves nothing. */
export function materializeRestorationStrategy(input: RestorationStrategy, workspace: RestorationWorkspace,
  options: { today: string; startedAt: string; calendarMode: CalendarMode; language: Language }): RestorationWorkspace {
  const strategy = validateRestorationStrategy(input);
  if (restorationExpired(strategy.sourceDate, options.today) || options.today < strategy.sourceDate) throw new RangeError("PRACTICE_DIVINATION_EXPIRED");
  if (!workspace.habitSettings.enabled && reversedSectors(strategy).some(id => !strategy.plans[id].withoutHabit)) throw new Error("RESTORATION_TRACKING_DISABLED");
  const works = restorationWorks(workspace, options.today);
  const letters = getStoicheionLetters(options.language);
  const updates: Habit[] = [];
  const workUpdates: RestorationWork[] = [];
  const used = new Set<string>();
  for (const sectorId of reversedSectors(strategy)) {
    if (works.some(work => work.snapshot.sectorId === sectorId && snapshotMatchesSource(work.snapshot, strategy))) continue;
    const plan = strategy.plans[sectorId];
    if (!restorationPlanReady(strategy, sectorId, plan)) throw new Error("RESTORATION_STRATEGY_INCOMPLETE");
    if (plan.linkedHabitId && used.has(plan.linkedHabitId)) throw new Error("RESTORATION_DUPLICATE_HABIT");
    if (plan.linkedHabitId) used.add(plan.linkedHabitId);
    const sector = RESTORATION_SECTORS.find(item => item.id === sectorId)!;
    const card = strategy.cards[RESTORATION_POSITION_IDS.indexOf(sectorId as typeof RESTORATION_POSITION_IDS[number])];
    const equation = restorationPlanEquation(strategy, sectorId, plan);
    const recommendation = restorationRecommendation(strategy, sectorId, plan, options.language);
    // Storage bounds must never silently cut off a selected helper's instructions.
    if (recommendation.action.length > 1600 || recommendation.practiceText.length > 1600) throw new Error("RESTORATION_TEXT_TOO_LONG");
    const snapshot = normalizeRestorationSnapshot({
      ...strategy, ...plan, ...recommendation, sectorId, letterId: card.letterId,
      cycleId: `${strategy.sourceDate}:${strategy.sourceSeed}:${sectorId}:${card.letterId}`,
      startedAt: options.startedAt, startedDate: options.today,
      excludeStartDate: Boolean(plan.linkedHabitId && workspace.habitCompletions.some(entry => entry.habitId === plan.linkedHabitId && entry.date === options.today && entry.completed)),
      practiceId: sector.needs[plan.need].practiceId,
      spreadTotal: strategy.cards.reduce((sum, item) => sum + letters.find(letter => letter.id === item.letterId)!.value, 0),
      pythmen: equation.target, reflection: "",
    });
    if (!snapshot) throw new Error("RESTORATION_SNAPSHOT_INVALID");
    if (plan.withoutHabit) {
      workUpdates.push(workFromSnapshot(snapshot, null));
    } else if (plan.linkedHabitId) {
      const previous = workspace.habits.find(habit => habit.id === plan.linkedHabitId && isEligibleRestorationHabit(habit));
      if (!previous) throw new Error("RESTORATION_HABIT_UNAVAILABLE");
      const practice = SACRED_PRACTICES.find(item => item.id === snapshot.practiceId)!;
      const finite = createRestorationHabit(practice, snapshot, calendarModeForRecurrence(previous.schedule.recurrence.mode), options.language, previous.title);
      const baseline = habitRuleForDate(previous, previous.createdDate), heads = habitRuleFrontier(previous);
      if (heads.length > 1) throw new Error("RESTORATION_HABIT_UNAVAILABLE");
      const schedule = { ...finite.schedule, startDate: previous.schedule.startDate,
        recurrence: { ...finite.schedule.recurrence, rangeStart: previous.schedule.startDate } };
      updates.push(markTrackerEntityChanged({ ...previous, stoicheionRestoration: snapshot,
        practiceGoal: defaultPracticeGoal(options.today), schedule, ruleHistory: normalizeHabitRuleHistory([
          ...(previous.ruleHistory?.length ? previous.ruleHistory : [baseline]),
          { id: `practice-rule:${snapshot.cycleId}`, effectiveDate: options.today, recordedAt: options.startedAt,
            measurement: null, schedule, supersedes: (heads.length ? heads : [baseline]).map(row => row.id) },
        ]) }));
      workUpdates.push(workFromSnapshot(snapshot, previous.id));
    } else {
      const practice = SACRED_PRACTICES.find(item => item.id === snapshot.practiceId)!;
      const letter = letters.find(item => item.id === card.letterId)!;
      updates.push(createRestorationHabit(practice, snapshot, options.calendarMode, options.language, `${restorationCopy(options.language).title} · ${letter.name}`));
      workUpdates.push(workFromSnapshot(snapshot, updates.at(-1)!.id));
    }
  }
  return { ...workspace, habits: [...workspace.habits.filter(habit => !updates.some(item => item.id === habit.id)), ...updates],
    stoicheionWorks: [...(workspace.stoicheionWorks ?? []), ...workUpdates] };
}
