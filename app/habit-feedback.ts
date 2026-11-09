export const HABIT_SOUND_SCHEMES = ["calm", "epic", "futuristic"] as const;
export type HabitSoundScheme = typeof HABIT_SOUND_SCHEMES[number];
export const HABIT_FEEDBACK_KINDS = ["completion", "daily-goal", "perfect-day", "achievement", "quest", "rank-up"] as const;

export type HabitFeedbackSettings = {
  soundScheme: HabitSoundScheme;
  animations: boolean;
  sound: boolean;
  haptics: boolean;
  achievementPopups: boolean;
  questsEnabled: boolean;
  gamificationWidgets: boolean;
};

export type HabitFeedbackKind = typeof HABIT_FEEDBACK_KINDS[number];

export type HabitFeedbackEvent = {
  id: string;
  habitId: string;
  habitTitle: string;
  habitEmoji: string;
  kind: HabitFeedbackKind;
  xp: number;
  laurels: number;
  rankTitle: string;
  rankTitleEn: string;
  achievementTitle: string;
  achievementTitleEn: string;
};

export const DEFAULT_HABIT_FEEDBACK_SETTINGS: HabitFeedbackSettings = {
  soundScheme: "calm",
  animations: true,
  sound: false,
  haptics: false,
  achievementPopups: true,
  questsEnabled: true,
  gamificationWidgets: true,
};

export function normalizeHabitFeedbackSettings(value: Partial<HabitFeedbackSettings> | null | undefined): HabitFeedbackSettings {
  return {
    soundScheme: HABIT_SOUND_SCHEMES.includes(value?.soundScheme as HabitSoundScheme) ? value!.soundScheme! : "calm",
    animations: typeof value?.animations === "boolean" ? value.animations : DEFAULT_HABIT_FEEDBACK_SETTINGS.animations,
    sound: typeof value?.sound === "boolean" ? value.sound : DEFAULT_HABIT_FEEDBACK_SETTINGS.sound,
    haptics: typeof value?.haptics === "boolean" ? value.haptics : DEFAULT_HABIT_FEEDBACK_SETTINGS.haptics,
    achievementPopups: typeof value?.achievementPopups === "boolean" ? value.achievementPopups : DEFAULT_HABIT_FEEDBACK_SETTINGS.achievementPopups,
    questsEnabled: typeof value?.questsEnabled === "boolean" ? value.questsEnabled : DEFAULT_HABIT_FEEDBACK_SETTINGS.questsEnabled,
    gamificationWidgets: typeof value?.gamificationWidgets === "boolean" ? value.gamificationWidgets : DEFAULT_HABIT_FEEDBACK_SETTINGS.gamificationWidgets,
  };
}

function hapticPattern(kind: HabitFeedbackKind) {
  if (kind === "rank-up") return [28, 38, 42, 38, 64];
  if (kind === "perfect-day") return [24, 34, 48];
  if (kind === "daily-goal") return [24, 28, 32];
  return 22;
}

let activeCue: HTMLAudioElement | null = null;

export function playFeedbackSound(kind: HabitFeedbackKind, scheme: HabitSoundScheme = "calm") {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return;
  try {
    activeCue?.pause();
    const safeScheme = HABIT_SOUND_SCHEMES.includes(scheme) ? scheme : "calm";
    const safeKind = HABIT_FEEDBACK_KINDS.includes(kind) ? kind : "completion";
    const cue = new window.Audio(`/feedback-audio/${safeScheme}-${safeKind}.wav`);
    cue.volume = .8;
    activeCue = cue;
    const release = () => { if (activeCue === cue) activeCue = null; };
    cue.onended = release;
    cue.onerror = release;
    void cue.play().catch(release);
  } catch {
    // A successful offline completion remains successful when audio is unavailable.
  }
}

export function deliverHabitFeedback(kind: HabitFeedbackKind, settings: HabitFeedbackSettings) {
  if (typeof window === "undefined") return;
  try {
    if (settings.haptics && typeof navigator.vibrate === "function") navigator.vibrate(hapticPattern(kind));
  } catch { /* Device vibration restrictions must not suppress sound or a saved completion. */ }
  if (settings.sound) playFeedbackSound(kind, settings.soundScheme);
}
