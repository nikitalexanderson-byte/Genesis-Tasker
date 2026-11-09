export type HeroicRankId =
  | "tantalus"
  | "sisyphus"
  | "cyclops"
  | "icarus"
  | "lion-heart"
  | "venom-vanquisher"
  | "golden-horn-pathfinder"
  | "mountain-tamer"
  | "lord-of-the-current"
  | "bronze-wing"
  | "tamer-of-might"
  | "iron-charioteer"
  | "royal-honor-bearer"
  | "western-verge-guardian"
  | "golden-garden-keeper"
  | "risen-from-the-abyss"
  | "mirror-victor"
  | "lord-of-the-thread"
  | "golden-argonaut"
  | "celestial-rider"
  | "voice-beyond-styx"
  | "arcadian-arrow"
  | "myrmidon-shield"
  | "many-counseled-wanderer"
  | "spear-of-athena"
  | "dragon-seed-sower"
  | "sphinx-solver"
  | "calydonian-glory-bearer";

export type HeroicRankPath = "overture" | "heroic" | "hidden";

export type HeroicRank = {
  id: HeroicRankId;
  title: string;
  titleEn: string;
  threshold: number;
  color: string;
  path: HeroicRankPath;
};

export type HeroPathCheckpoint = {
  rankId: HeroicRankId;
  rewardLaurels: number;
  title: string;
  titleEn: string;
};

export type UserProgress = {
  lifetimeXp: number;
  grossLifetimeXp?: number;
  forfeitedHabitXp?: number;
  laurelsBalance: number;
  currentRankId: HeroicRankId | null;
  hiddenHeroicPathRevealedAt: string | null;
  currentStreak: number;
  longestStreak: number;
  lastQualifiedDate: string | null;
  streakGoalMode: "easy" | "rhythm" | "perfect";
  streakFreezeCount: number;
  rhythmScore: number;
  updatedAt: string;
};

export const HEROIC_RANKS: readonly HeroicRank[] = [
  { id: "tantalus", title: "Тантал", titleEn: "Tantalus", threshold: 10, color: "#86614f", path: "overture" },
  { id: "sisyphus", title: "Сизиф", titleEn: "Sisyphus", threshold: 40, color: "#73726c", path: "overture" },
  { id: "cyclops", title: "Циклоп", titleEn: "Cyclops", threshold: 90, color: "#9a6541", path: "overture" },
  { id: "icarus", title: "Икар", titleEn: "Icarus", threshold: 160, color: "#b88c42", path: "overture" },
  { id: "lion-heart", title: "Львиное Сердце", titleEn: "Lionheart", threshold: 250, color: "#aa6f3f", path: "heroic" },
  { id: "venom-vanquisher", title: "Победитель Яда", titleEn: "Vanquisher of Venom", threshold: 450, color: "#71855c", path: "heroic" },
  { id: "golden-horn-pathfinder", title: "Златорогий Следопыт", titleEn: "Golden-Horned Pathfinder", threshold: 750, color: "#b88a43", path: "heroic" },
  { id: "mountain-tamer", title: "Горный Укротитель", titleEn: "Mountain Tamer", threshold: 1_100, color: "#777b78", path: "heroic" },
  { id: "lord-of-the-current", title: "Владыка Потока", titleEn: "Lord of the Current", threshold: 1_550, color: "#397a79", path: "heroic" },
  { id: "bronze-wing", title: "Бронзовое Крыло", titleEn: "Bronze Wing", threshold: 2_100, color: "#a96f4f", path: "heroic" },
  { id: "tamer-of-might", title: "Укротитель Мощи", titleEn: "Tamer of Might", threshold: 2_800, color: "#986946", path: "heroic" },
  { id: "iron-charioteer", title: "Железный Возничий", titleEn: "Iron Charioteer", threshold: 3_700, color: "#737b7c", path: "heroic" },
  { id: "royal-honor-bearer", title: "Носитель Царской Чести", titleEn: "Bearer of Royal Honor", threshold: 4_800, color: "#b38a4f", path: "heroic" },
  { id: "western-verge-guardian", title: "Страж Западного Предела", titleEn: "Guardian of the Western Verge", threshold: 6_200, color: "#5d718c", path: "heroic" },
  { id: "golden-garden-keeper", title: "Хранитель Золотого Сада", titleEn: "Keeper of the Golden Garden", threshold: 8_000, color: "#a9873e", path: "heroic" },
  { id: "risen-from-the-abyss", title: "Восставший из Бездны", titleEn: "Risen from the Abyss", threshold: 10_500, color: "#d0ad5a", path: "heroic" },
  { id: "mirror-victor", title: "Зеркальный Победитель", titleEn: "Mirror Victor", threshold: 14_000, color: "#92b4bd", path: "hidden" },
  { id: "lord-of-the-thread", title: "Владыка Нити", titleEn: "Lord of the Thread", threshold: 18_500, color: "#a86468", path: "hidden" },
  { id: "golden-argonaut", title: "Золотой Аргонавт", titleEn: "Golden Argonaut", threshold: 24_000, color: "#d1a64c", path: "hidden" },
  { id: "celestial-rider", title: "Небесный Всадник", titleEn: "Celestial Rider", threshold: 31_000, color: "#678db5", path: "hidden" },
  { id: "voice-beyond-styx", title: "Голос за Стиксом", titleEn: "Voice Beyond the Styx", threshold: 40_000, color: "#685f91", path: "hidden" },
  { id: "arcadian-arrow", title: "Аркадийская Стрела", titleEn: "Arcadian Arrow", threshold: 52_000, color: "#66875d", path: "hidden" },
  { id: "myrmidon-shield", title: "Щит Мирмидонян", titleEn: "Shield of the Myrmidons", threshold: 67_000, color: "#8e7051", path: "hidden" },
  { id: "many-counseled-wanderer", title: "Многоумный Странник", titleEn: "Many-Counseled Wanderer", threshold: 86_000, color: "#477d82", path: "hidden" },
  { id: "spear-of-athena", title: "Копьё Афины", titleEn: "Spear of Athena", threshold: 110_000, color: "#718ca6", path: "hidden" },
  { id: "dragon-seed-sower", title: "Сеятель Драконьего Семени", titleEn: "Sower of the Dragon Seed", threshold: 141_000, color: "#89694c", path: "hidden" },
  { id: "sphinx-solver", title: "Разгадчик Сфинкса", titleEn: "Solver of the Sphinx", threshold: 180_000, color: "#96733f", path: "hidden" },
  { id: "calydonian-glory-bearer", title: "Носитель Калидонской Славы", titleEn: "Bearer of Calydonian Glory", threshold: 230_000, color: "#d1b15b", path: "hidden" },
] as const;

export const INTRODUCTORY_HEROIC_RANKS = HEROIC_RANKS.filter((rank) => rank.path === "overture");
export const FOUNDATIONAL_HEROIC_RANKS = HEROIC_RANKS.filter((rank) => rank.path !== "hidden");
export const HIDDEN_HEROIC_RANKS = HEROIC_RANKS.filter((rank) => rank.path === "hidden");
export const HIDDEN_HEROIC_PATH_UNLOCK_XP = HEROIC_RANKS.find((rank) => rank.id === "risen-from-the-abyss")!.threshold;

export const HERO_PATH_CHECKPOINTS: readonly HeroPathCheckpoint[] = [
  { rankId: "icarus", rewardLaurels: 15, title: "Амфора стремления", titleEn: "Amphora of aspiration" },
  { rankId: "mountain-tamer", rewardLaurels: 25, title: "Амфора стойкости", titleEn: "Amphora of resolve" },
  { rankId: "iron-charioteer", rewardLaurels: 40, title: "Амфора мастерства", titleEn: "Amphora of mastery" },
  { rankId: "risen-from-the-abyss", rewardLaurels: 60, title: "Амфора бездны", titleEn: "Amphora of the abyss" },
  { rankId: "golden-argonaut", rewardLaurels: 90, title: "Амфора странствия", titleEn: "Amphora of passage" },
  { rankId: "arcadian-arrow", rewardLaurels: 130, title: "Амфора точности", titleEn: "Amphora of precision" },
  { rankId: "spear-of-athena", rewardLaurels: 180, title: "Амфора мудрости", titleEn: "Amphora of wisdom" },
  { rankId: "calydonian-glory-bearer", rewardLaurels: 260, title: "Амфора славы", titleEn: "Amphora of glory" },
] as const;

export const UNRANKED_HEROIC_STATE = {
  id: "unranked",
  title: "Путь ещё не начат",
  titleEn: "The path has not begun",
  threshold: 0,
  color: "#70736d",
  path: "overture",
} as const;

export const MAX_HABIT_XP_PER_COMPLETION = 20;

function safeXp(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function hiddenHeroicPathUnlocked(lifetimeXp: number) {
  return safeXp(lifetimeXp) >= HIDDEN_HEROIC_PATH_UNLOCK_XP;
}

export function hiddenHeroicPathRevealed(progress: Pick<UserProgress, "lifetimeXp" | "hiddenHeroicPathRevealedAt">) {
  return hiddenHeroicPathUnlocked(progress.lifetimeXp)
    && typeof progress.hiddenHeroicPathRevealedAt === "string"
    && !Number.isNaN(Date.parse(progress.hiddenHeroicPathRevealedAt));
}

export function visibleHeroicRanksForXp(lifetimeXp: number, hiddenPathRevealed = false) {
  return hiddenHeroicPathUnlocked(lifetimeXp) && hiddenPathRevealed ? HEROIC_RANKS : FOUNDATIONAL_HEROIC_RANKS;
}

export function highestRankForXp(lifetimeXp: number) {
  const xp = safeXp(lifetimeXp);
  return [...HEROIC_RANKS].reverse().find((rank) => xp >= rank.threshold) ?? null;
}

export function heroicRank(lifetimeXp: number) {
  return highestRankForXp(lifetimeXp) ?? UNRANKED_HEROIC_STATE;
}

export function heroicRankForProgress(progress: Pick<UserProgress, "lifetimeXp" | "hiddenHeroicPathRevealedAt">) {
  const visibleRanks = visibleHeroicRanksForXp(progress.lifetimeXp, hiddenHeroicPathRevealed(progress));
  const rank = [...visibleRanks].reverse().find((item) => safeXp(progress.lifetimeXp) >= item.threshold);
  return rank ?? UNRANKED_HEROIC_STATE;
}

export function nextHeroicRank(lifetimeXp: number) {
  const xp = safeXp(lifetimeXp);
  return HEROIC_RANKS.find((rank) => xp < rank.threshold) ?? null;
}

export function nextHeroicRankForProgress(progress: Pick<UserProgress, "lifetimeXp" | "hiddenHeroicPathRevealedAt">) {
  const visibleRanks = visibleHeroicRanksForXp(progress.lifetimeXp, hiddenHeroicPathRevealed(progress));
  return visibleRanks.find((rank) => safeXp(progress.lifetimeXp) < rank.threshold) ?? null;
}

export function completionXpAward(previousAward: unknown, completionScore: unknown, maximum = MAX_HABIT_XP_PER_COMPLETION) {
  return Math.min(Math.max(0, safeXp(maximum)), Math.max(safeXp(previousAward), safeXp(completionScore)));
}

export function reconcileUserProgress(
  value: Partial<UserProgress> | null | undefined,
  sources: ReadonlyArray<{ xpAwarded?: number; habitId?: string; date?: string }>,
  timestamp = new Date().toISOString(),
  streak?: { currentStreak: number; longestStreak: number; lastQualifiedDate: string | null },
  laurelsBalance = Math.round(Number(value?.laurelsBalance) || 0),
  streakFreezeCountValue = safeXp(value?.streakFreezeCount),
  rhythmScoreValue = safeXp(value?.rhythmScore),
): UserProgress {
  const dayCredits = new Map<string, number>();
  let independentCredits = 0;
  for (const source of sources) {
    if (source.habitId && source.date) {
      const key = `${source.habitId}:${source.date}`;
      dayCredits.set(key, Math.max(dayCredits.get(key) ?? 0, safeXp(source.xpAwarded)));
    } else independentCredits += safeXp(source.xpAwarded);
  }
  const awardedXp = independentCredits + [...dayCredits.values()].reduce((total, value) => total + value, 0);
  const forfeitedHabitXp = safeXp(value?.forfeitedHabitXp);
  const grossLifetimeXp = Math.max(safeXp(value?.grossLifetimeXp ?? value?.lifetimeXp), awardedXp);
  const lifetimeXp = Math.max(0, grossLifetimeXp - forfeitedHabitXp);
  const currentRankId = highestRankForXp(lifetimeXp)?.id ?? null;
  const hiddenHeroicPathRevealedAt = typeof value?.hiddenHeroicPathRevealedAt === "string" && !Number.isNaN(Date.parse(value.hiddenHeroicPathRevealedAt))
    ? value.hiddenHeroicPathRevealedAt
    : null;
  const currentStreak = streak?.currentStreak ?? safeXp(value?.currentStreak);
  const longestStreak = Math.max(streak?.longestStreak ?? safeXp(value?.longestStreak), currentStreak);
  const lastQualifiedDate = streak?.lastQualifiedDate ?? (typeof value?.lastQualifiedDate === "string" ? value.lastQualifiedDate : null);
  const streakGoalMode = ["easy", "rhythm", "perfect"].includes(value?.streakGoalMode ?? "") ? value!.streakGoalMode! : "rhythm";
  const streakFreezeCount = Math.min(2, safeXp(streakFreezeCountValue));
  const rhythmScore = Math.min(100, safeXp(rhythmScoreValue));
  const changed = lifetimeXp !== safeXp(value?.lifetimeXp)
    || laurelsBalance !== Math.round(Number(value?.laurelsBalance) || 0)
    || currentRankId !== (value?.currentRankId ?? null)
    || hiddenHeroicPathRevealedAt !== (value?.hiddenHeroicPathRevealedAt ?? null)
    || currentStreak !== safeXp(value?.currentStreak)
    || longestStreak !== safeXp(value?.longestStreak)
    || lastQualifiedDate !== (value?.lastQualifiedDate ?? null)
    || (value?.streakGoalMode !== undefined && streakGoalMode !== value.streakGoalMode)
    || streakFreezeCount !== safeXp(value?.streakFreezeCount)
    || rhythmScore !== safeXp(value?.rhythmScore);
  return {
    lifetimeXp,
    ...(forfeitedHabitXp > 0 || value?.grossLifetimeXp !== undefined ? { grossLifetimeXp, forfeitedHabitXp } : {}),
    laurelsBalance,
    currentRankId,
    hiddenHeroicPathRevealedAt,
    currentStreak,
    longestStreak,
    lastQualifiedDate,
    streakGoalMode,
    streakFreezeCount,
    rhythmScore,
    updatedAt: !changed && typeof value?.updatedAt === "string" && value.updatedAt ? value.updatedAt : timestamp,
  };
}
