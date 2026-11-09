import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";
const { buildHabitPersonalRecord, buildHabitYearMosaic } = calendarModule("app/habit-insights.ts");
const habit = { id: "habit", createdDate: "2026-10-01", schedule: { endDate: null } };
const mark = (date, completed = true) => ({ habitId: habit.id, date, completed });
const record = (rows, planned, today = "2026-10-04", definition = habit) =>
  buildHabitPersonalRecord(definition, rows, today, "profane", (_habit, date) => planned.includes(date));

test("personal completion rate uses completed scheduled dates, retaining off-schedule history separately", () => {
  const rows = [mark("2026-10-01"), mark("2026-10-02"), mark("2026-10-04")];
  const before = JSON.stringify(rows);
  const value = record(rows, ["2026-10-01", "2026-10-03"]);
  assert.equal(value.totalCompletions, 3);
  assert.equal(value.scheduledCount, 2);
  assert.equal(value.scheduledCompletedCount, 1);
  assert.equal(value.unscheduledCompletions, 2);
  assert.equal(value.completionRate, 50);
  assert.equal(JSON.stringify(rows), before);
});

test("duplicate records on one day cannot multiply mastery, best month or scheduled completion rate", () => {
  const value = record([mark("2026-10-01"), mark("2026-10-01"), mark("2026-10-01", false)], ["2026-10-01"]);
  assert.equal(value.totalCompletions, 1);
  assert.equal(value.bestMonthCompletions, 1);
  assert.equal(value.completionRate, 100);
  assert.equal(value.scheduledCompletedCount, 1);
});

test("future, pre-creation and invalid civil dates are excluded without changing the original history", () => {
  const rows = [mark("2026-09-30"), mark("2026-10-05"), mark("2026-02-30"), mark("2026-10-01")];
  const value = record(rows, ["2026-10-01", "2026-10-02"]);
  assert.equal(value.totalCompletions, 1);
  assert.equal(value.bestMonthCompletions, 1);
  assert.equal(value.completionRate, 50);
  assert.equal(rows.length, 4);
});

test("no schedule has no percentage base; a scheduled but uncompleted range has a real zero", () => {
  const unplanned = record([mark("2026-10-02")], []);
  assert.equal(unplanned.completionRate, null);
  assert.equal(unplanned.totalCompletions, 1);
  assert.equal(unplanned.unscheduledCompletions, 1);
  assert.equal(record([], ["2026-10-01"]).completionRate, 0);
});

test("a changed end date constrains the plan while historical completions stay visible", () => {
  const value = record([mark("2026-10-01"), mark("2026-10-03")], ["2026-10-01", "2026-10-03"], "2026-10-04",
    { ...habit, schedule: { endDate: "2026-10-02" } });
  assert.equal(value.totalCompletions, 2);
  assert.equal(value.scheduledCount, 1);
  assert.equal(value.completionRate, 100);
  assert.equal(value.unscheduledCompletions, 1);
});

test("weekly/monthly settlement slots are counted as periods, independent of duplicate input rows", () => {
  const value = record([mark("2026-10-07"), mark("2026-10-07"), mark("2026-10-14")],
    ["2026-10-07", "2026-10-14", "2026-10-21"], "2026-10-21");
  assert.equal(value.totalCompletions, 2);
  assert.equal(value.scheduledCount, 3);
  assert.equal(value.completionRate, 67);
});

test("year mosaic retains every date of a long lunar-year range beyond 370 days", () => {
  const start = "2025-01-01", end = "2026-01-19";
  const cells = buildHabitYearMosaic([], end, { start, end });
  assert.equal(cells.length, 384);
  assert.equal(cells[0].date, start);
  assert.equal(cells.at(-1).date, end);
  assert.equal(new Set(cells.map(cell => cell.date)).size, 384);
});
