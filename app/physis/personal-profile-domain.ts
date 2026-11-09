import { DEFAULT_FOOD_RULES, type NutritionProfile } from './nutrition-domain.ts';
import { physisNumber } from './types.ts';

export const ACTIVITY_LEVELS = {
  low: { ru: 'Низкий', en: 'Low', factor: 1.2 },
  moderate: { ru: 'Умеренный', en: 'Moderate', factor: 1.55 },
  high: { ru: 'Высокий', en: 'High', factor: 1.725 },
} as const;
export const FITNESS_GOALS = {
  lose: ['Похудение', 'Weight loss'],
  maintain: ['Поддержание', 'Maintenance'],
  gain: ['Набор мышечной массы', 'Muscle gain'],
  recomposition: ['Рекомпозиция', 'Body recomposition'],
  endurance: ['Развитие выносливости', 'Endurance'],
  flexibility: ['Развитие гибкости', 'Flexibility'],
} as const;
export function defaultNutritionProfile(): NutritionProfile {
  const target = { energy: 0, protein: 0, fat: 0, carbohydrate: 0, fiber: null };
  return { mode: 'macros', macroUnit: 'g', goal: 'custom', method: 'manual', age: null, heightCm: null, weightKg: null, formulaSex: 'female', activityFactor: 1.2, excluded: false, formulaVersion: 'manual v1', formulaSource: 'Пользователь', activitySource: 'Пользовательский коэффициент; включает обычную активность', training: { ...target }, rest: { ...target }, selectedNutrients: ['sodium', 'magnesium'], foodRules: structuredClone(DEFAULT_FOOD_RULES) };
}
export type PersonalProfileDraft = {
  sex: '' | 'male' | 'female'; age: string; heightCm: string; weightKg: string;
  activityLevel: keyof typeof ACTIVITY_LEVELS; fitnessGoal: keyof typeof FITNESS_GOALS;
};
export function personalProfileDraft(profile?: NutritionProfile): PersonalProfileDraft {
  return {
    sex: profile ? profile.formulaSex : '', age: String(profile?.age ?? ''),
    heightCm: String(profile?.heightCm ?? ''), weightKg: String(profile?.weightKg ?? ''),
    activityLevel: profile && profile.activityFactor >= 1.7 ? 'high' : profile && profile.activityFactor >= 1.4 ? 'moderate' : 'low',
    fitnessGoal: profile?.goal === 'lose' || profile?.goal === 'gain' ? profile.goal : profile?.personal && !['lose', 'gain'].includes(profile.personal.fitnessGoal) ? profile.personal.fitnessGoal : 'maintain',
  };
}
/** Update the shared profile without replacing any existing nutrient targets or food rules. */
export function applyPersonalProfile(profile: NutritionProfile, draft: PersonalProfileDraft): NutritionProfile {
  const age = physisNumber(draft.age, 1, 120);
  const heightCm = physisNumber(draft.heightCm, 50, 250);
  const weightKg = physisNumber(draft.weightKg, 10, 400);
  if (!['male', 'female'].includes(draft.sex) || age === null || !Number.isInteger(age) || heightCm === null || weightKg === null || !Object.hasOwn(ACTIVITY_LEVELS, draft.activityLevel) || !Object.hasOwn(FITNESS_GOALS, draft.fitnessGoal)) {
    throw new Error('Проверьте пол, возраст, рост и вес. / Check sex, age, height and weight.');
  }
  return { ...profile, age, heightCm, weightKg, formulaSex: draft.sex as 'male' | 'female', method: age < 18 || profile.excluded ? 'manual' : profile.method,
    activityFactor: ACTIVITY_LEVELS[draft.activityLevel].factor,
    activitySource: 'Уровень активности из личных данных / Personal activity level',
    goal: draft.fitnessGoal === 'lose' || draft.fitnessGoal === 'gain' ? draft.fitnessGoal : 'maintain',
    personal: { activityLevel: draft.activityLevel, fitnessGoal: draft.fitnessGoal },
  };
}
