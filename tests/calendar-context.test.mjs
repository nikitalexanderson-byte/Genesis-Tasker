import assert from "node:assert/strict";
import test from "node:test";
import { addCivilDays, calendarContext, civilDayNumber, isCivilDate, momentCivilDate, resolveCalendarWallTime } from "../app/calendar-context.ts";

test("calendar dates are strict civil values across leap and year boundaries", () => {
  assert.equal(isCivilDate("2023-02-29"), false);
  assert.equal(isCivilDate("2024-02-29"), true);
  assert.equal(isCivilDate("2024-04-31"), false);
  assert.equal(addCivilDays("2024-02-28", 2), "2024-03-01");
  assert.equal(addCivilDays("2025-01-01", -1), "2024-12-31");
  assert.equal(civilDayNumber("2024-03-11") - civilDayNumber("2024-03-09"), 2);
});

test("event days follow the explicit IANA zone without changing the instant", () => {
  const event = new Date("2024-03-20T03:06:00Z");
  assert.equal(momentCivilDate(event, "America/New_York"), "2024-03-19");
  assert.equal(momentCivilDate(event, "Europe/Moscow"), "2024-03-20");
  assert.equal(momentCivilDate(event, "Pacific/Auckland"), "2024-03-20");
  assert.equal(momentCivilDate(event, "America/New_York"), "2024-03-19");
  assert.throws(() => calendarContext({ version: 3 }), /UNKNOWN_CALENDAR_VERSION/);
  assert.throws(() => calendarContext({ timeZone: "MSK" }), /INVALID_CALENDAR_TIME_ZONE/);
});

test("DST skips move forward and repeated local times select a single earlier instant", () => {
  const gap = resolveCalendarWallTime("2026-03-08", "02:30", "America/New_York");
  assert.equal(gap.instant.toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(gap.adjustment, "gap-forward");
  const overlap = resolveCalendarWallTime("2026-11-01", "01:30", "America/New_York");
  assert.equal(overlap.instant.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(overlap.adjustment, "overlap-earlier");
  const today = resolveCalendarWallTime("2026-03-07", "12:00", "America/New_York").instant;
  const tomorrow = resolveCalendarWallTime("2026-03-08", "12:00", "America/New_York").instant;
  assert.equal(tomorrow - today, 23 * 3_600_000);
  assert.notEqual(tomorrow.getTime(), today.getTime() + 86_400_000);
  assert.equal(resolveCalendarWallTime("2026-04-05", "01:45", "Australia/Lord_Howe").adjustment, "overlap-earlier");
  assert.equal(resolveCalendarWallTime("2026-10-04", "02:15", "Australia/Lord_Howe").instant.toISOString(), "2026-10-03T15:45:00.000Z");
});
