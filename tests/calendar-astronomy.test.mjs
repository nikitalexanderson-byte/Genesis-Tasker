import assert from "node:assert/strict";
import test from "node:test";
import {calendarModule} from "./helpers/calendar-modules.mjs";
const c = calendarModule("app/calendar-context.ts");
const a = calendarModule("app/calendar-astronomy.ts");
const data = calendarModule("app/calendar-data.ts");
const r = calendarModule("app/task-recurrence.ts");
const insights = calendarModule("app/habit-insights.ts");
const solar = calendarModule("app/solar-times.ts");
const utc = c.calendarContext({timeZone: "UTC"});
const zones = ["UTC", "Europe/Moscow", "America/New_York", "Pacific/Auckland"];

test("solar events retain their instant when displayed in the device zone and selected clock format", () => {
  const event = new Date("2026-10-20T21:05:00Z");
  assert.equal(solar.formatDeviceSolarTime(event, "Europe/Moscow", "24h"), "00:05");
  assert.equal(solar.formatDeviceSolarTime(event, "Europe/Moscow", "12h"), "12:05 AM");
  assert.equal(solar.formatDeviceSolarTime(event, "America/Los_Angeles", "24h"), "14:05");
  assert.equal(solar.formatDeviceSolarTime(event, "America/Los_Angeles", "12h"), "02:05 PM");
  assert.equal(solar.getSunriseSunset(new Date(2026, 11, 20, 12), {latitude:78.2232,longitude:15.6469,timeZone:"Arctic/Longyearbyen"}), null);
});

test("today's solar summary chooses events inside the device day across the date line", () => {
  const now = new Date("2026-10-20T01:00:00Z"), zone = "America/Los_Angeles";
  const events = solar.getDeviceDaySolarTimes(now, {latitude:35.6762,longitude:139.6503,timeZone:"Asia/Tokyo"}, zone);
  const day = new Intl.DateTimeFormat("en-CA", {year:"numeric",month:"2-digit",day:"2-digit",timeZone:zone});
  assert.ok(events.sunrise && events.sunset);
  assert.equal(day.format(events.sunrise), "2026-10-19");
  assert.equal(day.format(events.sunset), "2026-10-19");
  assert.ok(events.sunset < events.sunrise);
  assert.deepEqual(solar.getDeviceDaySolarTimes(new Date("2026-12-20T09:00:00Z"), {latitude:78.2232,longitude:15.6469,timeZone:"Arctic/Longyearbyen"}, "Europe/Moscow"), {sunrise:null,sunset:null});
});

test("first and last supported report years include complete boundary months", () => {
  for (const date of ["1900-01-01", "2100-12-31"]) for (const mode of ["profane", "sacred", "lunar"]) {
    const period = a.calendarPeriod(date, mode, "year", utc);
    const last = c.addCivilDays(period.end, -1);
    const mosaic = insights.buildHabitYearMosaic([], last, {start:period.start, end:last});
    assert.equal(mosaic.length, c.civilDayNumber(period.end) - c.civilDayNumber(period.start));
    for (const cell of mosaic) {
      const sacred = a.sacredDateParts(cell.date, utc);
      assert.equal(a.sacredToCivilDate(sacred.sacredYear, sacred.monthIndex, sacred.day, utc), cell.date);
      assert.ok(a.lunarDateParts(cell.date, utc).monthOrdinal >= 1);
    }
  }
});

test("task creation persists rule context and keeps materialized occurrences across display changes", () => {
  const schedule = calendarModule("app/personal-task-schedule.ts");
  const config = {...r.DEFAULT_RECURRENCE_CONFIG, enabled:true, mode:"genesis", pattern:"month-days", days:[1], months:[1],
    rangeStart:"2024-03-18", rangeEnd:"2024-03-21", calendarContext:c.calendarContext({timeZone:"America/New_York"})};
  const task = {id:"calendar-version-fixture", dueDate:"2024-03-18", endDate:"2024-03-18", calendarMode:"profane"};
  const [saved] = schedule.buildTaskSeries(task,config);
  assert.deepEqual(saved.recurrenceContext,config.calendarContext);
  assert.equal(saved.recurrenceInvalidDayPolicy,"skip");
  assert.equal(saved.dueDate,"2024-03-19");
  for (const calendarMode of ["profane","lunar","sacred"]) assert.deepEqual(r.recurrenceDatesForTask({...saved,calendarMode}),["2024-03-19"]);
});

test("real equinox starts, whole-day boundaries and strict sacred inverses in every context", () => {
  for (const timeZone of zones) for (const year of [1900, 2000, 2024, 2025, 2100]) {
    const context = c.calendarContext({timeZone});
    const start = a.sacredYearStartDate(year, context);
    const end = a.sacredYearStartDate(year + 1, context);
    assert.equal(start, c.momentCivilDate(a.springEquinoxMoment(year), timeZone));
    assert.equal(a.sacredDateParts(c.addCivilDays(start, -1), context).sacredYear, year - 1);
    const days = c.civilDayNumber(end) - c.civilDayNumber(start);
    assert.ok(days === 365 || days === 366);
    for (let day = 0; day < days; day++) {
      const date = c.addCivilDays(start, day), sacred = a.sacredDateParts(date, context);
      assert.equal(sacred.sacredYear, year);
      assert.equal(a.sacredToCivilDate(year, sacred.monthIndex, sacred.day, context), date);
    }
    assert.throws(() => a.sacredToCivilDate(year, 12, days - 359, context), /INVALID_SACRED_DAY/);
  }
  const ny = c.calendarContext({timeZone: "America/New_York"});
  assert.equal(a.sacredYearStartDate(2024, ny), "2024-03-19");
  assert.equal(a.sacredYearStartDate(2024, utc), "2024-03-20");
  assert.equal(a.sacredYearStartDate(1900, utc), "1900-03-21");
  assert.equal(a.sacredYearStartDate(2024, {...ny, version: 1}), "2024-03-20");
});

test("lunar starts compare instants, including a prior new moon on the equinox day", () => {
  const spring = a.springEquinoxMoment(2015), index = a.firstLunarMonthAfterSpringEquinox(2015);
  const before = a.newMoonMoment(index - 1), after = a.newMoonMoment(index);
  assert.equal(c.momentCivilDate(before, "UTC"), c.momentCivilDate(spring, "UTC"));
  assert.ok(before < spring && after > spring);
  assert.equal(a.lunarYearPeriod(2015, utc).start, "2015-04-18");
  for (let year = 1900; year <= 2100; year++) {
    const period = a.lunarYearPeriod(year, utc);
    assert.ok([12, 13].includes(period.monthCount));
    assert.equal(period.end, a.lunarYearPeriod(year + 1, utc).start);
    assert.ok(a.newMoonMoment(period.startMonthIndex) > a.springEquinoxMoment(year));
    assert.ok(a.newMoonMoment(period.startMonthIndex - 1) <= a.springEquinoxMoment(year));
  }
});

test("long lunar year keeps every date including the final mosaic cell and month 13", () => {
  const period = a.lunarYearPeriod(2025, utc);
  const length = c.civilDayNumber(period.end) - c.civilDayNumber(period.start);
  assert.equal(period.monthCount, 13);
  assert.ok(length > 370);
  const last = c.addCivilDays(period.end, -1);
  const records = [{date: last, status: "perfect", completedCount: 3, scheduledCount: 3}];
  const mosaic = insights.buildHabitYearMosaic(records, last, {start: period.start, end: last});
  assert.equal(mosaic.length, length);
  assert.equal(mosaic[0].date, period.start);
  assert.equal(mosaic.at(-1).date, last);
  assert.equal(mosaic.at(-1).status, "perfect");
  for (const cell of mosaic) assert.equal(a.lunarDateParts(cell.date, utc).year.sacredYear, 2025);
  assert.equal(a.lunarDateParts(period.end, utc).year.sacredYear, 2026);
});

test("Gregorian January and March years, month/quarter boundaries, and cache isolation", () => {
  const march = {...utc, gregorianYearStart: "march"};
  assert.deepEqual(a.calendarPeriod("2024-02-29", "profane", "year", utc), {start: "2024-01-01", end: "2025-01-01"});
  assert.deepEqual(a.calendarPeriod("2024-02-29", "profane", "year", march), {start: "2023-03-01", end: "2024-03-01"});
  assert.deepEqual(a.calendarPeriod("2024-03-01", "profane", "year", march), {start: "2024-03-01", end: "2025-03-01"});
  assert.deepEqual(a.calendarPeriod("2024-01-01", "profane", "quarter", march), {start: "2023-12-01", end: "2024-03-01"});
  assert.equal(data.calendarYearLabel("2024-01-01", "profane", march), "2023–2024");
  const ny = c.calendarContext({timeZone: "America/New_York"});
  const ak = c.calendarContext({timeZone: "Pacific/Auckland"});
  const first = a.lunarYearPeriod(2024, ny);
  assert.notEqual(first.start, a.lunarYearPeriod(2024, ak).start);
  assert.deepEqual(a.lunarYearPeriod(2024, ny), first);
});

test("legacy recurring dates are retained while new rules use their own fixed calendar context", () => {
  const rule = {...r.DEFAULT_RECURRENCE_CONFIG, enabled: true, mode: "genesis", pattern: "month-days", days: [1], months: [1], rangeEnd: "2024-03-21"};
  delete rule.calendarContext;
  assert.deepEqual(r.buildRecurrenceDates("2024-03-18", rule), ["2024-03-20"]);
  rule.calendarContext = c.calendarContext({timeZone: "America/New_York"});
  assert.deepEqual(r.buildRecurrenceDates("2024-03-18", rule), ["2024-03-19"]);
  const saved = JSON.stringify(rule);
  data.calendarYearRange("2024-03-20", "lunar", utc);
  data.calendarYearRange("2024-03-20", "profane", {...utc, gregorianYearStart: "march"});
  assert.equal(JSON.stringify(rule), saved);
  assert.equal(r.recurrenceMatchesDate("2024-03-18", rule, "2024-03-19"), true);
  assert.deepEqual(r.buildRecurrenceDates("2024-01-31", {...rule, mode: "classic", pattern: "monthly", rangeEnd: "2024-04-30"}), ["2024-01-31", "2024-03-31"]);
  assert.deepEqual(r.buildRecurrenceDates("2024-02-29", {...rule, mode: "classic", pattern: "yearly", rangeEnd: "2028-03-01"}), ["2024-02-29", "2028-02-29"]);
  const task = {dueDate: "2024-03-20", recurrenceSeriesId: "already-created", recurrenceMode: "genesis", recurrenceContext: rule.calendarContext};
  assert.deepEqual(r.recurrenceDatesForTask(task), ["2024-03-20"]);
});

test("recurrence previews stop at the supported input boundary without inventing astronomy", () => {
  assert.equal(r.recurrenceDefaultEndDate("2100-12-31"), "2100-12-31");
  assert.equal(r.recurrenceMaximumEndDate("2099-01-01"), "2100-12-31");
  const config = {...r.DEFAULT_RECURRENCE_CONFIG, enabled:true, mode:"lunar", pattern:"lunar-days",
    days:Array.from({length:30}, (_,i)=>i+1), rangeEnd:"2105-12-31"};
  assert.deepEqual(r.buildRecurrenceDates("2100-12-30", config), ["2100-12-30","2100-12-31"]);
  assert.deepEqual(r.buildRecurrenceDates("2300-01-01", config), []);
  assert.deepEqual(r.lunarMonthOptions("2300-01-01","2301-01-01"), []);
  assert.equal(r.recurrenceMatchesDate("2100-12-30",config,"2101-01-01"),false);
  assert.ok(r.lunarMonthOptions("2100-12-30","2105-01-01").length);
});

test("calendar display changes preserve historical completions, XP and reward receipts", () => {
  const habits = calendarModule("app/habits.ts");
  const habit = habits.defaultHabit("2024-03-18", "sacred");
  habit.title = "Calendar history fixture";
  delete habit.schedule.recurrence.calendarContext;
  habit.schedule.timezone = "America/New_York";
  let workspace = habits.normalizeHabitWorkspace({habits:[habit], habitCompletions:[{
    id:"history-entry",habitId:habit.id,date:"2024-03-20",completed:true,xpAwarded:10,
    createdAt:"2024-03-20T12:00:00Z",updatedAt:"2024-03-20T12:00:00Z",version:1,
  }]}, "sacred");
  const entries = JSON.stringify(workspace.habitCompletions);
  const rewards = JSON.stringify(workspace.rewardTransactions);
  for (const mode of ["profane","lunar","sacred"]) {
    workspace = habits.normalizeHabitWorkspace(workspace, mode);
    assert.equal(workspace.habits[0].schedule.recurrence.calendarContext.version, 1);
    assert.equal(workspace.habits[0].schedule.recurrence.calendarContext.timeZone, "America/New_York");
    assert.equal(JSON.stringify(workspace.habitCompletions), entries);
    assert.equal(JSON.stringify(workspace.rewardTransactions), rewards);
  }
});
