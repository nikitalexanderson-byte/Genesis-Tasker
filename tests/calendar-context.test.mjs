import assert from "node:assert/strict";
import test from "node:test";
import { addCivilDays, calendarContext, civilDayNumber, deviceTimeZone, isCivilDate, momentCivilDate, resolveCalendarWallTime } from "../app/calendar-context.ts";

test("Android zero-offset aliases preserve civil dates while ambiguous and nonzero shorthand stay rejected", () => {
  for (const timeZone of ["UTC", "GMT", "+00:00"]) {
    assert.equal(calendarContext({ timeZone }).timeZone, "UTC");
    assert.equal(momentCivilDate(new Date("2026-01-15T23:59:00Z"), timeZone), "2026-01-15");
    assert.equal(momentCivilDate(new Date("2026-07-15T00:01:00Z"), timeZone), "2026-07-15");
  }
  for (const timeZone of ["MSK", "+03:00", "-05:00", "+00:01", "GMT+0", "UTC "]) {
    assert.throws(() => calendarContext({ timeZone }), /INVALID_CALENDAR_TIME_ZONE/);
  }
});

test("the observed WebView124 default +00:00 initializes shared calendars without changing the device zone", () => {
  const actual = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (...args) {
    const formatter = new actual(...args);
    if (args.length === 0) Object.defineProperty(formatter, "resolvedOptions", {
      value: () => ({ ...actual.prototype.resolvedOptions.call(formatter), timeZone: "+00:00" }),
    });
    return formatter;
  };
  try {
    assert.equal(deviceTimeZone(), "UTC");
    assert.equal(calendarContext().timeZone, "UTC");
    assert.equal(momentCivilDate(new Date("2026-01-15T23:59:00Z")), "2026-01-15");
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "+00:00");
  } finally { Intl.DateTimeFormat = actual; }
});

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
