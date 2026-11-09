import { formatTimeValue, type TimeFormat } from "./time-format.ts";

export type DayRhythmPeriodId = "air" | "fire" | "water" | "earth";

export type DayRhythmWatch = {
  id: string;
  startHour: number;
  endHour: number;
  deity: string;
  title: string;
  description: string;
  symbol: string;
};

export type DayRhythmPeriod = {
  id: DayRhythmPeriodId;
  name: string;
  element: string;
  startHour: number;
  endHour: number;
  symbol: string;
  alchemySymbol: string;
  source: string;
  description: string;
  watches: readonly DayRhythmWatch[];
};

export const DAY_RHYTHM_PERIODS: readonly DayRhythmPeriod[] = [
  {
    id: "air",
    name: "Утро",
    element: "Воздуха",
    startHour: 6,
    endHour: 12,
    symbol: "🌬",
    alchemySymbol: "🜁",
    source: "Время «Пневмы» Гомера",
    description: "Пробуждение мысли и настройка связей.",
    watches: [
      {
        id: "ares",
        startHour: 6,
        endHour: 8,
        deity: "Арес",
        title: "Первый бросок",
        description: "Энергия волевого импульса. Время встать и заявить права на свой день.",
        symbol: "♂",
      },
      {
        id: "aphrodite",
        startHour: 8,
        endHour: 10,
        deity: "Афродита",
        title: "Красота воплощения",
        description: "Забота о теле, эстетика быта и первый вкус жизни.",
        symbol: "♀",
      },
      {
        id: "hermes",
        startHour: 10,
        endHour: 12,
        deity: "Гермес",
        title: "Летящее слово",
        description: "Час вестника: коммуникации, почта, обмен информацией.",
        symbol: "☿",
      },
    ],
  },
  {
    id: "fire",
    name: "День",
    element: "Огня",
    startHour: 12,
    endHour: 18,
    symbol: "🔥",
    alchemySymbol: "🜂",
    source: "Время «Логоса» Гераклита",
    description: "Максимальная трансформация материи в результат.",
    watches: [
      {
        id: "artemis",
        startHour: 12,
        endHour: 14,
        deity: "Артемида",
        title: "Зенит защиты",
        description: "Удержание фокуса и границ эффективности в пик дневного зноя.",
        symbol: "☾",
      },
      {
        id: "apollo",
        startHour: 14,
        endHour: 16,
        deity: "Аполлон",
        title: "Лик ясности",
        description: "Время солнца и чистого разума. Час для принятия ключевых решений.",
        symbol: "☀",
      },
      {
        id: "demeter",
        startHour: 16,
        endHour: 18,
        deity: "Деметра",
        title: "Жатва момента",
        description: "Упорядочивание и шлифовка того, что было сделано за день.",
        symbol: "⚘",
      },
    ],
  },
  {
    id: "water",
    name: "Вечер",
    element: "Воды",
    startHour: 18,
    endHour: 24,
    symbol: "💧",
    alchemySymbol: "🜄",
    source: "Время «Катарсиса» Аристотеля",
    description: "Очищение чувств и спуск во внутренний мир.",
    watches: [
      {
        id: "hephaestus",
        startHour: 18,
        endHour: 20,
        deity: "Гефест",
        title: "Закалка баланса",
        description: "Вечерняя кузня: переплавка дневного опыта в мудрость покоя.",
        symbol: "⚒",
      },
      {
        id: "athena",
        startHour: 20,
        endHour: 22,
        deity: "Афина",
        title: "Зоркость совы",
        description: "Глубокий анализ смыслов, скрытых за дневной суетой.",
        symbol: "⚴",
      },
      {
        id: "zeus",
        startHour: 22,
        endHour: 24,
        deity: "Зевс",
        title: "Закон и Итог",
        description: "Час высшего суда над собой и утверждение планов на завтра.",
        symbol: "♃",
      },
    ],
  },
  {
    id: "earth",
    name: "Ночь",
    element: "Земли",
    startHour: 0,
    endHour: 6,
    symbol: "⛰",
    alchemySymbol: "🜃",
    source: "Время «Корней» Гесиода",
    description: "Глубина подсознания и восстановление основ.",
    watches: [
      {
        id: "hestia",
        startHour: 0,
        endHour: 2,
        deity: "Гестия",
        title: "Центр Очага",
        description: "Точка абсолютной стабильности и охраны внутреннего огня души.",
        symbol: "🕯",
      },
      {
        id: "hera",
        startHour: 2,
        endHour: 4,
        deity: "Гера",
        title: "Небесный Порядок",
        description: "Время глубокой структуры сна и восстановления иерархии психики.",
        symbol: "♛",
      },
      {
        id: "poseidon",
        startHour: 4,
        endHour: 6,
        deity: "Посейдон",
        title: "Океан Предбытия",
        description: "Растворение старых форм перед новым рождением на рассвете.",
        symbol: "Ψ",
      },
    ],
  },
];

export function formatDayRhythmRange(startHour: number, endHour: number, timeFormat: TimeFormat) {
  const formatBoundary = (hour: number) => formatTimeValue(`${String(hour % 24).padStart(2, "0")}:00`, timeFormat);
  return `${formatBoundary(startHour)}–${formatBoundary(endHour)}`;
}

export function getDayRhythmMoment(date: Date) {
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const minutes = seconds / 60;
  const period = DAY_RHYTHM_PERIODS.find(({ startHour, endHour }) => minutes >= startHour * 60 && minutes < endHour * 60)
    ?? DAY_RHYTHM_PERIODS[3];
  const watch = period.watches.find(({ startHour, endHour }) => minutes >= startHour * 60 && minutes < endHour * 60)
    ?? period.watches[0];
  const durationMinutes = (watch.endHour - watch.startHour) * 60;
  const elapsedMinutes = minutes - watch.startHour * 60;

  return {
    period,
    watch,
    progress: Math.max(0, Math.min(100, (elapsedMinutes / durationMinutes) * 100)),
    remainingMinutes: Math.max(0, Math.ceil(watch.endHour * 60 - minutes)),
    remainingSeconds: Math.max(0, Math.ceil(watch.endHour * 3600 - seconds)),
  };
}
