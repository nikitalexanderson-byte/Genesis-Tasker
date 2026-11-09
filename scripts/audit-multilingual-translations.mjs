import { readFile } from "node:fs/promises";

const languages = ["el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const english = { ...JSON.parse(await readFile(new URL("../app/ui-translations/en.json", import.meta.url), "utf8")), ...JSON.parse(await readFile(new URL("../app/translations.en.json", import.meta.url), "utf8")),
  ...JSON.parse(await readFile(new URL("../app/curated-translations.en.json", import.meta.url), "utf8")) };
const refinementCopy = JSON.parse(await readFile(new URL("../app/ui-refinement-copy.json", import.meta.url), "utf8"));
Object.assign(english, refinementCopy.en);
const missing = [];
// Official Russian identity and tax-app name remain verbatim in translated legal notices.
// Only these two exact notices receive this token-level allowance; their remaining text is still audited.
const releaseLegal = JSON.parse(await readFile(new URL("../app/release-318-legal-copy.json", import.meta.url), "utf8"));
const legalIdentityKeys = new Set([releaseLegal.ru.identity, releaseLegal.ru.performer]);

const trialCopy = JSON.parse(await readFile(new URL("../app/billing-trial-copy.json", import.meta.url), "utf8"));
for (const language of ['ru','en',...languages]) {
  const copy=trialCopy[language];
  for (const key of Object.keys(trialCopy.ru)) {
    const value=copy?.[key];
    if(typeof value!=='string'||!value.trim()||!['ru','sr','uk'].includes(language)&&/[А-Яа-яЁё]/u.test(value)) missing.push(language+': invalid trial '+key);
    const variables=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort().join(',');
    if(typeof value==='string'&&variables(value)!==variables(trialCopy.ru[key])) missing.push(language+': trial placeholders changed '+key);
  }
}
const habitReportCopy = JSON.parse(await readFile(new URL("../app/habit-report-translations.json", import.meta.url), "utf8"));
const fieldRecoveryCopy = JSON.parse(await readFile(new URL("../app/custom-field-recovery-translations.json", import.meta.url), "utf8"));
Object.assign(english, habitReportCopy.en, fieldRecoveryCopy.en);
Object.assign(english,JSON.parse(await readFile(new URL("../app/shared-work-translations/en.json",import.meta.url),"utf8")));
const welcomeParagraphs = [
  "GENESIS — приложение для планирования личных и рабочих задач, проектов, подпроектов, повторений и напоминаний. Календарь помогает составлять план дня, связывать действия и отмечать выполненное на компьютере или телефоне.",
  "Сначала Google передаёт только подтверждённый адрес, имя и изображение профиля для безопасного входа. Уже после входа вы сами решаете, подключать ли синхронизацию: GENESIS создаёт отдельный календарь GENESIS, а доступ к Google Tasks использует для показа и двустороннего изменения ваших списков и задач. Разрешения не применяются для рекламы, профилирования или обучения моделей.",
];
const accountDomainKey = "GENESIS никогда не запрашивает пароль от Google. Авторизация выполняется только на защищённой странице accounts.google.com.";
const ancientNameLabels = {
  "Артемида": "Artemis",
  "Геката": "Hecate",
  "Зевс": "Zeus",
  "Гера": "Hera",
  "Посейдон": "Poseidon",
  "Гесиод": "Hesiod",
  "Гомер": "Homer",
  "Пифагор": "Pythagoras",
  "Монада": "Monas",
  "Апейрон": "Apeiron",
  "Агонион": "Agonion",
  "Стойхейон": "Stoicheion",
  "Теокиклос": "Theokyklos",
  "· Пифмен": "· Pythmen",
  "Гно · Метэр · Басилея": "Gno · Meter · Basileia",
  "Гно · Метэр · Базилея": "Gno · Meter · Basileia",
  "Арес": "Ares", "Афродита": "Aphrodite", "Гермес": "Hermes",
  "Аполлон": "Apollo", "Деметра": "Demeter", "Гефест": "Hephaestus",
  "Афина": "Athena", "Гестия": "Hestia", "Диада": "Dyad",
  "Пентада": "Pentas", "Тетрада": "Tetras", "Триада": "Trias",
  "Эфир": "Aether",
};
const serbianNames = {"Artemis": "Артемида", "Hecate": "Хеката", "Zeus": "Зевс", "Hera": "Хера", "Poseidon": "Посејдон", "Hesiod": "Хесиод", "Homer": "Хомер", "Pythagoras": "Питагора", "Monas": "Монас", "Apeiron": "Апеирон", "Agonion": "Агонион", "Stoicheion": "Стоихејон", "Theokyklos": "Теокиклос", "Pythmen": "Питмен", "Gno": "Гно", "Meter": "Метер", "Basileia": "Басилеја", "Ares": "Арес", "Aphrodite": "Афродита", "Hermes": "Хермес", "Apollo": "Аполон", "Demeter": "Деметра", "Hephaestus": "Хефест", "Athena": "Атина", "Hestia": "Хестија", "Dyad": "Дијада", "Pentas": "Пентас", "Tetras": "Тетрас", "Trias": "Тријас", "Aether": "Етар", "Nyx": "Никс", "Erebus": "Еребос", "Tartaros": "Тартарос", "Eros": "Ерос", "Phanes": "Фанес"};
const serbianTerm = value => value.replace(/\b[A-Za-z]+\b/g, term => serbianNames[term] ?? term);
const serbianNameLabels = Object.fromEntries(Object.entries(ancientNameLabels).map(([key,value]) => [key,serbianTerm(value)]));
const ukrainianNameLabels = {
  "Артемида": "Артеміда", "Геката": "Геката", "Зевс": "Зевс", "Гера": "Гера",
  "Пифагор": "Піфагор", "Посейдон": "Посейдон", "Гесиод": "Гесіод", "Гомер": "Гомер",
  "Монада": "Монас", "Апейрон": "Апейрон", "Агонион": "Агоніон",
  "Стойхейон": "Стойхейон",
  "Теокиклос": "Теокіклос", "· Пифмен": "· Піфмен",
  "Гно · Метэр · Басилея": "Гно · Метер · Басілея",
  "Гно · Метэр · Базилея": "Гно · Метер · Басілея",
  "Арес": "Арес", "Афродита": "Афродіта", "Гермес": "Гермес",
  "Аполлон": "Аполлон", "Деметра": "Деметра", "Гефест": "Гефест",
  "Афина": "Афіна", "Гестия": "Гестія", "Диада": "Діада",
  "Пентада": "Пентас", "Тетрада": "Тетрас", "Триада": "Тріас",
  "Эфир": "Ефір",
};
const stoicheionPhrases = [
  "Гадания в Стойхейоне",
  "Гадания отключены. В Стойхейоне остались только карты и их значения.",
  "Гадания снова доступны в Стойхейоне.",
];
const greekCompoundNames = {
  "Нюкс · Ночь": ["Nyx", "Нікс"],
  "Эребос · Мрак": ["Erebus", "Еребос"],
  "Тартарос · Бездна": ["Tartaros", "Тартарос"],
  "Эрос · Влечение": ["Eros", "Ерос"],
  "Фанес · Сияние": ["Phanes", "Фанес"],
};
const cjkGreekNames = {
  "Стойхейон": "Stoicheion", "Теокиклос": "Theokyklos", "Монад": "Monas",
  "Пифмен": "Pythmen", "Артемид": "Artemis", "Гекат": "Hecate",
  "Зевс": "Zeus", "Кронос": "Cronus", "Аид": "Hades",
  "Посейдон": "Poseidon", "Пифагор": "Pythagoras", "Гесиод": "Hesiod",
  "Гомер": "Homer", "Селен": "Selene", "Логос": "Logos",
  "Пневм": "Pneuma", "Агон": "Agon",
  "Апейрон": "Apeiron", "Арейос": "Areios", "Арес": "Ares",
  "Зофос": "Zophos", "Протогенос": "Protogenoi", "Титаномах": "Titanomachy",
  "Афродит": "Aphrodite", "Гермес": "Hermes", "Аполлон": "Apollo",
  "Деметр": "Demeter", "Гефест": "Hephaestus", "Гести": "Hestia",
  "Диад": "Dyad", "Пентад": "Pentas", "Тетрад": "Tetras",
  "Триад": "Trias", "Эфир": "Aether", "Дионис": "Dionysus",
  "Гелиос": "Helios", "Персефон": "Persephone", "Копьё Афины": "Athena",
};
const namedTermsInPhrases = {
  "Арес": ["Ares", "Арес"], "Афродит": ["Aphrodite", "Афродіт"],
  "Гермес": ["Hermes", "Гермес"], "Аполлон": ["Apollo", "Аполлон"],
  "Деметр": ["Demeter", "Деметр"], "Гефест": ["Hephaestus", "Гефест"],
  "Афин": ["Athena", "Афін"], "Гест": ["Hestia", "Гест"],
  "Апейрон": ["Apeiron", "Апейрон"], "Стойхейон": ["Stoicheion", "Стойхейон"],
  "Теокиклос": ["Theokyklos", "Теокіклос"],
};
const greekTermsInPhrases = {
  "Арес": "Άρης", "Афродит": "Αφροδίτη", "Гермес": "Ερμής",
  "Аполлон": "Απόλλων", "Деметр": "Δήμητρα", "Гефест": "Ήφαιστος",
  "Афин": "Αθηνά", "Гест": "Εστία", "Апейрон": "Ἄπειρον",
  "Стойхейон": "Στοιχεῖον", "Теокиклос": "Θεόκυκλος",
};
const ukrainianNamedTermsInPhrases = {
  "Пентад": "Пентас", "Тетрад": "Тетрас", "Диад": "Діад", "Эфир": "Ефір",
};
const latinAncientNames = /\b(?:Apeiron|Ares|Aphrodite|Hermes|Apollo|Demeter|Hephaestus|Athena|Hestia|Pythagoras|Poseidon|Zeus|Hades|Stoicheion|Theokyklos|Anabasis|Dionysus|Gaia|Uranus|Aether|Chronos|Cronus|Selene|Logos|Pneuma|Nyx|Erebus|Tartaros|Phanes|Eros|Monas|Pentas|Dyad|Tetras|Trias|Areios|Zophos|Hesiod|Homer)\b/u;

for (const language of languages) {
  const files = ["el", "sr", "uk"].includes(language) ? [`${language}.a`, `${language}.b`]
    : ["ja", "de", "fr", "es", "it", "pl"].includes(language) ? [language, `${language}.b`] : [language];
  const catalog = Object.assign({}, ...await Promise.all(files.map(async (name) =>
    JSON.parse(await readFile(new URL(`../app/translations.${name}.json`, import.meta.url), "utf8")))));
  Object.assign(catalog, JSON.parse(await readFile(new URL(`../app/ui-translations/${language}.json`, import.meta.url), "utf8")), fieldRecoveryCopy[language], refinementCopy[language]);
  Object.assign(catalog, habitReportCopy[language]);
  Object.assign(catalog,JSON.parse(await readFile(new URL(`../app/shared-work-translations/${language}.json`,import.meta.url),"utf8")));
  const affairs = JSON.parse(await readFile(new URL("../app/native-affairs-translations.json", import.meta.url), "utf8"))[language];
  const englishUi = { ...JSON.parse(await readFile(new URL("../app/ui-translations/en.json", import.meta.url), "utf8")), ...refinementCopy.en };
  for (const [source, translated] of Object.entries(affairs)) if (source in englishUi && !(source in catalog)) catalog[source] = translated;
  for (const key of Object.keys(english)) {
    if (typeof catalog[key] !== "string" || !catalog[key].trim()) missing.push(`${language}: missing ${key}`);
  }
  for (const [key, value] of Object.entries(catalog)) {
    const scriptText = legalIdentityKeys.has(key) && typeof value === "string"
      ? value.replaceAll("Ляпин Никита Александрович", "").replaceAll("Мой налог", "") : value;
    const wrongScript = !["sr", "uk"].includes(language) && /[А-Яа-яЁё]/u.test(scriptText);
    if (typeof value !== "string" || !value.trim() || wrongScript || /GENESISS/u.test(value)) missing.push(`${language}: invalid ${key}`);
    if (language === "tr" && key.length < 30 && value.length > Math.max(40, key.length * 3))
      missing.push(`${language}: suspiciously repeated short label ${key}`);
  }
  for (const [key, expected] of Object.entries(language === "uk" ? ukrainianNameLabels : language === "sr" ? serbianNameLabels : ancientNameLabels)) {
    if (language === "el") {
      if (!catalog[key] || /[A-Za-zА-Яа-яЁё]/u.test(catalog[key])) missing.push(`el: ancient name must use Greek letters in ${key}`);
    } else if (catalog[key] !== expected) missing.push(`${language}: changed ancient name ${key}`);
  }
  for (const key of stoicheionPhrases) {
    if (!catalog[key]?.includes(language === "uk" ? "Стойхейон" : language === "sr" ? "Стоихејон" : language === "el" ? "Στοιχεῖον" : "Stoicheion"))
      missing.push(`${language}: Stoicheion name lost in ${key}`);
  }
  for (const [key, [latin, ukrainian]] of Object.entries(greekCompoundNames)) {
    if (language === "el") {
      if (!catalog[key] || /[A-Za-zА-Яа-яЁё]/u.test(catalog[key])) missing.push(`el: Greek compound name changed in ${key}`);
    } else if (!catalog[key]?.startsWith(`${language === "uk" ? ukrainian : language === "sr" ? serbianTerm(latin) : latin} · `))
      missing.push(`${language}: changed ancient name in ${key}`);
  }
  for (const [source, [latin, ukrainian]] of Object.entries(namedTermsInPhrases)) {
    for (const [key, value] of Object.entries(catalog)) {
      if (key.includes(source) && !value.includes(language === "uk" ? ukrainian : language === "sr" ? serbianTerm(latin) : language === "el" ? greekTermsInPhrases[source] : latin))
        missing.push(`${language}: ancient name missing in ${key}`);
    }
  }
  if (language === "uk") {
    for (const [key, value] of Object.entries(catalog)) {
      for (const [source, ukrainian] of Object.entries(ukrainianNamedTermsInPhrases)) {
        if (key.includes(source) && !value.includes(ukrainian))
          missing.push(`uk: ancient name missing in ${key}`);
      }
      if (latinAncientNames.test(value)) missing.push(`uk: Latin ancient name in ${key}`);
    }
  }
  if (["ja", "zh"].includes(language)) {
    for (const [key, value] of Object.entries(catalog)) {
      for (const [source, latin] of Object.entries(cjkGreekNames)) {
        if (key.includes(source) && !value.includes(latin))
          missing.push(`${language}: ${latin} missing in ${key}`);
      }
    }
  }
  if (language === "sr" && Object.values(catalog).some(value => latinAncientNames.test(value))) missing.push("sr: Latin ancient name remains");
  if (language === "sr" && Object.values(catalog).some((value) => /~@|¦|_BAR_|\$\[|›|ГЕНЕЗУС/u.test(value)))
    missing.push("sr: translation markup or encoding artifact remains");
  for (const key of ["Григорианский", "Сакральный", "Лунный", "Равноденствие", "Солнцестояние",
    "Спокойный", "Героический", "С иронией", "Уведомления привычек",
    "Число показывает, сколько напоминаний добавлено. Для события Google Calendar доступно не более пяти.",
    "За 1 сутки", "За 2 суток", "За 3 суток"]) {
    if (!catalog[key] || (language === "ja" && catalog[key] === "ログイン"))
      missing.push(`${language}: invalid calendar or reminder label ${key}`);
  }
  for (const key of welcomeParagraphs) {
    if (!catalog[key]) missing.push(`${language}: missing exact welcome paragraph`);
  }
  if (!catalog[accountDomainKey]?.includes("accounts.google.com"))
    missing.push(`${language}: Google account domain changed in translation`);
}

if (missing.length) {
  for (const issue of missing) console.error(issue);
  process.exitCode = 1;
} else {
  console.log("Twelve additional locale catalogs passed coverage and script checks.");
}
