import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";

const { SACRED_PRACTICES } = calendarModule("app/sacred-practices.ts");
const { createHabitFromSacredPractice, EMPTY_HABIT_WORKSPACE } = calendarModule("app/habits.ts");
const { canRestoreSacredHabit, restoreSacredHabit } = calendarModule("app/sacred-habit-restore.ts");

test("restoring sacred content retains the same habit and all tracking data, including past deadlines", () => {
  const practice = SACRED_PRACTICES[0];
  const original = createHabitFromSacredPractice(practice, "2026-01-02", "sacred");
  const edited = { ...original, title: "Возвращение к мере · Альфа", description: "Моя практика", emoji: "🌿", color: "#123456", active: false };
  const other = createHabitFromSacredPractice(SACRED_PRACTICES[1], "2026-01-02", "lunar");
  const workspace = { ...structuredClone(EMPTY_HABIT_WORKSPACE), habits: [edited, other],
    habitCompletions: [{ id: "completion", habitId: edited.id, date: "2026-01-02", completed: true }],
    rewardTransactions: [{ id: "reward", sourceId: edited.id, amount: 10 }] };
  const before = structuredClone(workspace);
  const result = restoreSacredHabit(workspace, edited.id, "ru");
  const restored = result.habits[0];
  assert.equal(canRestoreSacredHabit(edited), true);
  for (const field of ["title", "description", "emoji", "color"]) assert.equal(restored[field], original[field]);
  for (const field of Object.keys(edited).filter(key => !["title", "description", "emoji", "color", "updatedAt", "version", "syncState"].includes(key)))
    assert.deepEqual(restored[field], edited[field], field);
  assert.equal(restored.version, edited.version + 1);
  assert.equal(restored.syncState, "pending");
  assert.strictEqual(result.habits[1], other);
  assert.strictEqual(result.habitCompletions, workspace.habitCompletions);
  assert.strictEqual(result.rewardTransactions, workspace.rewardTransactions);
  assert.deepEqual(workspace, before);
  assert.strictEqual(restoreSacredHabit(result, edited.id, "en"), result, "unchanged content needs no further write");
});

test("catalog defaults and additional reading cycles are never reset accidentally", () => {
  for (const practice of SACRED_PRACTICES) for (const language of ["ru", "en"]) {
    const habit = createHabitFromSacredPractice(practice, "2026-01-02", "profane", language);
    assert.equal(canRestoreSacredHabit(habit), false, `${practice.id}/${language}`);
    const reading = { ...habit, title: "Дополнительная практика", stoicheionRestoration: { cycleId: "cycle" } };
    const workspace = { ...EMPTY_HABIT_WORKSPACE, habits: [reading] };
    assert.equal(canRestoreSacredHabit(reading), false);
    assert.strictEqual(restoreSacredHabit(workspace, habit.id, language), workspace);
  }
});
