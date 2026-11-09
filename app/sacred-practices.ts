export const SACRED_PRACTICE_SECTOR_IDS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "zenith",
  "nadir",
  "hearth",
  "center",
  "entrance",
  "exit",
] as const;

export type SacredPracticeSectorId = (typeof SACRED_PRACTICE_SECTOR_IDS)[number];

export const SACRED_COMPASS_SECTOR_IDS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "center",
] as const satisfies readonly SacredPracticeSectorId[];

export const SACRED_AXIS_SECTOR_IDS = ["zenith", "hearth", "nadir"] as const satisfies readonly SacredPracticeSectorId[];
export const SACRED_THRESHOLD_SECTOR_IDS = ["entrance", "exit"] as const satisfies readonly SacredPracticeSectorId[];

export const SACRED_SECTOR_NAMES: Readonly<Record<SacredPracticeSectorId, SacredPracticeLocalizedText>> = {
  north: { ru: "Север", en: "North" },
  northeast: { ru: "Северо-восток", en: "Northeast" },
  east: { ru: "Восток", en: "East" },
  southeast: { ru: "Юго-восток", en: "Southeast" },
  south: { ru: "Юг", en: "South" },
  southwest: { ru: "Юго-запад", en: "Southwest" },
  west: { ru: "Запад", en: "West" },
  northwest: { ru: "Северо-запад", en: "Northwest" },
  zenith: { ru: "Зенит", en: "Zenith" },
  nadir: { ru: "Надир", en: "Nadir" },
  hearth: { ru: "Очаг", en: "Hearth" },
  center: { ru: "Центр", en: "Center" },
  entrance: { ru: "Вход", en: "Entrance" },
  exit: { ru: "Выход", en: "Exit" },
};

export const STOICHEION_PRACTICE_SECTOR_IDS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
  "center",
] as const satisfies readonly SacredPracticeSectorId[];

export type StoicheionPracticeSectorId = (typeof STOICHEION_PRACTICE_SECTOR_IDS)[number];

export type SacredPracticeLocalizedText = {
  ru: string;
  en: string;
};

export type SacredPractice = {
  id: string;
  sectorId: SacredPracticeSectorId;
  emoji: string;
  title: SacredPracticeLocalizedText;
  /** Recognize unchanged titles saved before a catalog rename, without rewriting user data. */
  previousTitles?: readonly string[];
  description: SacredPracticeLocalizedText;
  myth: SacredPracticeLocalizedText;
  suggestedTime: string;
  priority: number;
  color: string;
};

export type SacredSectorGuidance = {
  sectorId: StoicheionPracticeSectorId;
  upright: SacredPracticeLocalizedText;
  reversed: SacredPracticeLocalizedText;
};

export const SACRED_SECTOR_GUIDANCE: readonly SacredSectorGuidance[] = [
  {
    sectorId: "north",
    upright: { ru: "Сила Афины проявлена: превратите ясную мысль в один выполнимый замысел.", en: "Athena's power is present: turn clear thought into one executable intention." },
    reversed: { ru: "Мудрость заслонена шумом: остановитесь, отделите факт от страха и выберите один следующий шаг.", en: "Wisdom is obscured by noise: pause, separate fact from fear, and choose one next step." },
  },
  {
    sectorId: "northeast",
    upright: { ru: "Артемида поддерживает самостоятельность: сохраните пространство для тела, природы и личных границ.", en: "Artemis supports self-reliance: protect space for your body, nature, and personal boundaries." },
    reversed: { ru: "Инстинкт потерял направление: вернитесь к телу и восстановите одну нарушенную границу.", en: "Instinct has lost direction: return to the body and restore one crossed boundary." },
  },
  {
    sectorId: "east",
    upright: { ru: "Гермес и Пейто открывают путь слову: назовите намерение и передайте его ясно.", en: "Hermes and Peitho open the way for speech: name your intention and communicate it clearly." },
    reversed: { ru: "Слова рассеивают силу: сократите послание до правды, которую можно подтвердить действием.", en: "Words are scattering power: reduce the message to a truth you can support with action." },
  },
  {
    sectorId: "southeast",
    upright: { ru: "Гефест и Аглая благословляют ремесло: улучшите одну вещь точным и красивым движением.", en: "Hephaestus and Aglaea bless craft: improve one thing through a precise and beautiful action." },
    reversed: { ru: "Огонь мастерской расходуется впустую: очистите рабочее место и завершите малую починку.", en: "The workshop fire is being wasted: clear the work surface and finish one small repair." },
  },
  {
    sectorId: "south",
    upright: { ru: "Арес и Афродита соединяют волю и притяжение: направьте энергию в тело и заботливое действие.", en: "Ares and Aphrodite unite will and attraction: direct energy into the body and a caring act." },
    reversed: { ru: "Напор стал конфликтом или усталостью: верните меру через движение без борьбы и бережный уход.", en: "Drive has become conflict or fatigue: restore proportion through non-combative movement and gentle care." },
  },
  {
    sectorId: "southwest",
    upright: { ru: "Деметра напоминает о плодородии повторения: накормите тело или позаботьтесь о живом.", en: "Demeter recalls the fertility of repetition: nourish the body or tend something living." },
    reversed: { ru: "Почва истощена: сначала восстановите запас еды, воды или домашнего порядка.", en: "The soil is depleted: first restore food, water, or order in the home." },
  },
  {
    sectorId: "west",
    upright: { ru: "Посейдон и Амфитрита дают глубину: признайте чувство и позвольте ему пройти, не управляя вами.", en: "Poseidon and Amphitrite bring depth: acknowledge a feeling and let it pass without steering you." },
    reversed: { ru: "Внутреннее море неспокойно: верните текучесть водой, дыханием и короткой записью чувства.", en: "The inner sea is unsettled: restore flow with water, breath, and a brief written feeling." },
  },
  {
    sectorId: "northwest",
    upright: { ru: "Аполлон освещает меру: вынесите главное на свет и настройте день по ясному ритму.", en: "Apollo illuminates measure: bring what matters into the light and tune the day to a clear rhythm." },
    reversed: { ru: "Ясность превратилась в жёсткость: верните гармонию через свет, музыку или спокойное чтение.", en: "Clarity has hardened into rigidity: restore harmony through light, music, or quiet reading." },
  },
  {
    sectorId: "center",
    upright: { ru: "Дионис и Ариадна удерживают живую нить целого: отметьте жизнь творчеством и благодарностью.", en: "Dionysus and Ariadne hold the living thread of the whole: affirm life through creativity and gratitude." },
    reversed: { ru: "Нить центра потеряна: остановитесь, назовите своё состояние и сделайте одно свободное творческое действие.", en: "The thread to the center is lost: pause, name your state, and make one free creative gesture." },
  },
] as const;

export const SACRED_PRACTICES: readonly SacredPractice[] = [
  {
    id: "athena-three-intentions",
    sectorId: "north",
    emoji: "🦉",
    title: { ru: "Три намерения Афины", en: "Athena's three intentions" },
    description: { ru: "Записать три главных дела и первым выбрать самое важное.", en: "Write down three essential tasks and begin with the most important." },
    myth: { ru: "Афина рождается из мысли Зевса уже вооружённой: ясный замысел предшествует точному действию.", en: "Athena is born fully armed from Zeus's thought: clear intention precedes precise action." },
    suggestedTime: "08:00",
    priority: 8,
    color: "#497d9c",
  },
  {
    id: "athena-evening-counsel",
    sectorId: "north",
    emoji: "🏛️",
    title: { ru: "Вечерний совет Афины", en: "Athena's evening counsel" },
    description: { ru: "Вечером коротко записать одно удачное решение и один урок дня.", en: "At night, briefly record one sound decision and one lesson from the day." },
    myth: { ru: "Как покровительница полиса, Афина превращает опыт в рассудительность и общее благо.", en: "As guardian of the polis, Athena turns experience into judgment and common good." },
    suggestedTime: "21:00",
    priority: 6,
    color: "#5b89a5",
  },
  {
    id: "artemis-wild-walk",
    sectorId: "northeast",
    emoji: "🌿",
    title: { ru: "Тропа Артемиды", en: "Artemis's path" },
    description: { ru: "Гулять не менее 20 минут без телефона, замечая тело, воздух и живую природу.", en: "Walk for at least 20 phone-free minutes, noticing body, air, and living nature." },
    myth: { ru: "Артемида хранит дикую природу и свободу движения вне городского шума.", en: "Artemis protects wild nature and freedom of movement beyond the city's noise." },
    suggestedTime: "18:00",
    priority: 7,
    color: "#487f4b",
  },
  {
    id: "artemis-boundary",
    sectorId: "northeast",
    emoji: "🏹",
    title: { ru: "Граница Артемиды", en: "Artemis's boundary" },
    description: { ru: "Осознанно отказаться от одного лишнего требования или отвлечения.", en: "Consciously decline one unnecessary demand or distraction." },
    myth: { ru: "Независимая богиня сохраняет неприкосновенным своё пространство и выбранный путь.", en: "The independent goddess keeps her space and chosen path inviolate." },
    suggestedTime: "12:00",
    priority: 7,
    color: "#5d9360",
  },
  {
    id: "hermes-clear-message",
    sectorId: "east",
    emoji: "🪽",
    title: { ru: "Ясное послание Гермеса", en: "Hermes's clear message" },
    description: { ru: "Отправить одно давно откладываемое короткое и ясное сообщение.", en: "Send one brief, clear message you have been postponing." },
    myth: { ru: "Гермес свободно пересекает границы миров и доставляет слово точно адресату.", en: "Hermes crosses the boundaries of worlds and delivers the word to its true recipient." },
    suggestedTime: "10:00",
    priority: 6,
    color: "#b48825",
  },
  {
    id: "peitho-listening",
    sectorId: "east",
    emoji: "👂",
    title: { ru: "Слушание Пейто", en: "Peitho's listening" },
    description: { ru: "В одном разговоре сначала задать вопрос и дослушать ответ без перебивания.", en: "In one conversation, ask a question first and hear the answer without interrupting." },
    myth: { ru: "Пейто олицетворяет убеждение без принуждения: влияние начинается с внимания к другому.", en: "Peitho embodies persuasion without force: influence begins with attention to another." },
    suggestedTime: "14:00",
    priority: 6,
    color: "#c39a35",
  },
  {
    id: "hephaestus-small-repair",
    sectorId: "southeast",
    emoji: "🔨",
    title: { ru: "Малая починка Гефеста", en: "Hephaestus's small repair" },
    description: { ru: "Починить, улучшить или довести до порядка одну бытовую вещь.", en: "Repair, improve, or put one household object in working order." },
    myth: { ru: "Гефест превращает огонь и несовершенство материи в полезную форму.", en: "Hephaestus turns fire and imperfect matter into useful form." },
    suggestedTime: "19:00",
    priority: 7,
    color: "#bd6828",
  },
  {
    id: "aglaea-beautiful-workspace",
    sectorId: "southeast",
    emoji: "✨",
    title: { ru: "Мастерская Аглаи", en: "Aglaea's workshop" },
    description: { ru: "Десять минут приводить рабочую поверхность в чистый и красивый вид.", en: "Spend ten minutes making the work surface clean and beautiful." },
    myth: { ru: "Аглая соединяет сияние Харит с мастерством Гефеста: польза завершается красотой.", en: "Aglaea joins the radiance of the Charites to Hephaestus's craft: utility is completed by beauty." },
    suggestedTime: "17:30",
    priority: 5,
    color: "#cf7b3d",
  },
  {
    id: "ares-deliberate-movement",
    sectorId: "south",
    emoji: "🛡️",
    title: { ru: "Движение Ареса", en: "Ares's movement" },
    description: { ru: "Не менее 20 минут двигаться с усилием: тренировка, быстрая ходьба или растяжка.", en: "Move with effort for at least 20 minutes: training, brisk walking, or mobility work." },
    myth: { ru: "Сила Ареса становится добродетелью, когда получает меру, направление и дисциплину.", en: "Ares's force becomes a virtue when it receives measure, direction, and discipline." },
    suggestedTime: "18:30",
    priority: 8,
    color: "#a93f39",
  },
  {
    id: "aphrodite-care",
    sectorId: "south",
    emoji: "🌹",
    title: { ru: "Забота Афродиты", en: "Aphrodite's care" },
    description: { ru: "Совершить один внимательный жест ухода за телом, одеждой или близким человеком.", en: "Make one attentive gesture of care for your body, clothing, or someone close." },
    myth: { ru: "Афродита пробуждает притяжение через внимание к красоте, телесности и связи.", en: "Aphrodite awakens attraction through attention to beauty, embodiment, and connection." },
    suggestedTime: "20:00",
    priority: 6,
    color: "#bd5a55",
  },
  {
    id: "demeter-nourishing-meal",
    sectorId: "southwest",
    emoji: "🌾",
    title: { ru: "Трапеза Деметры", en: "Demeter's meal" },
    description: { ru: "Приготовить или выбрать одну полноценную трапезу и съесть её без спешки.", en: "Prepare or choose one nourishing meal and eat it without rushing." },
    myth: { ru: "Дар Деметры — возделанное зерно: ежедневная пища становится продолжением заботы о земле.", en: "Demeter's gift is cultivated grain: daily food continues the care given to the earth." },
    suggestedTime: "13:00",
    priority: 8,
    color: "#8b6533",
  },
  {
    id: "demeter-living-care",
    sectorId: "southwest",
    emoji: "🪴",
    title: { ru: "Живой сад Деметры", en: "Demeter's living garden" },
    description: { ru: "Полить растение, пополнить запас продуктов или убрать одну зону кухни.", en: "Water a plant, replenish food stores, or clean one part of the kitchen." },
    myth: { ru: "Цикл Деметры учит поддерживать жизнь малыми повторяющимися действиями.", en: "Demeter's cycle teaches that life is sustained by small repeated acts." },
    suggestedTime: "19:30",
    priority: 5,
    color: "#9c7843",
  },
  {
    id: "poseidon-water-pause",
    sectorId: "west",
    emoji: "🌊",
    title: { ru: "Водная пауза Посейдона", en: "Poseidon's water pause" },
    description: { ru: "Выпить стакан воды и сделать десять спокойных вдохов перед реакцией на напряжение.", en: "Drink a glass of water and take ten calm breaths before reacting to tension." },
    myth: { ru: "Посейдон поднимает и усмиряет море: пауза возвращает власть над внутренней волной.", en: "Poseidon raises and calms the sea: a pause restores command over the inner wave." },
    suggestedTime: "15:00",
    priority: 7,
    color: "#347a96",
  },
  {
    id: "amphitrite-emotion-log",
    sectorId: "west",
    emoji: "🐚",
    title: { ru: "Раковина Амфитриты", en: "Amphitrite's shell" },
    description: { ru: "Пять минут записывать главное чувство дня и потребность, стоящую за ним.", en: "Spend five minutes recording the day's main feeling and the need beneath it." },
    myth: { ru: "Амфитрита придаёт морской глубине царственный порядок и способность вместить бурю.", en: "Amphitrite gives sovereign order to the sea's depth and the capacity to contain a storm." },
    suggestedTime: "21:30",
    priority: 6,
    color: "#4c8da5",
  },
  {
    id: "apollo-morning-light",
    sectorId: "northwest",
    emoji: "☀️",
    title: { ru: "Свет Аполлона", en: "Apollo's light" },
    description: { ru: "Провести не менее десяти минут при дневном свете в первой половине дня.", en: "Spend at least ten minutes in daylight during the first half of the day." },
    myth: { ru: "Аполлон открывает меру и ясность светом, который делает формы различимыми.", en: "Apollo reveals measure and clarity through light that makes forms distinct." },
    suggestedTime: "09:00",
    priority: 8,
    color: "#aa841d",
  },
  {
    id: "apollo-harmonic-study",
    sectorId: "northwest",
    emoji: "🎵",
    title: { ru: "Гармония Аполлона", en: "Apollo's harmony" },
    description: { ru: "Пятнадцать минут читать, учиться или внимательно слушать музыку без многозадачности.", en: "Read, study, or listen closely to music for fifteen minutes without multitasking." },
    myth: { ru: "Лира Аполлона согласует разные струны в один строй — так внимание собирает разум.", en: "Apollo's lyre tunes different strings into one mode, as attention gathers the mind." },
    suggestedTime: "11:00",
    priority: 6,
    color: "#b89737",
  },
  {
    id: "ariadne-thread-journal",
    sectorId: "center",
    emoji: "🧵",
    title: { ru: "Нить Ариадны", en: "Ariadne's thread" },
    description: { ru: "Записать одной строкой, что сегодня возвращает вас к себе и своему пути.", en: "Write one line about what returns you to yourself and your path today." },
    myth: { ru: "Нить Ариадны выводит из лабиринта: короткая запись удерживает связь с центром.", en: "Ariadne's thread leads out of the labyrinth: a brief note preserves the link to the center." },
    suggestedTime: "21:00",
    priority: 7,
    color: "#9b393b",
  },
  {
    id: "dionysus-living-gesture",
    sectorId: "center",
    emoji: "🍇",
    title: { ru: "Живой жест Диониса", en: "Dionysus's living gesture" },
    description: { ru: "Десять минут свободно танцевать, петь, рисовать или благодарить за прожитый день.", en: "Spend ten minutes freely dancing, singing, drawing, or giving thanks for the lived day." },
    myth: { ru: "Дионис возвращает целостность через экстаз — выход из застывшей роли к живому переживанию.", en: "Dionysus restores wholeness through ecstasy: stepping beyond a fixed role into living experience." },
    suggestedTime: "20:30",
    priority: 6,
    color: "#ad4c50",
  },
  {
    id: "zeus-sovereign-rule",
    sectorId: "zenith",
    emoji: "⚡",
    title: { ru: "Закон Зевса", en: "Zeus's sovereign rule" },
    description: { ru: "Утром выбрать одно главное правило дня и вечером проверить, было ли оно соблюдено.", en: "Choose one governing rule for the day each morning and review it in the evening." },
    myth: { ru: "Зевс удерживает космический порядок не множеством приказов, а силой ясного и обязательного закона.", en: "Zeus sustains cosmic order not through countless commands, but through one clear and binding law." },
    suggestedTime: "08:30",
    priority: 9,
    color: "#8b75bd",
  },
  {
    id: "hera-kept-covenant",
    sectorId: "zenith",
    emoji: "👑",
    title: { ru: "Союз Геры", en: "Hera's covenant" },
    description: { ru: "Выполнить одно данное обещание или бережно восстановить один нарушенный договор.", en: "Keep one promise you have made or carefully repair one neglected agreement." },
    myth: { ru: "Гера охраняет достоинство союза: порядок становится живым, когда слово поддержано поступком.", en: "Hera guards the dignity of covenant: order becomes living when a promise is upheld by action." },
    suggestedTime: "18:00",
    priority: 8,
    color: "#7566a6",
  },
  {
    id: "persephone-new-seed",
    sectorId: "nadir",
    emoji: "🌱",
    title: { ru: "Возвращение Персефоны", en: "Persephone’s Return" },
    previousTitles: [
      "Семя Персефоны", "Persephone's seed", "Σπόρος του Περσεφόνη", "Persephone-Seed",
      "graine de Persephone", "semilla de Persephone", "seme di Persephone", "semente do Persephone",
      "Materiał siewny Persephone", "Персефона", "насіння Персефона", "Persephone的种子",
      "Persephone'nin tohumu", "Persephone のシード",
    ],
    description: { ru: "Освободить место от одной отжившей вещи, записи или обязательства и назвать, чему теперь можно прорасти.", en: "Release one outgrown object, note, or obligation and name what may grow in its place." },
    myth: { ru: "Персефона возвращается из глубины с новым циклом жизни: завершение становится почвой для роста.", en: "Persephone returns from the depths with a new cycle of life: an ending becomes soil for growth." },
    suggestedTime: "19:00",
    priority: 7,
    color: "#66547f",
  },
  {
    id: "hades-hidden-treasure",
    sectorId: "nadir",
    emoji: "🗝️",
    title: { ru: "Сокровище Аида", en: "Hades's hidden treasure" },
    description: { ru: "Десять минут спокойно разбирать финансы, запасы или скрытую незавершённую задачу.", en: "Spend ten quiet minutes reviewing finances, reserves, or a hidden unfinished task." },
    myth: { ru: "Имя Плутон напоминает: глубина хранит богатство, которое открывается внимательному и бесстрашному взгляду.", en: "The name Plouton recalls that the depths hold wealth revealed by an attentive and fearless gaze." },
    suggestedTime: "20:00",
    priority: 8,
    color: "#54456d",
  },
  {
    id: "hestia-tended-hearth",
    sectorId: "hearth",
    emoji: "🔥",
    title: { ru: "Огонь Гестии", en: "Hestia's tended flame" },
    description: { ru: "Привести в порядок одну центральную точку дома: стол, кровать, кухонную поверхность или место отдыха.", en: "Restore one central place at home: a table, bed, kitchen surface, or resting corner." },
    myth: { ru: "Неподвижный огонь Гестии делает дом священным через малое, постоянное поддержание очага.", en: "Hestia's unmoving flame makes the home sacred through small, steady acts of tending." },
    suggestedTime: "19:30",
    priority: 8,
    color: "#bf633f",
  },
  {
    id: "hestia-five-quiet-minutes",
    sectorId: "hearth",
    emoji: "🕯️",
    title: { ru: "Тишина очага", en: "Stillness of the hearth" },
    description: { ru: "Провести пять минут без экрана и разговоров, спокойно дыша и возвращая внимание в дом и тело.", en: "Spend five screen-free, silent minutes breathing calmly and returning attention to home and body." },
    myth: { ru: "Гестия остаётся в центре, пока боги странствуют: её тишина удерживает целостность пространства.", en: "Hestia remains at the center while the gods wander; her stillness preserves the wholeness of the space." },
    suggestedTime: "21:30",
    priority: 6,
    color: "#a95339",
  },
  {
    id: "aether-clear-threshold",
    sectorId: "entrance",
    emoji: "🌬️",
    title: { ru: "Порог Эфира", en: "Aether's clear threshold" },
    description: { ru: "Перед первой важной работой проветрить пространство, расправить плечи и сделать три осознанных вдоха.", en: "Before the first important task, air the room, open your posture, and take three deliberate breaths." },
    myth: { ru: "Эфир — чистый верхний воздух: ясный вход отделяет намеренную работу от повседневного шума.", en: "Aether is the pure upper air: a clear entrance separates intentional work from everyday noise." },
    suggestedTime: "08:00",
    priority: 7,
    color: "#6f9db5",
  },
  {
    id: "hemera-first-light",
    sectorId: "entrance",
    emoji: "🌅",
    title: { ru: "Первый свет Гемеры", en: "Hemera's first light" },
    description: { ru: "Первые десять минут дня провести при естественном свете, не открывая уведомления.", en: "Spend the first ten minutes of the day in natural light without opening notifications." },
    myth: { ru: "Гемера выводит ясный день из ночи: свет получает первенство прежде, чем чужие голоса займут внимание.", en: "Hemera brings bright day out of night: light receives priority before other voices claim attention." },
    suggestedTime: "07:30",
    priority: 8,
    color: "#8aacc0",
  },
  {
    id: "psyche-evening-seal",
    sectorId: "exit",
    emoji: "🦋",
    title: { ru: "Печать Психеи", en: "Psyche's evening seal" },
    description: { ru: "В конце дня записать одной строкой главный полученный опыт и закрыть незавершённые вкладки.", en: "At day's end, record the main lesson in one line and close unfinished browser tabs." },
    myth: { ru: "Психея проходит испытания и сохраняет их смысл в душе: завершённый опыт становится внутренней опорой.", en: "Psyche passes through trials and preserves their meaning in the soul: completed experience becomes inner support." },
    suggestedTime: "22:00",
    priority: 7,
    color: "#9c668d",
  },
  {
    id: "eros-grateful-return",
    sectorId: "exit",
    emoji: "💞",
    title: { ru: "Благодарность Эроса", en: "Eros's grateful return" },
    description: { ru: "Выразить одному человеку искреннюю благодарность или отметить связь, которая поддержала вас сегодня.", en: "Offer sincere thanks to one person or acknowledge a bond that supported you today." },
    myth: { ru: "Эрос возвращает Психею к жизни через связь: день завершается не разрывом, а признанием любви и поддержки.", en: "Eros restores Psyche through connection: the day ends not in severance, but in recognition of love and support." },
    suggestedTime: "20:30",
    priority: 6,
    color: "#ad6b83",
  },
] as const;

const sacredPracticeIds = new Set(SACRED_PRACTICES.map((practice) => practice.id));
const sacredSectorIds = new Set<string>(SACRED_PRACTICE_SECTOR_IDS);

export function isSacredPracticeId(value: unknown): value is string {
  return typeof value === "string" && sacredPracticeIds.has(value);
}

export function isSacredPracticeSectorId(value: unknown): value is SacredPracticeSectorId {
  return typeof value === "string" && sacredSectorIds.has(value);
}

export function sacredPracticesForSector(sectorId: SacredPracticeSectorId) {
  return SACRED_PRACTICES.filter((practice) => practice.sectorId === sectorId);
}

export function sacredSectorGuidance(sectorId: StoicheionPracticeSectorId) {
  return SACRED_SECTOR_GUIDANCE.find((guidance) => guidance.sectorId === sectorId)!;
}
