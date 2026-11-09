import test from "node:test";
import assert from "node:assert/strict";
import { isTaskOverdue } from "../app/task-overdue.ts";

const task = { done: false, dueDate: "2026-09-28", time: "", zoneId: "UTC" };

test("overdue status follows dates, exact time and time zones without completing tasks", () => {
  assert.equal(isTaskOverdue(task, new Date("2026-09-28T23:59:59Z")), false);
  assert.equal(isTaskOverdue(task, new Date("2026-09-29T00:00:00Z")), true);
  const timed = { ...task, time: "10:30", zoneId: "Europe/Moscow" };
  assert.equal(isTaskOverdue(timed, new Date("2026-09-28T07:29:59Z")), false);
  assert.equal(isTaskOverdue(timed, new Date("2026-09-28T07:30:00Z")), true);
  assert.equal(isTaskOverdue({ ...task, endDate: "2026-09-30" }, new Date("2026-09-29T12:00:00Z")), false);
  assert.equal(isTaskOverdue({ ...task, done: true }, new Date("2026-10-01T00:00:00Z")), false);
  assert.equal(task.done, false);
});

test("undated tasks and future occurrences are not marked overdue", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  assert.equal(isTaskOverdue({ ...task, dueDate: "" }, now), false);
  assert.equal(isTaskOverdue({ ...task, dueDate: "2026-02-31" }, now), false);
  assert.equal(isTaskOverdue(task, now, "2026-09-30"), false);
  assert.equal(isTaskOverdue(task, now, "2026-09-28"), true);
  assert.equal(isTaskOverdue({ ...task, time: "25:01" }, new Date("2026-09-28T12:00:00Z")), false);
});
