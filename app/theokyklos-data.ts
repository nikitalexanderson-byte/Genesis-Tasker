export type TheokyklosSegmentId =
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest"
  | "zenith"
  | "nadir"
  | "hearth"
  | "center"
  | "entrance"
  | "exit";

export type TheokyklosGroup = "paired" | "single" | "axis" | "core" | "threshold";

export type TheokyklosLocalizedText = {
  ru: string;
  en: string;
};

export type TheokyklosSacredWord = {
  greek: string;
  pronunciation: TheokyklosLocalizedText;
  meaning: TheokyklosLocalizedText;
};

export type TheokyklosSegment = {
  id: TheokyklosSegmentId;
  group: TheokyklosGroup;
  angle?: number;
  symbol: string;
  short: TheokyklosLocalizedText;
  title: TheokyklosLocalizedText;
  patrons: TheokyklosLocalizedText;
  essence: TheokyklosLocalizedText;
  description: TheokyklosLocalizedText;
  words: readonly TheokyklosSacredWord[];
};

const word = (
  greek: string,
  ruPronunciation: string,
  enPronunciation: string,
  ruMeaning: string,
  enMeaning: string,
): TheokyklosSacredWord => ({
  greek,
  pronunciation: { ru: ruPronunciation, en: enPronunciation },
  meaning: { ru: ruMeaning, en: enMeaning },
});

export const THEOKYKLOS_SEGMENTS: readonly TheokyklosSegment[] = [
  {
    id: "north",
    group: "single",
    angle: -90,
    symbol: "ΑΘ",
    short: { ru: "С", en: "N" },
    title: { ru: "Север · Суверенный Разум", en: "North · Sovereign Mind" },
    patrons: { ru: "Афина", en: "Athena" },
    essence: { ru: "Суверенный разум и непробиваемая стратегия.", en: "Sovereign intelligence and impenetrable strategy." },
    description: {
      ru: "Великая Богиня-Девственница. Вектор чистой, холодной стратегии, безупречного действия и триумфа сознания, не зависящего ни от чьей чужой воли.",
      en: "The great virgin goddess. A vector of pure, cool strategy, flawless action, and the triumph of a consciousness that depends on no external will.",
    },
    words: [
      word("Μῆτις", "Ме-тис", "Me-tis", "Разум.", "Intelligence."),
      word("Σοφά", "Со-фа", "So-pha", "Мудрая.", "The Wise One."),
      word("Πρόνοια", "Про-ной-а", "Pro-noi-a", "Высшее предвидение.", "Higher foresight."),
      word("Κραταιά", "Кра-тай-а", "Kra-tai-a", "Несокрушимая мощь.", "Unbreakable might."),
    ],
  },
  {
    id: "northeast",
    group: "single",
    angle: -45,
    symbol: "ΑΡ",
    short: { ru: "СВ", en: "NE" },
    title: { ru: "Северо-Восток · Дикая Природа", en: "Northeast · Wild Nature" },
    patrons: { ru: "Артемида", en: "Artemis" },
    essence: { ru: "Тотальная независимость и дикая граница пространства.", en: "Total independence and the wild boundary of space." },
    description: {
      ru: "Богиня-Девственница. Вектор абсолютной независимости, чистых инстинктов и жёсткой защиты сакральных границ практика от любого внешнего посягательства.",
      en: "The virgin goddess. A vector of absolute independence, pure instinct, and fierce protection of the practitioner's sacred boundaries from every intrusion.",
    },
    words: [
      word("Ἁγνή", "Аг-не", "Hag-ne", "Чистая.", "The Pure One."),
      word("Ἄγρια", "А-гри-а", "A-gri-a", "Дикая.", "The Wild One."),
      word("Παρθένος", "Пар-те-нос", "Par-the-nos", "Неприкосновенная.", "The Untouched One."),
      word("Ἀγροτέρα", "А-гро-те-ра", "A-gro-te-ra", "Свирепая охотница.", "The fierce huntress."),
    ],
  },
  {
    id: "east",
    group: "paired",
    angle: 0,
    symbol: "☿",
    short: { ru: "В", en: "E" },
    title: { ru: "Восток · Рассвет и Интеллект", en: "East · Dawn and Intellect" },
    patrons: { ru: "Гермес и Пейто", en: "Hermes and Peitho" },
    essence: { ru: "Рассвет интеллекта и магия абсолютного убеждения.", en: "The dawn of intellect and the magic of absolute persuasion." },
    description: {
      ru: "Чистый пронзающий интеллект. Олимпиец Гермес — бог магии и путей, Пейто — богиня убеждения. Вместе они радостно и легко заставляют реальность подчиняться воле практика.",
      en: "Pure, piercing intellect. Olympian Hermes is the god of magic and paths; Peitho is the goddess of persuasion. Together they joyfully and effortlessly bring reality into alignment with the practitioner's will.",
    },
    words: [
      word("Λόγος", "Ло-гос", "Lo-gos", "Высший смысл.", "Higher meaning."),
      word("Φωνή", "Фо-не", "Pho-ne", "Голос власти.", "Voice of authority."),
      word("Ἔννοια", "Эн-ной-а", "En-noi-a", "Чёткий замысел.", "Clear intention."),
      word("Ὁμόνοια", "О-мо-ной-а", "Ho-mo-noi-a", "Единомыслие и согласие.", "Unity of mind and accord."),
    ],
  },
  {
    id: "southeast",
    group: "paired",
    angle: 45,
    symbol: "⚒",
    short: { ru: "ЮВ", en: "SE" },
    title: { ru: "Юго-Восток · Кузня Силы", en: "Southeast · Forge of Power" },
    patrons: { ru: "Гефест и Аглая", en: "Hephaestus and Aglaea" },
    essence: { ru: "Алхимия творения и чистое сияние результата.", en: "The alchemy of creation and the pure radiance of the result." },
    description: {
      ru: "Самый светлый брак по Гесиоду. Олимпиец Гефест и Харита Сияния Аглая. Вектор, где грубая материя перековывается в божественное великолепие и совершенство.",
      en: "The brightest marriage in Hesiod: Olympian Hephaestus and Aglaea, the Charis of Radiance. A vector in which raw matter is reforged into divine splendor and perfection.",
    },
    words: [
      word("Αἴγλη", "Ай-гле", "Ai-gle", "Великолепие.", "Splendor."),
      word("Τέχνη", "Тех-не", "Tech-ne", "Мастерство.", "Mastery."),
      word("Πυρφόρος", "Пюр-фо-рос", "Pyr-pho-ros", "Огненосный.", "Fire-bearing."),
      word("Φαίδιμος", "Фай-ди-мос", "Phai-di-mos", "Блистательный.", "Radiant."),
    ],
  },
  {
    id: "south",
    group: "paired",
    angle: 90,
    symbol: "♂♀",
    short: { ru: "Ю", en: "S" },
    title: { ru: "Юг · Победоносная Энергия", en: "South · Victorious Energy" },
    patrons: { ru: "Арес и Афродита", en: "Ares and Aphrodite" },
    essence: { ru: "Победоносный натиск, питаемый жаждой жизни.", en: "A victorious surge nourished by the thirst for life." },
    description: {
      ru: "Идеальный баланс. Арес даёт кинетическую энергию прорыва, Афродита наполняет её любовью к жизни. Итог — абсолютная космическая Гармония.",
      en: "Perfect balance. Ares gives the kinetic energy of breakthrough; Aphrodite fills it with love of life. The result is absolute cosmic Harmony.",
    },
    words: [
      word("Πάθος", "Па-тос", "Pa-thos", "Всепоглощающая страсть.", "All-consuming passion."),
      word("Ὁρμή", "Ор-ме", "Hor-me", "Стремительный натиск.", "Swift drive."),
      word("Ἁρμονία", "Хар-мо-ни-а", "Har-mo-ni-a", "Космическая гармония.", "Cosmic harmony."),
      word("Νικηφόρος", "Ни-ке-фо-рос", "Ni-ke-pho-ros", "Победоносный.", "Victory-bearing."),
    ],
  },
  {
    id: "southwest",
    group: "single",
    angle: 135,
    symbol: "ΔΗ",
    short: { ru: "ЮЗ", en: "SW" },
    title: { ru: "Юго-Запад · Сила Земли и Труд", en: "Southwest · Earth and Labor" },
    patrons: { ru: "Деметра", en: "Demeter" },
    essence: { ru: "Сила земли, колоссальный труд и изобилие.", en: "The strength of the earth, immense labor, and abundance." },
    description: {
      ru: "Вектор колоссальной, материнской мощи самой Земли. Упорный, тяжёлый труд, изобилие и защита плодов своих сверхусилий.",
      en: "A vector of the immense maternal power of Earth herself: steadfast, demanding labor, abundance, and protection of the fruits of extraordinary effort.",
    },
    words: [
      word("Καρπός", "Кар-пос", "Kar-pos", "Плод усилий.", "Fruit of effort."),
      word("Τροφός", "Тро-фос", "Tro-phos", "Питающая опора.", "Nourishing support."),
      word("Δέσποινα", "Дес-пой-на", "Des-poi-na", "Владычица.", "The Mistress."),
      word("Εὐκαρπία", "Эв-кар-пи-а", "Eu-kar-pi-a", "Богатое плодородие.", "Rich fertility."),
    ],
  },
  {
    id: "west",
    group: "paired",
    angle: 180,
    symbol: "♆",
    short: { ru: "З", en: "W" },
    title: { ru: "Запад · Воды Психики", en: "West · Waters of the Psyche" },
    patrons: { ru: "Посейдон и Амфитрита", en: "Poseidon and Amphitrite" },
    essence: { ru: "Управление трансом и глубокими водами подсознания.", en: "Command of trance and the deep waters of the subconscious." },
    description: {
      ru: "Светлый миф о любви. Олимпиец Посейдон разрушает преграды приливной волной транса, а его царица Амфитрита позволяет уверенно управлять самыми глубокими водами психики.",
      en: "A luminous myth of love. Olympian Poseidon breaks barriers with the tidal wave of trance, while his queen Amphitrite grants confident command of the psyche's deepest waters.",
    },
    words: [
      word("Βυθός", "Бю-тос", "By-thos", "Бездонная глубина.", "Bottomless depth."),
      word("Ροή", "Ро-э", "Ro-e", "Непрерывный поток.", "Unbroken flow."),
      word("Γαλήνη", "Га-ле-не", "Ga-le-ne", "Абсолютный штиль.", "Absolute calm."),
      word("Ἀσφάλειος", "Ас-фа-лей-ос", "As-pha-lei-os", "Дарующий непоколебимость.", "Giver of steadfastness."),
    ],
  },
  {
    id: "northwest",
    group: "single",
    angle: 225,
    symbol: "☉",
    short: { ru: "СЗ", en: "NW" },
    title: { ru: "Северо-Запад · Свет и Прозрение", en: "Northwest · Light and Insight" },
    patrons: { ru: "Аполлон", en: "Apollo" },
    essence: { ru: "Ясный свет прозрения и беспощадная логика.", en: "The clear light of insight and relentless logic." },
    description: {
      ru: "Одиночный вектор солнечной логики, пророческого видения и высшего искусства. Свет, который безжалостно выжигает любую тьму невежества.",
      en: "A solitary vector of solar logic, prophetic vision, and the highest art: light that relentlessly burns away every darkness of ignorance.",
    },
    words: [
      word("Φάος", "Фа-ос", "Pha-os", "Свет истины.", "Light of truth."),
      word("Μάντις", "Ман-тис", "Man-tis", "Провидец.", "Seer."),
      word("Λύκειος", "Лю-кей-ос", "Ly-kei-os", "Светозарный.", "The Radiant One."),
      word("Καθάρσιος", "Ка-тар-си-ос", "Ka-thar-si-os", "Очиститель пространства.", "Purifier of space."),
    ],
  },
  {
    id: "zenith",
    group: "axis",
    symbol: "♃",
    short: { ru: "ЗЕНИТ", en: "ZENITH" },
    title: { ru: "Зенит · Вертикаль Власти", en: "Zenith · Axis of Authority" },
    patrons: { ru: "Зевс и Гера", en: "Zeus and Hera" },
    essence: { ru: "Высший закон и незыблемый порядок.", en: "Higher law and immutable order." },
    description: {
      ru: "Позитивная манифестация Высшего космического закона, абсолютного порядка и незыблемого триумфа духа.",
      en: "The positive manifestation of the highest cosmic law, absolute order, and the immutable triumph of spirit.",
    },
    words: [
      word("Κράτος", "Кра-тос", "Kra-tos", "Неоспоримая власть.", "Unquestioned authority."),
      word("Τάξις", "Так-сис", "Tak-sis", "Божественный строй.", "Divine order."),
      word("Ὕψιστος", "Хюп-сис-тос", "Hyp-sis-tos", "Высочайший.", "The Highest."),
      word("Βασιλεία", "Ба-си-лей-а", "Ba-si-lei-a", "Абсолютное царствование.", "Absolute sovereignty."),
    ],
  },
  {
    id: "nadir",
    group: "axis",
    symbol: "Π",
    short: { ru: "НАДИР", en: "NADIR" },
    title: { ru: "Надир · Глубины", en: "Nadir · The Depths" },
    patrons: { ru: "Аид и Персефона", en: "Hades and Persephone" },
    essence: { ru: "Хтоническая мудрость и скрытый потенциал.", en: "Chthonic wisdom and hidden potential." },
    description: {
      ru: "Скрытая мудрость подсознания. Гармоничные Владыки. Трансформация, где бережное отмирание старого даёт силу прорастать новым семенам.",
      en: "The hidden wisdom of the subconscious. Harmonious sovereigns. A transformation in which the gentle passing of the old gives new seeds the strength to grow.",
    },
    words: [
      word("Πλοῦτος", "Плу-тос", "Plou-tos", "Богатство глубин.", "Wealth of the depths."),
      word("Βάθος", "Ба-тос", "Ba-thos", "Абсолютная бездна.", "Absolute abyss."),
      word("Χθόνιος", "Хто-ни-ос", "Chtho-ni-os", "Глубинный подземный.", "Deep and subterranean."),
      word("Ἀθέατος", "А-те-а-тос", "A-the-a-tos", "Невидимый глазу.", "Invisible to the eye."),
    ],
  },
  {
    id: "hearth",
    group: "core",
    symbol: "Ἑ",
    short: { ru: "ОЧАГ", en: "HEARTH" },
    title: { ru: "Внутреннее Кольцо · Очаг", en: "Inner Ring · Hearth" },
    patrons: { ru: "Гестия", en: "Hestia" },
    essence: { ru: "Сакральный покой и несокрушимость.", en: "Sacred stillness and inviolability." },
    description: {
      ru: "Старейшая Богиня-Девственница не занимает отдельный луч: она обволакивает сам Центр. Гестия хранит сакральный огонь Теокиклоса, гарантируя незыблемый покой пространства перед слиянием с Осью Абсолюта.",
      en: "The eldest virgin goddess occupies no separate ray; she surrounds the Center itself. Hestia guards the sacred fire of the Theokyklos, ensuring the inviolate stillness of the space before union with the Axis of the Absolute.",
    },
    words: [
      word("Ἕδρα", "Э-дра", "He-dra", "Твёрдое основание.", "Firm foundation."),
      word("Κέντρον", "Кен-трон", "Ken-tron", "Центр оси.", "Center of the axis."),
      word("Αἰώνια", "Ай-о-ни-а", "Ai-o-ni-a", "Вечная, непрерывная.", "Eternal and unbroken."),
      word("Πρυτανεῖον", "Прю-та-ней-он", "Pry-ta-nei-on", "Священный первоочаг.", "The sacred primal hearth."),
    ],
  },
  {
    id: "center",
    group: "core",
    symbol: "ΔΑ",
    short: { ru: "ЦЕНТР", en: "CENTER" },
    title: { ru: "Точка Абсолюта", en: "Point of the Absolute" },
    patrons: { ru: "Дионис и Ариадна", en: "Dionysus and Ariadne" },
    essence: { ru: "Экстатическое растворение и обретение истинной воли.", en: "Ecstatic dissolution and the discovery of true will." },
    description: {
      ru: "Их миф — это триумф над смертью. Дионис спасает Ариадну и дарует ей бессмертие. Он — центрирующий владыка, разрушающий иллюзии ума. Она — Хозяйка Лабиринта, указывающая путь истинной воли. Ядро и точка абсолютной сборки.",
      en: "Their myth is a triumph over death. Dionysus rescues Ariadne and grants her immortality. He is the centering lord who shatters the illusions of the mind. She is the Mistress of the Labyrinth who reveals the path of true will. Together they are the core and point of absolute integration.",
    },
    words: [
      word("Λύσις", "Лю-сис", "Ly-sis", "Освобождение от оков.", "Release from bonds."),
      word("Μίξις", "Мик-сис", "Mix-is", "Тотальное слияние.", "Total union."),
      word("Ἔκστασις", "Эк-ста-сис", "Ek-sta-sis", "Выход за пределы ума.", "Passage beyond the mind."),
      word("Μυστήριον", "Мюс-те-ри-он", "Mys-te-ri-on", "Сакральная тайна.", "Sacred mystery."),
    ],
  },
  {
    id: "entrance",
    group: "threshold",
    symbol: "ΑΙΘ",
    short: { ru: "ВХОД", en: "ENTRY" },
    title: { ru: "Вход · Врата Света", en: "Entry · Gate of Light" },
    patrons: { ru: "Эфир и Гемера", en: "Aether and Hemera" },
    essence: { ru: "Кристаллизация пространства перед работой.", en: "Crystallization of the space before the work begins." },
    description: {
      ru: "Бог горнего света и богиня ясного дня. Они сканируют входящего, выжигают весь профанный шум высшим светом и даруют ясный допуск в сакральное пространство.",
      en: "The god of the upper light and the goddess of bright day. They examine the entrant, burn away profane noise with the highest light, and grant clear passage into sacred space.",
    },
    words: [
      word("Αὐγή", "Ав-ге", "Au-ge", "Рассветный луч.", "Ray of dawn."),
      word("Αἰθήρ", "Э-тир", "Ai-ther", "Высший свет.", "The highest light."),
      word("Φωσφόρος", "Фос-фо-рос", "Phos-pho-ros", "Светоносный огонь.", "Light-bearing fire."),
      word("Κάθαρσις", "Ка-тар-сис", "Ka-thar-sis", "Тотальное очищение.", "Total purification."),
    ],
  },
  {
    id: "exit",
    group: "threshold",
    symbol: "ΕΡΩ",
    short: { ru: "ВЫХОД", en: "EXIT" },
    title: { ru: "Выход · Печать Души", en: "Exit · Seal of the Soul" },
    patrons: { ru: "Эрос и Психея", en: "Eros and Psyche" },
    essence: { ru: "Интеграция опыта в вечную суть.", en: "Integration of experience into the eternal essence." },
    description: {
      ru: "Бог любви и Богиня души. Их миф — абсолютный позитив и победа над любыми испытаниями. При выходе они бережно запечатывают полученный опыт, делая его частью бессмертной души, и возвращают практика в мир полностью обновлённым.",
      en: "The god of love and the goddess of the soul. Their myth is wholly affirmative: a victory over every trial. At the exit they gently seal the experience, make it part of the immortal soul, and return the practitioner to the world completely renewed.",
    },
    words: [
      word("Σφραγίς", "Сфра-гис", "Sphra-gis", "Несокрушимая печать.", "Unbreakable seal."),
      word("Ψυχή", "Псю-хе", "Psy-che", "Бессмертная душа.", "Immortal soul."),
      word("Ἀθάνατος", "А-та-на-тос", "A-tha-na-tos", "Неуязвимый тлену.", "Impervious to decay."),
      word("Οὐράνιος", "У-ра-ни-ос", "Ou-ra-ni-os", "Возвышенный небесный.", "Exalted and celestial."),
    ],
  },
] as const;

export const THEOKYKLOS_DIRECTION_IDS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const satisfies readonly TheokyklosSegmentId[];
