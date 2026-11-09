import assert from "node:assert/strict";
import test from "node:test";
import { calendarModule } from "./helpers/calendar-modules.mjs";
import { localizedModule } from "./helpers/localized-modules.mjs";
import { MemoryStorage } from "./helpers/cloud-sync-client.mjs";

const timeline = calendarModule("app/stoicheion-timeline.ts");
const signOut = calendarModule("app/local-sign-out.ts");
const { REGION_LANGUAGES } = calendarModule("app/region-language.ts");
const now = Date.parse("2026-10-30T10:00:00Z");
const day = "2026-10-30";

test("timeline preserves uint32 seeds and permits only one reroll in the original three-minute window", () => {
  const storage = new MemoryStorage();
  const first = timeline.saveLocalTimelineDraw(storage, 0xffffffff, day, now);
  assert.equal(first.seed, 0xffffffff);
  assert.equal(first.attempts, 1);
  assert.equal(first.remainingSeconds, 180);
  assert.equal(first.canReroll, true);
  const restored = timeline.readLocalTimelineDraw(storage, day, now + 60_000);
  assert.equal(restored.remainingSeconds, 120);
  const second = timeline.saveLocalTimelineDraw(storage, 0, day, now + 179_999);
  assert.equal(second.seed, 0);
  assert.equal(second.attempts, 2);
  assert.equal(second.canReroll, false);
  assert.equal(second.firstDrawAt, first.firstDrawAt);
  assert.equal(second.rerollDeadline, first.rerollDeadline);
  assert.throws(() => timeline.saveLocalTimelineDraw(storage, 123, day, now + 180_000), /уже использован/);
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now + 181_000).seed, 0);
});

test("expiry closes at 180 seconds; a new calendar week has its own draw", () => {
  const storage = new MemoryStorage();
  timeline.saveLocalTimelineDraw(storage, 7, day, now);
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now + 179_999).canReroll, true);
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now + 180_000).canReroll, false);
  assert.throws(() => timeline.saveLocalTimelineDraw(storage, 8, day, now + 180_000), /окно.*завершилось/);
  assert.throws(() => timeline.saveLocalTimelineDraw(storage, 9, "2026-10-31", now + 86_400_000), /окно.*завершилось/);
  assert.equal(timeline.readLocalTimelineDraw(storage,"2026-11-01",now+2*86_400_000).seed,7);
  assert.equal(timeline.readLocalTimelineDraw(storage,"2026-11-02",now+3*86_400_000),null);
  assert.equal(timeline.saveLocalTimelineDraw(storage, 9, "2026-11-02", now + 3*86_400_000).attempts, 1);
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now + 86_400_000).seed, 7);
});

test("old daily/nine-card writers cannot erase timeline state and sign-out clears both namespaces", () => {
  const storage = new MemoryStorage();
  const oldKey = `genesis-stoicheion-draws-v2:${day}`;
  storage.setItem(oldKey, JSON.stringify({ daily: { seed: 42 }, spread: { seed: 99 } }));
  const oldValue = storage.getItem(oldKey);
  timeline.saveLocalTimelineDraw(storage, 15, day, now);
  assert.equal(storage.getItem(oldKey), oldValue);
  storage.setItem(oldKey, JSON.stringify({ daily: { seed: 43 }, spread: { seed: 99 } }));
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now).seed, 15);
  storage.setItem("unrelated-preference", "keep");
  signOut.clearPrivateDeviceStorage(storage);
  assert.equal(storage.getItem(oldKey), null);
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now), null);
  assert.equal(storage.getItem("unrelated-preference"), "keep");
});

test("malformed or foreign local records cannot become a draw and stored countdown flags are recalculated", () => {
  const storage = new MemoryStorage();
  const valid = timeline.saveLocalTimelineDraw(storage, 1, day, now);
  const key = timeline.LOCAL_TIMELINE_STORAGE_PREFIX + day;
  for (const change of [{ seed: -1 }, { seed: 0x100000000 }, { seed: 1.5 }, { seed: "7" },
    { kind: "daily" }, { dayKey: "2026-10-29" }, { attempts: 3 }, { firstDrawAt: "bad" }, { rerollDeadline: "bad" }]) {
    storage.setItem(key, JSON.stringify({ ...valid, ...change }));
    assert.equal(timeline.readLocalTimelineDraw(storage, day, now), null, JSON.stringify(change));
  }
  for (const raw of ["not JSON", "null", "[]", "{}", "false", "7"]) {
    storage.setItem(key, raw);
    assert.equal(timeline.readLocalTimelineDraw(storage, day, now), null);
  }
  storage.setItem(key, JSON.stringify({ ...valid, canReroll: true, remainingSeconds: 9999 }));
  assert.equal(timeline.readLocalTimelineDraw(storage, day, now + 180_000).canReroll, false);
  for (const invalid of [-1, 1.5, 0x100000000, NaN, Infinity, "7"]) {
    assert.throws(() => timeline.saveLocalTimelineDraw(storage, invalid, day, now), /Зерно/);
  }
  assert.equal(timeline.readLocalTimelineDraw({ getItem() { throw new Error("Storage denied"); } }, day, now), null);
});

test("all fourteen timeline translations preserve three ordered times and the Greek meanings", () => {
  const en = timeline.stoicheionTimelineCopy("en");
  assert.equal(REGION_LANGUAGES.length, 14);
  for (const language of REGION_LANGUAGES) {
    const copy = timeline.stoicheionTimelineCopy(language);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(en).sort(), language);
    for (const key of ["title", "subtitle", "begin", "reroll", "rerollUsed", "rerollExpired", "motion", "motionHint", "motionGeneralHint", "method", "upright", "reversed", "uprightEffect", "reversedEffect"]) {
      assert.ok(typeof copy[key] === "string" && copy[key].trim(), `${language}.${key}`);
    }
    assert.deepEqual(copy.positions.map(position => position.id), ["past", "present", "future"], language);
    assert.equal(copy.paragraphs.length, 3);
    assert.ok(copy.paragraphs.every(paragraph => paragraph.trim().length > 30), language);
    assert.match(copy.uprightEffect, /πνεῦμα|Πνεῦμα/);
    assert.match(copy.reversedEffect, /Ὑστέρημα|ὑστέρημα/);
    assert.equal(new Set(copy.positions.map(position => position.title)).size, 3, language);
    assert.ok(copy.positions.every(position => position.meaning.trim().length > 15), language);
    if (language !== "en") assert.notEqual(copy.title, en.title, `${language}: English fallback`);
  }
  assert.equal(timeline.stoicheionTimelineCopy("unknown"), en);
  assert.equal(timeline.stoicheionTimelineCopy("__proto__"), en);
});

test("draw error translations describe random seeds and drawing cards rather than seeds, redesign or colours", () => {
  const { translateText } = localizedModule("app/i18n.ts");
  const sources = ["Зерно расклада указано неверно.", "Переброс на сегодня уже использован.",
    "Поле случайности · движение создаёт зерно", "Трёхминутное окно для переброса завершилось."];
  const misleading = {
    pl: /nasieni|nasion|redraw/iu, tr: /tohum|kırmız/iu, sr: /семен|редарк|цртањ/iu,
    uk: /насін|переробк|перекидан/iu, de: /Samen|Neuzeichnung/u, fr: /répandue|redessin/iu,
    es: /esparcida|rediseño/iu, it: /diffuso|ridisegno/iu, pt: /espalhada|redesenho/iu,
    zh: /传播种子|重画|重新绘制/u, ja: /再描画/u, el: /διασποράς|επανασχεδίασ/iu,
  };
  for (const language of REGION_LANGUAGES) {
    for (const source of sources) {
      const translated = translateText(source, language);
      assert.ok(translated.trim(), `${language}: empty draw message`);
      if (language !== "ru") assert.notEqual(translated, source, `${language}: untranslated ${source}`);
      if (misleading[language]) assert.doesNotMatch(translated, misleading[language], `${language}: ${source}`);
    }
  }
});

test("web reveal resumes per owner, deal, date and attempt without consuming another draw",()=>{
 const storage=new MemoryStorage(),draw=timeline.saveLocalTimelineDraw(storage,42,day,now);
 assert.equal(timeline.readTimelineRevealed(storage,'alice',draw),3,'Legacy and native deals remain visible');
 timeline.saveTimelineRevealed(storage,'alice',draw,1);assert.equal(timeline.readTimelineRevealed(storage,'alice',draw),1);
 assert.equal(timeline.readTimelineRevealed(storage,'bob',draw),3);
 timeline.saveTimelineRevealed(storage,'alice',draw,2);assert.equal(timeline.readTimelineRevealed(storage,'alice',draw),2);
 assert.equal(timeline.readLocalTimelineDraw(storage,day,now).attempts,1);
 assert.equal(timeline.readTimelineRevealed(storage,'alice',{...draw,attempts:2}),3);
 assert.throws(()=>timeline.saveTimelineRevealed(storage,'alice',draw,4),/REVEAL_INVALID/);
});
