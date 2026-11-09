import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";

const state = calendarModule("app/stoicheion-restoration-state.ts");
const habits = calendarModule("app/habits.ts");
const editing = calendarModule("app/habit-editing.ts");
const sacred = calendarModule("app/sacred-practices.ts");
const cycleHabits = calendarModule("app/stoicheion-restoration-habits.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  return {
    version: 1,
    cycleId: "2026-10-22:305419896:southeast:beta",
    startedAt: "2026-10-21T21:30:00.000Z",
    startedDate: "2026-10-22",
    sourceDate: "2026-10-22",
    sourceSeed: 305419896,
    cards: ["mu", "psi", "omega", "theta", "upsilon", "chi", "omicron", "pi", "beta"]
      .map((letterId) => ({ letterId, reversed: letterId === "beta" })),
    sectorId: "southeast",
    letterId: "beta",
    need: "conflict",
    supportIds: ["hearth"],
    resourceLetterId: "xi",
    practiceId: "hephaestus-small-repair",
    spreadTotal: 2701,
    pythmen: 1,
    intention: "Собираю силы в одном достойном действии",
    action: "Подготовить рабочее место и починить одну небольшую вещь",
    practiceText: "Вспомнить щит Ахилла как образ осмысленной формы",
    reflection: "Что сегодня получило ясную форму?",
    ...overrides,
  };
}

test("a valid snapshot preserves the original nine-card draw, equation and chosen practice", () => {
  const input = fixture();
  const snapshot = state.normalizeRestorationSnapshot(input);
  assert.deepEqual(plain(snapshot), input);
  assert.equal(snapshot.spreadTotal, 40 + 700 + 800 + 9 + 400 + 600 + 70 + 80 + 2);
  assert.equal(snapshot.resourceLetterId, "xi");
  assert.equal(snapshot.practiceId, "hephaestus-small-repair");
  assert.deepEqual([...state.RESTORATION_POSITION_IDS], [
    "northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast",
  ]);
  assert.equal(state.RESTORATION_STAGES.reduce((sum, stage) => sum + stage.count, 0), 10);
});

test("corrupted optional restoration metadata is rejected without throwing", () => {
  for (const input of [null, undefined, false, 1, "snapshot", [], {}]) {
    assert.equal(state.normalizeRestorationSnapshot(input), null);
  }
  const corruptions = [
    ["version", (v) => { v.version = 2; }],
    ["source date rollover", (v) => { v.sourceDate = "2026-02-30"; }],
    ["local start date rollover", (v) => { v.startedDate = "2026-13-01"; }],
    ["missing start date", (v) => { delete v.startedDate; }],
    ["invalid timestamp", (v) => { v.startedAt = "unparseable"; }],
    ["negative seed", (v) => { v.sourceSeed = -1; }],
    ["fractional seed", (v) => { v.sourceSeed = 1.5; }],
    ["oversized seed", (v) => { v.sourceSeed = 0x100000000; }],
    ["unknown need", (v) => { v.need = "always-positive"; }],
    ["empty intention", (v) => { v.intention = "  "; }],
    ["missing action", (v) => { delete v.action; }],
    ["nontext practice", (v) => { v.practiceText = {}; }],
    ["wrong cycle identity", (v) => { v.cycleId += ":different"; }],
    ["unknown support", (v) => { v.supportIds = ["hearth", "unknown"]; }],
    ["non-array supports", (v) => { v.supportIds = "hearth"; }],
    ["more than five supports", (v) => { v.supportIds = Array(6).fill("hearth"); }],
    ["missing card", (v) => { v.cards.pop(); }],
    ["additional card", (v) => { v.cards.push({ letterId: "alpha", reversed: true }); }],
    ["unknown card", (v) => { v.cards[0].letterId = "digamma"; }],
    ["duplicate card", (v) => { v.cards[0].letterId = "beta"; }],
    ["null card", (v) => { v.cards[0] = null; }],
    ["non-boolean orientation", (v) => { v.cards[0].reversed = "false"; }],
    ["selected card is upright", (v) => { v.cards[8].reversed = false; }],
    ["wrong selected letter", (v) => { v.letterId = "alpha"; }],
    ["different position", (v) => { v.sectorId = "east"; }],
    ["auxiliary sector cannot replace a draw position", (v) => { v.sectorId = "hearth"; }],
    ["unknown sector", (v) => { v.sectorId = "unknown"; }],
    ["altered original total", (v) => { v.spreadTotal = 2702; }],
    ["altered original root", (v) => { v.pythmen = 2; }],
    ["known resource with incompatible root", (v) => { v.resourceLetterId = "alpha"; }],
    ["unknown resource", (v) => { v.resourceLetterId = "digamma"; }],
    ["unknown practice", (v) => { v.practiceId = "missing-practice"; }],
  ];
  for (const [label, corrupt] of corruptions) {
    const input = fixture();
    corrupt(input);
    assert.equal(state.normalizeRestorationSnapshot(input), null, label);
  }
});

test("normalization makes an independent snapshot and canonicalizes bounded presentation text", () => {
  const input = fixture({ supportIds: ["hearth", "hearth"], intention: "  Начать с меры  ", reflection: null });
  const before = plain(input);
  const snapshot = state.normalizeRestorationSnapshot(input);
  assert.deepEqual(input, before);
  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.cards, input.cards);
  assert.notEqual(snapshot.cards[0], input.cards[0]);
  assert.notEqual(snapshot.supportIds, input.supportIds);
  assert.deepEqual([...snapshot.supportIds], ["hearth"]);
  assert.equal(snapshot.intention, "Начать с меры");
  assert.equal(snapshot.reflection, "");
  input.cards[0].letterId = "alpha";
  input.supportIds.push("exit");
  assert.equal(snapshot.cards[0].letterId, "mu");
  assert.deepEqual([...snapshot.supportIds], ["hearth"]);
  snapshot.cards[1].reversed = true;
  assert.equal(input.cards[1].reversed, false);
  const long = state.normalizeRestorationSnapshot(fixture({
    intention: "a".repeat(700), action: "b".repeat(1800), practiceText: "c".repeat(1800), reflection: "d".repeat(2200),
  }));
  assert.equal(long.intention.length, 500);
  assert.equal(long.action.length, 1600);
  assert.equal(long.practiceText.length, 1600);
  assert.equal(long.reflection.length, 2000);
});

test("the cycle keeps the local start date independently of the UTC creation date", () => {
  for (const [startedAt, completedAt] of [
    ["2026-10-21T21:30:00.000Z", "2026-10-21T21:35:00.000Z"],
    ["2026-10-23T01:30:00.000Z", "2026-10-23T01:35:00.000Z"],
  ]) {
    const snapshot = state.normalizeRestorationSnapshot(fixture({ startedAt }));
    assert.ok(snapshot);
    assert.equal(snapshot.startedDate, "2026-10-22");
    assert.notEqual(snapshot.startedAt.slice(0, 10), snapshot.startedDate);
    const entries = [{ habitId: "practice", date: "2026-10-22", completed: true, updatedAt: completedAt }];
    assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-10-22")], ["2026-10-22"]);
  }
});

test("cycle progress excludes prior marks, other habits, future dates and repeated marks", () => {
  const snapshot = state.normalizeRestorationSnapshot(fixture());
  const entries = [
    { habitId: "practice", date: "2026-10-22", completed: true, updatedAt: "2026-10-21T21:29:59.999Z" },
    { habitId: "practice", date: "2026-10-21", completed: true, updatedAt: "2026-10-22T10:00:00Z" },
    { habitId: "practice", date: "2026-10-23", completed: true, updatedAt: "2026-10-23T10:00:00Z" },
    { habitId: "practice", date: "2026-10-23", completed: true, updatedAt: "2026-10-23T11:00:00Z" },
    { habitId: "practice", date: "2026-10-24", completed: false, updatedAt: "2026-10-24T10:00:00Z" },
    { habitId: "other", date: "2026-10-24", completed: true, updatedAt: "2026-10-24T10:00:00Z" },
    { habitId: "practice", date: "2026-10-25", completed: true, updatedAt: "2026-10-25T10:00:00Z" },
    { habitId: "practice", date: "2026-10-24", completed: true, updatedAt: "invalid" },
  ];
  const before = plain(entries);
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-10-24")], ["2026-10-23"]);
  assert.deepEqual(entries, before);
  const boundary = [{ habitId: "practice", date: "2026-10-22", completed: true, updatedAt: snapshot.startedAt }];
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", boundary, "2026-10-22")], ["2026-10-22"]);
});

test("the tetractys fills once per distinct day and caps at the first ten executions", () => {
  const snapshot = state.normalizeRestorationSnapshot(fixture());
  const dates = [
    "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27",
    "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
  ];
  const entries = [...dates].reverse().flatMap((date) => Array.from({ length: 2 }, () => ({
    habitId: "practice", date, completed: true, updatedAt: `${date}T12:00:00Z`,
  })));
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-11-03")], dates.slice(0, 10));
});

test("a linked habit's pre-existing start-day completion cannot become a new practice through a later note edit", () => {
  const snapshot = state.normalizeRestorationSnapshot(fixture({ excludeStartDate: true }));
  assert.equal(snapshot.excludeStartDate, true);
  const entries = [
    { habitId: "practice", date: "2026-10-22", completed: true, updatedAt: "2026-10-22T12:00:00Z", note: "Note edited after linking" },
    { habitId: "practice", date: "2026-10-23", completed: true, updatedAt: "2026-10-23T12:00:00Z" },
  ];
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-10-22")], []);
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-10-23")], ["2026-10-23"]);
  const restored = state.normalizeRestorationSnapshot(plain(snapshot));
  assert.equal(restored.excludeStartDate, true);
  for (const flag of [undefined, null, false, 0, 1, "true"]) {
    const unflagged = state.normalizeRestorationSnapshot(fixture({ excludeStartDate: flag }));
    assert.equal(Object.hasOwn(unflagged, "excludeStartDate"), false);
    assert.deepEqual([...state.restorationCompletionDates(unflagged, "practice", entries, "2026-10-22")], ["2026-10-22"]);
  }
});

test("malformed or impossible imported completion dates never fill the tetractys", () => {
  const snapshot = state.normalizeRestorationSnapshot(fixture());
  const entries = ["2026-10-32", "2026-10-2x", "2026-10-220", "2026-10-23"].map((date) => ({
    habitId: "practice", date, completed: true, updatedAt: "2026-10-24T12:00:00Z",
  }));
  assert.deepEqual([...state.restorationCompletionDates(snapshot, "practice", entries, "2026-11-03")], ["2026-10-23"]);
});

test("habit normalization and serialized workspace round trips retain original restoration metadata", () => {
  const snapshot = fixture();
  const practice = sacred.SACRED_PRACTICES.find((candidate) => candidate.id === snapshot.practiceId);
  const habit = habits.createHabitFromSacredPractice(practice, snapshot.startedDate, "profane");
  habit.stoicheionRestoration = snapshot;
  const normalized = habits.normalizeHabitWorkspace({ habits: [habit] }, "profane");
  assert.deepEqual(plain(normalized.habits[0].stoicheionRestoration), snapshot);
  assert.notEqual(normalized.habits[0].stoicheionRestoration, snapshot);
  const restored = habits.normalizeHabitWorkspace(plain(normalized), "profane");
  assert.deepEqual(plain(restored.habits[0].stoicheionRestoration), snapshot);
  assert.equal(restored.habits[0].id, habit.id);
  assert.equal(restored.habits[0].sacredPracticeId, snapshot.practiceId);
  assert.equal(restored.habits[0].sacredSectorId, "southeast");
  const corrupt = { ...plain(habit), stoicheionRestoration: { ...snapshot, pythmen: 8 } };
  const readable = habits.normalizeHabitWorkspace({ habits: [corrupt] }, "profane");
  assert.equal(readable.habits.length, 1);
  assert.equal(readable.habits[0].id, habit.id);
  assert.equal(readable.habits[0].stoicheionRestoration, null);
});

test("ordinary habit editing preserves cycle provenance against stale or replaced metadata", () => {
  const practice = sacred.SACRED_PRACTICES.find((candidate) => candidate.id === fixture().practiceId);
  const previous = habits.createHabitFromSacredPractice(practice, "2026-10-22", "profane");
  previous.stoicheionRestoration = state.normalizeRestorationSnapshot(fixture());
  for (const replacement of [undefined, null, fixture({ intention: "Replaced original intention", sourceSeed: 1 })]) {
    const candidate = { ...plain(previous), title: "Edited user title", stoicheionRestoration: replacement };
    const updated = editing.applyEditableHabitUpdate(previous, candidate);
    assert.equal(updated.title, "Edited user title");
    assert.equal(updated.stoicheionRestoration, previous.stoicheionRestoration);
    assert.deepEqual(plain(updated.stoicheionRestoration), fixture());
  }
});

test("new restoration habits default to one completion in the divination's two-day window", () => {
  const snapshot = state.normalizeRestorationSnapshot(fixture());
  const practice = sacred.SACRED_PRACTICES.find(candidate => candidate.id === snapshot.practiceId);
  for (const mode of ["profane", "sacred", "lunar"]) {
    const habit = cycleHabits.createRestorationHabit(practice, snapshot, mode, "en", "Return to measure");
    assert.equal(habit.schedule.recurrence.mode, {profane:"classic",sacred:"genesis",lunar:"lunar"}[mode]);
    assert.equal(habit.schedule.recurrence.enabled, true);
    assert.equal(habit.stoicheionRestoration, snapshot);
    for (let offset = 0; offset < 35; offset++) {
      const date = new Date(`${snapshot.startedDate}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      assert.equal(habits.isHabitScheduledForDate(habit, date.toISOString().slice(0,10), "profane"), offset < 2, `${mode}, day ${offset+1}`);
    }
    const ordinary = habits.createHabitFromSacredPractice(practice, snapshot.startedDate, mode);
    assert.equal(ordinary.practiceGoal.requiredCompletions, 1);
    assert.equal(ordinary.schedule.endDate, "2026-10-23");
    assert.equal(cycleHabits.isEligibleRestorationHabit(ordinary), false, "A finite practice cannot be reused as an ordinary recurring host");
    const recurring = {...habit,stoicheionRestoration:null,practiceGoal:null,sacredPracticeId:null,sacredSectorId:null};
    assert.equal(cycleHabits.isEligibleRestorationHabit(recurring), true);
    assert.equal(cycleHabits.isEligibleRestorationHabit({...recurring,active:false}), false);
  }
});
