import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));
const ts = require("typescript");

function loadTs(path, overrides) {
  const loaded = { exports: {} };
  const source = readFileSync(resolve(root, path), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(js, { exports: loaded.exports, module: loaded, Date, Math, Map, Set, Intl,
    require: (id) => id in overrides ? overrides[id] : require(id.startsWith(".") ? resolve(root,dirname(path),id) : id) });
  return loaded.exports;
}

const context = loadTs("app/calendar-context.ts", {});
const astronomy = loadTs("app/calendar-astronomy.ts", { "./calendar-context": context });
const calendar = loadTs("app/calendar-data.ts", {
  "./lunar-triad": loadTs("app/lunar-triad.ts", {}),
  "./calendar-context": context,
  "./calendar-astronomy": astronomy,
  "../references/days.txt?raw": readFileSync(resolve(root, "references/days.txt"), "utf8"),
  "./calendar-days.en.json": JSON.parse(readFileSync(resolve(root, "app/calendar-days.en.json"), "utf8")),
  "./i18n": { getRuntimeLanguage: () => "ru", runtimeLocale: () => "ru-RU", translateText: (value) => value },
});
const recurrence = loadTs("app/task-recurrence.ts", { "./calendar-data": calendar, "./calendar-context": context });
const ganttCore = loadTs("app/shared-gantt.ts", {});
const gantt = loadTs("app/shared-gantt-calendar.ts", { "./calendar-data": calendar, "./shared-gantt": ganttCore, "./i18n": { translateText: value => value } });

test("Compact sacred Gantt dates use five-day ordinals and reset at cycle boundaries", () => {
  assert.equal(gantt.sacredGanttDate("2026-09-23"), "III/2/VII (Триге)");
  assert.equal(gantt.sacredGanttDate("2026-09-19"), "IIII/1/VII (Триге)");
  assert.equal(gantt.sacredGanttDate("2026-09-20"), "V/1/VII (Триге)");
  assert.equal(gantt.sacredGanttDate("2026-09-21"), "I/2/VII (Триге)");
  assert.equal(gantt.sacredGanttDate("2026-10-13"), "III/6/VII (Триге)");
  assert.match(gantt.sacredGanttDate("2026-03-19"), /^5\/Ω\/XIII/);
});

test("wide Gantt reveals more dates with consistent creation and resize coordinates in every calendar", () => {
  for (const mode of ["profane","sacred","lunar"]) for (const scale of ["days","weeks","months"]) for (const fit of [false,true]) {
    const tasks=fit ? [{startDate:"2026-10-10",dueDate:"2026-10-12"}] : [];
    const narrow=gantt.calendarGanttRange("2026-10-10",scale,tasks,mode,fit,3);
    const wide=gantt.calendarGanttRange("2026-10-10",scale,tasks,mode,fit,20);
    const periods=gantt.calendarGanttPeriods(wide,scale,mode);
    assert.equal(wide.start,narrow.start);
    assert.ok(wide.end>narrow.end,`${mode}/${scale}/${fit}`);
    assert.ok(periods.length>=20);
    const axis=periods.map(period=>({start:Math.max(wide.start,period.start),end:Math.min(wide.end,period.end)}));
    for(const [i,period] of axis.entries()) {
      assert.ok(period.end>period.start);
      if(i)assert.equal(period.start,axis[i-1].end);
      const point=ganttCore.ganttAxisPoint(axis,(i+.5)*ganttCore.GANTT_CELL_WIDTH);
      assert.ok(point>=period.start&&point<period.end);
      assert.ok(Math.abs(ganttCore.ganttAxisPosition(axis,point)-(i+.5)*ganttCore.GANTT_CELL_WIDTH)<1e-5);
    }
    assert.equal(axis.at(-1).end,wide.end);
  }
  for (const mode of ["profane","sacred","lunar"]) {
    const day=gantt.calendarGanttRange("2026-10-10","day",[],mode,false,40);
    assert.equal(day.end-day.start,1);
    assert.equal(gantt.calendarGanttPeriods(day,"day",mode).length,24);
  }
});
const day = (value) => new Date(`${value}T12:00:00`);
const iso = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const config = (pattern, days, months = [], pyatas = [], rangeEnd = "2026-08-01") => ({
  enabled: true, mode: "lunar", pattern, days, months, pyatas, interval: 1,
  rangeStart: "", rangeEnd,
});

test("lunar habit decades, decade days, and phases match the same lunar dates", () => {
  const start = "2026-04-01";
  const decades = recurrence.buildRecurrenceDates(start, config("lunar-decades", [2]));
  assert.ok(decades.length > 0);
  assert.ok(decades.every((value) => calendar.getLunarDate(day(value)).day >= 11
    && calendar.getLunarDate(day(value)).day <= 20));
  const decadeDays = recurrence.buildRecurrenceDates(start, config("lunar-decade-days", [3], [], [2]));
  assert.ok(decadeDays.length > 0);
  assert.ok(decadeDays.every((value) => calendar.getLunarDate(day(value)).day === 13));
  const phases = recurrence.buildRecurrenceDates(start, config("lunar-phases", [1, 2]));
  assert.ok(phases.some((value) => calendar.getLunarDate(day(value)).day === 1));
  assert.ok(phases.some((value) => calendar.isLunarFullMoon(day(value))));
  assert.ok(phases.every((value) => calendar.getLunarDate(day(value)).day === 1
    || calendar.isLunarFullMoon(day(value))));
});

test("lunar yearly recurrence reaches month thirteen only in intercalary years", () => {
  const year = Array.from({ length: 16 }, (_, index) => 2020 + index)
    .find((candidate) => calendar.getLunarYear(candidate).monthCount === 13);
  assert.ok(year);
  const lunarYear = calendar.getLunarYear(year);
  const end = new Date(lunarYear.endDate);
  end.setDate(end.getDate() - 1);
  const dates = recurrence.buildRecurrenceDates(iso(lunarYear.startDate),
    config("lunar-yearly", [1], [13], [], iso(end)));
  assert.equal(dates.length, 1);
  assert.equal(calendar.getLunarDate(day(dates[0])).monthOrdinal, 13);
});

test("custom mood label and emoji survive workspace normalization", () => {
  const mood = loadTs("app/mood-tracker.ts", {
    "./tracker-core": { normalizeTrackerEntity: () => ({ id: "m1", createdAt: "t", updatedAt: "t", version: 1, syncState: "local" }), trackerTimestamp: () => "t" },
    "./tracker-math": { moodValueColor: () => "#fff" },
  });
  const entry = mood.normalizeMoodEntry({ date: "2026-10-04", moodValue: 2, customLabel: "Вдохновение", customEmoji: "🌅" });
  assert.equal(entry.customLabel, "Вдохновение");
  assert.equal(entry.customEmoji, "🌅");
});

test("sacred Gantt uses six five-day periods per month and keeps Apeiron separate", () => {
  for (const year of [2026, 2027]) {
    for (let month = 0; month < 13; month++) {
      const anchor = iso(calendar.getGregorianDate(year, month, 1));
      const range = gantt.calendarGanttRange(anchor, "weeks", [], "sacred");
      const ticks = gantt.calendarGanttPeriods(range, "weeks", "sacred");
      const days = calendar.getSacredDate(day(anchor)).apeironDays;
      assert.equal(range.end - range.start, month === 12 ? days : 30);
      assert.deepEqual(Array.from(ticks, tick => tick.end - tick.start), month === 12 ? [days] : [5, 5, 5, 5, 5, 5]);
      assert.equal(gantt.shiftGanttAnchor(anchor, "weeks", "sacred", 1), iso(calendar.getGregorianDate(month === 12 ? year + 1 : year, month === 12 ? 0 : month + 1, 1)));
    }
    const endYear = iso(calendar.getGregorianDate(year, 10, 1));
    const months = gantt.calendarGanttPeriods(gantt.calendarGanttRange(endYear, "months", [], "sacred"), "months", "sacred");
    assert.equal(months.length, 6);
    assert.equal(months[2].end - months[2].start, calendar.getSacredDate(day(endYear)).apeironDays);
  }
});

test("lunar Gantt decades restart at new moon and truncate at the actual month end", () => {
  const initial = calendar.lunarMonthIndex(day("2026-03-20"));
  const lengths = new Set();
  for (let index = initial; index < initial + 15; index++) {
    const dates = calendar.getLunarMonthDates(index);
    lengths.add(dates.length);
    const anchor = iso(dates[5]);
    const range = gantt.calendarGanttRange(anchor, "weeks", [], "lunar");
    assert.equal(ganttCore.serialDate(range.start), iso(dates[0]));
    assert.equal(range.end - range.start, dates.length);
    const ticks = gantt.calendarGanttPeriods(range, "weeks", "lunar");
    assert.deepEqual(Array.from(ticks, tick => tick.label), ["1–10", "11–20", `21–${dates.length}`]);
    assert.equal(ticks[2].end, range.end);
    assert.equal(gantt.shiftGanttAnchor(anchor, "weeks", "lunar", 1), iso(calendar.getLunarMonthDates(index + 1)[0]));
    const fitted = gantt.calendarGanttPeriods({ start: range.start + 7, end: range.end + 16 }, "weeks", "lunar");
    assert.equal(fitted[3].start, range.end);
    assert.equal(fitted[3].label, "1–10");
  }
  assert.ok(lengths.has(29) && lengths.has(30));
});

test("Gregorian Gantt retains Monday weeks and exact month navigation", () => {
  const range = gantt.calendarGanttRange("2026-10-10", "weeks", [], "profane");
  assert.equal(ganttCore.serialDate(range.start), "2026-10-05");
  assert.equal(range.end - range.start, 56);
  assert.ok(gantt.calendarGanttPeriods(range, "weeks", "profane").every(tick => tick.end - tick.start === 7));
  assert.equal(gantt.shiftGanttAnchor("2026-10-31", "months", "profane", 1), "2027-04-01");
});
