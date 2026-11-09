import test from "node:test";
import assert from "node:assert/strict";
import { compactAdviceBody, originalAdvicePreview } from "../app/advice-text.ts";
import { readFile } from "node:fs/promises";
import { parseAdviceParagraphs, mergeAdviceCatalog, adviceCategories } from "../scripts/import-daily-advice.mjs";
import { ADVICE_TOPICS, adviceAvailableCategories, adviceHabitScores, adviceHabitTopicScores, adviceTaskContext, advicePreferences, todayAdviceHistory } from "../app/daily-advice.ts";
import { adviceLanguages, verifyAdvicePairing, verifyDailyAdvice } from "../scripts/verify-daily-advice.mjs";

test("advice display removes imported blank rows while preserving distinct lines and punctuation", () => {
  const first = "Против врага: вынуждайте его принимать решения в условиях спешки и страха.";
  const second = 'Как союзник: трансформируйте её в "молниеносную решимость" при реализации просчитанных стратегий.';
  assert.equal(compactAdviceBody(`\n${first}\n\n \t\n\n${second}\n`), `${first}\n${second}`);
  assert.equal(compactAdviceBody("Первая строка.\r\n\r\nВторая строка.\rТретья строка."), "Первая строка.\nВторая строка.\nТретья строка.");
  assert.equal(compactAdviceBody("Краткая мысль."), "Краткая мысль.");
});

test("only unchanged saved advice is formatted; personal diary edits remain verbatim", () => {
  const advice = { body: "Первая строка.\n\nВторая строка.", collection: "aurora" };
  assert.equal(originalAdvicePreview({ body: advice.body, advice }), advice);
  assert.equal(originalAdvicePreview({ body: advice.body + "\n\nМоя заметка.", advice }), null);
  assert.equal(originalAdvicePreview({ body: "Моя заметка.\n\nВторая строка." }), null);
  assert.equal(advice.body, "Первая строка.\n\nВторая строка.");
});

test("collections default to Aurora, accept either or both, and never substitute a disabled collection", async () => {
  assert.deepEqual(advicePreferences().collections,["aurora"]);
  assert.deepEqual(advicePreferences({collections:["philosophers"]}).collections,["philosophers"]);
  assert.deepEqual(advicePreferences({collections:["philosophers","aurora","aurora"]}).collections,["aurora","philosophers"]);
  assert.deepEqual(advicePreferences({collections:[]}).collections,["aurora"]);
  const base={id:"a",dayKey:"2026-11-01",body:"Synthetic fixture",language:"ru",categories:[],dismissed:false,sources:[]};
  const result={dayKey:base.dayKey,state:"ready",advice:base,history:[base,{...base,id:"p",collection:"philosophers"}]};
  assert.deepEqual(todayAdviceHistory(result,advicePreferences()).map(row=>row.id),["a"]);
  assert.deepEqual(todayAdviceHistory(result,advicePreferences({collections:["philosophers"]})).map(row=>row.id),["p"]);
  const corpus=JSON.parse(await readFile(new URL("../server/content/philosopher-aphorisms.json",import.meta.url),"utf8"));
  assert.equal(corpus.version,1);
  assert.equal(corpus.items.length,2602);
  assert.equal(new Set(corpus.items.map(row=>row.id)).size,2602);
});

test("aphorism count defaults to one and accepts only whole daily allowances from one to three", () => {
  assert.equal(advicePreferences().philosophersPerDay, 1);
  for (const count of [1, 2, 3]) assert.equal(advicePreferences({ philosophersPerDay: count }).philosophersPerDay, count);
  for (const count of [0, -1, 4, 2.5, "3", true, null]) assert.equal(advicePreferences({ philosophersPerDay: count }).philosophersPerDay, 1);
});

test("today history preserves account draws through nine after the daily allowance ends", () => {
  for (const limit of [3, 5, 6, 7, 8, 9]) {
    const history = Array.from({ length: limit }, (_, index) => ({ id: `advice-${String(index).repeat(24)}`,
      dayKey: "2026-10-31", title: `Совет ${index + 1}`, body: "Полный текст\nВторой абзац", categories: ["aretology"],
      language: "ru", dismissed: false, sources: [], sequence: index + 1 }));
    const result = { dayKey: "2026-10-31", state: "ready", advice: history.at(-1), history,
      sequence: limit, dailyLimit: limit, remaining: 0, canNext: false };
    const original = structuredClone(result);
    const browsable = todayAdviceHistory(result, advicePreferences());
    assert.deepEqual(browsable.map(card => card.sequence), Array.from({ length: limit }, (_, index) => index + 1));
    assert.equal(browsable[0].body, "Полный текст\nВторой абзац");
    assert.deepEqual(result, original, "Browsing must not change the account pointer or spend another draw");
    assert.equal(todayAdviceHistory({ ...result, history: undefined }, advicePreferences())[0].id, result.advice.id);
  }
});

test("today history respects dismissal, the current date and the current adult choice", () => {
  const base = { id: "advice-" + "a".repeat(24), dayKey: "2026-10-31", body: "Advice", language: "ru", categories: ["aretology"], dismissed: false, sources: [] };
  const result = { dayKey: base.dayKey, state: "ready", advice: base, history: [base,
    { ...base, id: "hidden", dismissed: true }, { ...base, id: "yesterday", dayKey: "2026-10-30" },
    { ...base, id: "adult", categories: ["aphrodisia"], requiresAdult: true }] };
  assert.deepEqual(todayAdviceHistory(result, advicePreferences()).map(card => card.id), [base.id]);
  const adult = advicePreferences({ categories: ["aretology", "aphrodisia"], aphrodisiaAdult: true });
  assert.deepEqual(todayAdviceHistory(result, adult).map(card => card.id), [base.id, "adult"]);
});

test("paragraph import preserves text and stable IDs across reorder, BOM, CRLF, and reflow", () => {
  const entries = parseAdviceParagraphs("\uFEFFFirst line\r\ncontinued.\r\n\r\nSecond post.\r\n", "hermetica");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].body, "First line\ncontinued.");
  assert.equal(entries[0].id, parseAdviceParagraphs("Second post.\n\nFirst line continued.", "aretology")[1].id);
  const catalog = { version: 1, tradition: ["Plato"], items: [] };
  const merged = mergeAdviceCatalog(mergeAdviceCatalog(catalog, entries), parseAdviceParagraphs("First line continued.", "aretology"));
  assert.equal(merged.items.length, 2);
  assert.deepEqual(merged.items[0].categories, ["aretology", "hermetica"]);
  assert.deepEqual(merged.tradition, catalog.tradition);
  assert.equal(merged.items[0].body, "First line\ncontinued.");
  assert.deepEqual(merged.items[0].sources, []);
});

test("nutrition matching covers supported scripts and ignores paused or future habits", () => {
  const habit = title => ({ id: "food", title, description: "", ritualName: "", createdDate: "2026-01-01", active: true,
    priority: 1, isKeyHabit: false, sourceTemplateId: null, sacredSectorId: null, schedule: { startDate: "2026-01-01", endDate: null } });
  for (const title of ["Пищевые привычки", "Balanced nutrition", "Διατροφή", "Gesunde Ernährung", "Alimentation", "Alimentación",
    "Alimentazione", "Alimentação", "Zdrowe odżywianie", "Здрава исхрана", "Здорове харчування", "每天规律饮食", "Dengeli beslenme", "毎日の食事"]) {
    assert.ok(adviceHabitTopicScores([habit(title)], "2026-10-22").nutrition > 0, title);
  }
  const food = habit("Пищевые привычки");
  assert.deepEqual(Object.keys(adviceHabitTopicScores([food], "2026-10-22")), [...ADVICE_TOPICS]);
  for (const changes of [{ active: false }, { createdDate: "2027-01-01" }, { schedule: { startDate: "2027-01-01", endDate: null } }]) {
    assert.ok(Object.values(adviceHabitTopicScores([{ ...food, ...changes }], "2026-10-22")).every(score => score === 0));
  }
  assert.deepEqual(adviceAvailableCategories(), ["aretology", "hermetica", "kourotrophy", "hestiology"]);
  assert.deepEqual(adviceAvailableCategories(["aretology", "kourotrophy"]), ["aretology", "kourotrophy"]);
  assert.deepEqual(adviceAvailableCategories([]), []);
});

test("private task intentions match clothing, attributes and cleaning in supported scripts without leaking text", () => {
  const task = title => ({ title, description: "", done: false, dueDate: "2026-10-23" });
  for (const title of ["Купить одежду", "Сходить пошопиться", "Buy clothes", "Acheter des chaussures", "Kleidung kaufen", "Comprar ropa", "Comprare scarpe", "Comprar roupas", "Kupić ubrania", "Купити одећу", "Купити одяг", "Kıyafet alışverişi", "买衣服", "服を買う", "Αγορά ρούχων"]) {
    const result = adviceTaskContext([task(title)], "2026-10-23");
    assert.ok(result.topics.clothing > 0 && result.scores.hestiology > 0, title);
    assert.ok(!JSON.stringify(result).includes(title));
  }
  assert.ok(adviceTaskContext([task("Купить какой-то атрибут")], "2026-10-23").topics.attributes > 0);
  for (const title of ["Купить куртку", "Buy a jacket", "Acheter un manteau", "Kupić płaszcz", "新しいコートを買う", "买袜子"])
    assert.ok(adviceTaskContext([task(title)], "2026-10-23").topics.clothing > 0, title);
  assert.ok(adviceTaskContext([task("Купить браслет")], "2026-10-23").topics.attributes > 0);
  for (const title of ["Shopping for groceries", "Lebensmittel einkaufen", "Compras de alimentos", "Сходить на шопинг за продуктами", "食品の買い物"])
    assert.equal(adviceTaskContext([task(title)], "2026-10-23").topics.clothing, 0, title);
  for (const title of ["为客户提供服务", "薬を服用する"])
    assert.equal(adviceTaskContext([task(title)], "2026-10-23").topics.clothing, 0, title);
  assert.ok(adviceTaskContext([task("Shopping for a shirt and groceries")], "2026-10-23").topics.clothing > 0);
  for (const title of ["Organise a meeting", "Разобрать задачи"])
    assert.equal(adviceTaskContext([task(title)], "2026-10-23").topics.cleaning, 0, title);
  for (const title of ["Запланировать уборку", "Clean the kitchen", "Nettoyer la maison", "Wohnung aufräumen", "Limpiar la casa", "Pulire la casa", "Limpeza da casa", "Sprzątanie", "Чишћење стана", "Прибирання", "Ev temizliği", "打扫房间", "部屋の掃除", "Καθαρισμός σπιτιού"])
    assert.ok(adviceTaskContext([task(title)], "2026-10-23").topics.cleaning > 0, title);
  for (const changes of [{ done: true }, { entryType: "birthday" }, { dueDate: "2027-01-01" }])
    assert.ok(Object.values(adviceTaskContext([{ ...task("Купить одежду"), ...changes }], "2026-10-23").topics).every(score => score === 0));
});

test("invalid imports fail before writing content or inventing citations", () => {
  assert.throws(() => parseAdviceParagraphs(" ", "hermetica"));
  assert.throws(() => parseAdviceParagraphs("Text", "unknown"));
  assert.throws(() => parseAdviceParagraphs("a".repeat(24001), "hermetica"));
  assert.throws(() => parseAdviceParagraphs("Text", "hermetica", { sources: [{ kind: "quote" }] }));
  const item = parseAdviceParagraphs("Example", "hermetica")[0];
  assert.throws(() => mergeAdviceCatalog({ version: 1, items: [item, item] }, []));
});

test("Kourotrophy interests use only eligible private tasks and active habits in supported languages", () => {
  const day = "2026-10-25";
  const task = title => ({ title, description: "", done: false, dueDate: day });
  const habit = title => ({ id: "family", title, description: "", ritualName: "", createdDate: "2026-01-01", active: true,
    priority: 1, isKeyHabit: false, sourceTemplateId: null, sacredSectorId: null, schedule: { startDate: "2026-01-01", endDate: null } });
  for (const title of ["Почитать с детьми", "Read with children", "Χρόνος με τα παιδιά", "Mit Kindern lesen", "Lire avec les enfants",
    "Leer con los hijos", "Leggere con i bambini", "Ler com as crianças", "Czytać z dziećmi", "Читање са децом", "Читати з дітьми", "陪孩子阅读", "Çocuklarla okumak", "子どもと読書"]) {
    const context = adviceTaskContext([task(title)], day);
    assert.ok(context.scores.kourotrophy > 0 && context.topics.parenting > 0, title);
    assert.ok(adviceHabitTopicScores([habit(title)], day).parenting > 0, title);
    assert.ok(!JSON.stringify(context).includes(title), "Personal wording must not leave the device");
  }
  const paternal = adviceTaskContext([task("Развивать отцовство и заниматься с сыном")], day);
  assert.ok(paternal.topics.fatherhood > 0 && paternal.topics.sons > 0);
  assert.ok(adviceTaskContext([task("Осознанное материнство")], day).topics.motherhood > 0);
  assert.ok(adviceTaskContext([task("Составить родословную предков")], day).topics.heritage > 0);
  for (const title of ["Personal development", "Синхронизация календаря", "Подарок папе", "Позвонить маме", "Mason work", "Купить материнскую плату"]) {
    const context = adviceTaskContext([task(title)], day);
    assert.equal(context.topics.fatherhood + context.topics.motherhood + context.topics.sons, 0, title);
  }
  for (const changes of [{ done: true }, { entryType: "birthday" }, { dueDate: "2027-05-01" }]) {
    const context = adviceTaskContext([{ ...task("Занятие с сыном"), ...changes }], day);
    assert.equal(context.scores.kourotrophy + context.topics.sons, 0);
  }
  for (const changes of [{ active: false }, { createdDate: "2027-01-01" }, { schedule: { startDate: "2027-01-01" } }]) {
    assert.equal(adviceHabitTopicScores([{ ...habit("Отцовство и занятия с сыном"), ...changes }], day).fatherhood, 0);
  }
});

test("all fourteen interface locales cover every control and all six categories", async () => {
  const copy = JSON.parse(await readFile(new URL("../app/daily-advice-copy.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(copy).length, 14);
  for (const locale of Object.values(copy)) {
    assert.deepEqual(Object.keys(locale).sort(), Object.keys(copy.ru).sort());
    assert.equal(locale.categories.length, adviceCategories.length);
    assert.equal(locale.categoryHints.length, adviceCategories.length);
    assert.ok(Object.values(locale).every(value => typeof value === "string" ? value.length > 0 : value.every(Boolean)));
  }
});

test("published advice has complete titles and bodies in all fourteen languages and distinct real artwork", async () => {
  const result = await verifyDailyAdvice();
  assert.deepEqual(result, { published: 853, drafts: 0, languages: 14, illustrations: 853 });
  const catalog = JSON.parse(await readFile(new URL("../server/content/daily-advice.json", import.meta.url), "utf8"));
  assert.equal(catalog.items.filter(entry => entry.categories.includes("hestiology")).length, 152);
  assert.equal(catalog.items.filter(entry => entry.categories.includes("kourotrophy")).length, 89);
  assert.equal(catalog.items.filter(entry => entry.categories.includes("hermetica")).length, 151);
  assert.deepEqual([...new Set(catalog.items.flatMap(entry => entry.categories))].sort(), ["aphrodisia", "aretology", "hermetica", "hestiology", "kourotrophy", "psychopompia"]);
  assert.equal(catalog.items[18].title, "Точность Прямодействия");
  assert.ok(catalog.items[18].body.endsWith("Любая задача, которую ты решил довести до конца, должна выполняться с предельной интенсивностью, без оглядки на усталость."));
  assert.equal(catalog.items[18].status, undefined);
  assert.equal(catalog.items[25].id, "advice-a981fcbe698a094088afcbd5");
  assert.deepEqual(catalog.items.map((entry, index) => entry.status === "draft" ? index + 1 : null).filter(Boolean), []);
});

test("reviewed locale pairs reject another advice's title or body in every language", async () => {
  const catalog = JSON.parse(await readFile(new URL("../server/content/daily-advice.json", import.meta.url), "utf8"));
  const review = JSON.parse(await readFile(new URL("../server/content/daily-advice-pairings.json", import.meta.url), "utf8"));
  const fasting = catalog.items.find(entry => entry.id === "advice-fe0f86e475bc9350744f1095");
  const other = catalog.items[0];
  for (const language of adviceLanguages) {
    const locale = JSON.parse(await readFile(new URL(`../server/content/daily-advice/${fasting.contentVersion}/${language}.json`, import.meta.url), "utf8"));
    assert.doesNotThrow(() => verifyAdvicePairing(fasting, language, locale[fasting.id], review.entries[fasting.id]));
    assert.throws(() => verifyAdvicePairing(fasting, language, { ...locale[fasting.id], title: locale[other.id].title }, review.entries[fasting.id]), /title\/body pairing/);
    assert.throws(() => verifyAdvicePairing(fasting, language, { ...locale[fasting.id], body: locale[other.id].body }, review.entries[fasting.id]), /title\/body pairing/);
    const formerTitle = review.titleCorrections.find(change => change.id === fasting.id).locales[language].before;
    assert.throws(() => verifyAdvicePairing(fasting, language, { ...locale[fasting.id], title: formerTitle }, review.entries[fasting.id]), /title\/body pairing/);
  }
});

test("reviewed advice identity also binds category, illustration, version and language", async () => {
  const catalog = JSON.parse(await readFile(new URL("../server/content/daily-advice.json", import.meta.url), "utf8"));
  const review = JSON.parse(await readFile(new URL("../server/content/daily-advice-pairings.json", import.meta.url), "utf8"));
  const entry = catalog.items[0], other = catalog.items[1];
  const content = { title: entry.title, body: entry.body };
  for (const change of [{ id: other.id }, { categories: ["hestiology"] }, { image: other.image }, { contentVersion: "other-version" }]) {
    assert.throws(() => verifyAdvicePairing({ ...entry, ...change }, "ru", content, review.entries[entry.id]), /title\/body pairing/);
  }
  assert.throws(() => verifyAdvicePairing(entry, "en", content, review.entries[entry.id]), /title\/body pairing/);
  assert.throws(() => verifyAdvicePairing(entry, "ru", content, undefined), /title\/body pairing/);
});

test("Kourotrophy keeps every original source pair and rejects mixed titles in every locale", async () => {
  const catalog = JSON.parse(await readFile(new URL("../server/content/daily-advice.json", import.meta.url), "utf8"));
  const source = JSON.parse(await readFile(new URL("../server/content/kourotrophy-source-manifest.json", import.meta.url), "utf8"));
  const review = JSON.parse(await readFile(new URL("../server/content/daily-advice-pairings.json", import.meta.url), "utf8"));
  assert.equal(source.sourceSha256, "b4a97ef8f67fd5b5e9814873380fa8a5a70f37ddebdf5a5dd8af8ec844c4e1bc");
  assert.deepEqual(source.entries.map(entry => entry.number), Array.from({ length: 89 }, (_, index) => index + 1));
  const entries = catalog.items.filter(entry => entry.categories.includes("kourotrophy"));
  for (const language of adviceLanguages) {
    const locale = JSON.parse(await readFile(new URL(`../server/content/daily-advice/${entries[0].contentVersion}/${language}.json`, import.meta.url), "utf8"));
    assert.equal(Object.keys(locale).length, 89);
    for (const [index, entry] of entries.entries()) {
      const content = locale[entry.id], other = locale[entries[(index + 1) % entries.length].id];
      assert.doesNotThrow(() => verifyAdvicePairing(entry, language, content, review.entries[entry.id]));
      // Some source headings intentionally recur with different bodies; skip an identical title only.
      if (other.title !== content.title) assert.throws(() => verifyAdvicePairing(entry, language, { ...content, title: other.title }, review.entries[entry.id]), /title\/body pairing/);
      assert.throws(() => verifyAdvicePairing(entry, language, { ...content, body: other.body }, review.entries[entry.id]), /title\/body pairing/);
    }
  }
});

test("Hermetica preserves all 151 source headings and binds each localized body to its own title", async () => {
  const catalog = JSON.parse(await readFile(new URL("../server/content/daily-advice.json", import.meta.url), "utf8"));
  const source = JSON.parse(await readFile(new URL("../server/content/hermetica-source-manifest.json", import.meta.url), "utf8"));
  const review = JSON.parse(await readFile(new URL("../server/content/daily-advice-pairings.json", import.meta.url), "utf8"));
  assert.equal(source.sourceSha256, "d22ce396728544bf9494f63c48e308eede096938eb5863903bddc0411ef57d96");
  assert.deepEqual(source.entries.map(entry => entry.number), Array.from({ length: 151 }, (_, index) => index + 1));
  const entries = catalog.items.filter(entry => entry.categories.includes("hermetica"));
  assert.deepEqual(entries.slice(28, 31).map(entry => entry.title), [
    'Метод "Управляемого кризиса" (Проблема - Реакция - Решение)',
    'Коммодификация бунта (Марксистский метод)',
    'Конструирование "Нового человека"',
  ]);
  assert.deepEqual(source.entries.filter(entry => entry.headingSeparator === "\n").map(entry => entry.number), [29, 30, 31]);
  assert.equal(entries[13].timeOfDay, "morning");
  for (const language of adviceLanguages) {
    const locale = JSON.parse(await readFile(new URL(`../server/content/daily-advice/${entries[0].contentVersion}/${language}.json`, import.meta.url), "utf8"));
    assert.equal(Object.keys(locale).length, 151);
    for (const [index, entry] of entries.entries()) {
      const content = locale[entry.id], other = locale[entries[(index + 1) % entries.length].id];
      assert.doesNotThrow(() => verifyAdvicePairing(entry, language, content, review.entries[entry.id]));
      if (other.title !== content.title) assert.throws(() => verifyAdvicePairing(entry, language, { ...content, title: other.title }, review.entries[entry.id]), /title\/body pairing/);
      assert.throws(() => verifyAdvicePairing(entry, language, { ...content, body: other.body }, review.entries[entry.id]), /title\/body pairing/);
    }
  }
});

test("smart affinity uses only active, current habits and keeps all six numeric scores private", () => {
  const habit = (changes = {}) => ({ id: "fixture", title: "", description: "", ritualName: "", createdDate: "2026-01-01", active: true,
    priority: 1, isKeyHabit: false, sourceTemplateId: null, sacredSectorId: null, schedule: { startDate: "2026-01-01", endDate: null }, ...changes });
  const scores = adviceHabitScores([habit({ title: "Read Plato", sourceTemplateId: "reading" }), habit({ title: "Home cleaning", id: "home" })], "2026-10-22");
  assert.ok(scores.hermetica > 0 && scores.hestiology > 0);
  assert.equal(scores.aphrodisia, 0);
  for (const changes of [{ active: false }, { createdDate: "2027-01-01" }, { schedule: { startDate: "2027-01-01", endDate: null } },
    { schedule: { startDate: "2026-01-01", endDate: "2026-09-01" } }, { lifecycleHistory: [{ habitId: "fixture", id: "archive", date: "2026-10-20", status: "archived", baselineActive: true, replaces: [] }] }]) {
    assert.ok(Object.values(adviceHabitScores([habit({ ...changes, title: "Training", sourceTemplateId: "walk" })], "2026-10-22")).every(value => value === 0));
  }
  const workout = adviceHabitScores([habit({ title: "Workout" })], "2026-10-22");
  assert.ok(workout.aretology > 0); assert.equal(workout.hermetica, 0);
  assert.deepEqual(Object.keys(scores), adviceCategories);
  assert.equal(advicePreferences({ enabled: false }).enabled, false);
  assert.equal(advicePreferences().smart, true);
});


test("Aphrodisia requires explicit opt-in, including legacy default selections", () => {
  assert.ok(!advicePreferences().categories.includes("aphrodisia"));
  assert.ok(!advicePreferences({categories: adviceCategories}).categories.includes("aphrodisia"));
  const selected={categories: ["aphrodisia"], aphrodisiaAdult: false};
  assert.deepEqual(advicePreferences(selected).categories,["aphrodisia"]);
  assert.equal(advicePreferences(selected).aphrodisiaAdult,false);
  assert.equal(advicePreferences({...selected,aphrodisiaAdult:true}).aphrodisiaAdult,true);
});

test("Aphrodisia source, age flags and themes are paired with every published translation", async () => {
  const catalog=JSON.parse(await readFile(new URL("../server/content/daily-advice.json",import.meta.url),"utf8"));
  const entries=catalog.items.filter(e => e.categories.includes("aphrodisia"));
  assert.equal(entries.length,120);
  assert.equal(entries.filter(e=>e.requiresAdult).length,64);
  assert.deepEqual([...new Set(entries.map(e=>e.aphrodisiaTheme))].sort(),["aesthetics","consciousness","love"]);
  const manifest=JSON.parse(await readFile(new URL("../server/content/aphrodisia-source-manifest.json",import.meta.url),"utf8"));
  assert.equal(manifest.entries.length,120);
  for(const entry of entries) {
    const source=manifest.entries.find(e=>e.id===entry.id);
    assert.equal(entry.requiresAdult,source.requiresAdult);
    assert.equal(entry.aphrodisiaTheme,source.aphrodisiaTheme);
  }
});
