import type { PhysisRecord, PhysisStore } from './types.ts';
import { isCivilDate } from '../calendar-context.ts';

export const NUTRIENTS = {
  energy: { ru: 'Энергия', en: 'Energy', unit: 'kcal', usda: 1008 },
  protein: { ru: 'Белки', en: 'Protein', unit: 'g', usda: 1003 },
  fat: { ru: 'Жиры', en: 'Fat', unit: 'g', usda: 1004 },
  carbohydrate: { ru: 'Углеводы', en: 'Carbohydrate', unit: 'g', usda: 1005 },
  fiber: { ru: 'Клетчатка', en: 'Fiber', unit: 'g', usda: 1079 },
  sugar: { ru: 'Сахара', en: 'Sugars', unit: 'g', usda: 2000 },
  saturatedFat: { ru: 'Насыщенные жиры', en: 'Saturated fat', unit: 'g', usda: 1258 },
  transFat: { ru: 'Трансжиры', en: 'Trans fat', unit: 'g', usda: 1257 },
  sodium: { ru: 'Натрий', en: 'Sodium', unit: 'mg', usda: 1093 },
  calcium: { ru: 'Кальций', en: 'Calcium', unit: 'mg', usda: 1087 },
  magnesium: { ru: 'Магний', en: 'Magnesium', unit: 'mg', usda: 1090 },
  potassium: { ru: 'Калий', en: 'Potassium', unit: 'mg', usda: 1092 },
  iron: { ru: 'Железо', en: 'Iron', unit: 'mg', usda: 1089 },
  zinc: { ru: 'Цинк', en: 'Zinc', unit: 'mg', usda: 1095 },
  selenium: { ru: 'Селен', en: 'Selenium', unit: 'mcg', usda: 1103 },
  vitaminC: { ru: 'Витамин C', en: 'Vitamin C', unit: 'mg', usda: 1162 },
  vitaminD: { ru: 'Витамин D', en: 'Vitamin D', unit: 'mcg', usda: 1114 },
  vitaminB12: { ru: 'Витамин B12', en: 'Vitamin B12', unit: 'mcg', usda: 1178 },
  folate: { ru: 'Фолаты, всего', en: 'Folate, total', unit: 'mcg', usda: 1177 },
  omega3ALA: { ru: 'Омега-3, ALA', en: 'Omega-3, ALA', unit: 'g', usda: 1404 },
  omega3EPA: { ru: 'Омега-3, EPA', en: 'Omega-3, EPA', unit: 'g', usda: 1278 },
  omega3DHA: { ru: 'Омега-3, DHA', en: 'Omega-3, DHA', unit: 'g', usda: 1272 },
  vitaminA: { ru: 'Витамин A, RAE', en: 'Vitamin A, RAE', unit: 'mcg', usda: 1106 },
  vitaminE: { ru: 'Витамин E', en: 'Vitamin E', unit: 'mg', usda: 1109 },
  vitaminK: { ru: 'Витамин K1', en: 'Vitamin K1', unit: 'mcg', usda: 1185 },
  vitaminB1: { ru: 'Витамин B1', en: 'Vitamin B1', unit: 'mg', usda: 1165 },
  vitaminB2: { ru: 'Витамин B2', en: 'Vitamin B2', unit: 'mg', usda: 1166 },
  vitaminB3: { ru: 'Витамин B3, ниацин', en: 'Vitamin B3, niacin', unit: 'mg', usda: 1167 },
  vitaminB5: { ru: 'Витамин B5', en: 'Vitamin B5', unit: 'mg', usda: 1170 },
  vitaminB6: { ru: 'Витамин B6', en: 'Vitamin B6', unit: 'mg', usda: 1175 },
  biotin: { ru: 'Биотин', en: 'Biotin', unit: 'mcg', usda: 1176 },
  choline: { ru: 'Холин', en: 'Choline', unit: 'mg', usda: 1180 },
  copper: { ru: 'Медь', en: 'Copper', unit: 'mg', usda: 1098 },
  phosphorus: { ru: 'Фосфор', en: 'Phosphorus', unit: 'mg', usda: 1091 },
  iodine: { ru: 'Йод', en: 'Iodine', unit: 'mcg', usda: 1100 },
  manganese: { ru: 'Марганец', en: 'Manganese', unit: 'mg', usda: 1101 },
  leucine: { ru: 'Лейцин', en: 'Leucine', unit: 'g', usda: 1213 },
  lysine: { ru: 'Лизин', en: 'Lysine', unit: 'g', usda: 1214 },
} as const;
export type NutrientKey = keyof typeof NUTRIENTS;
export const NUTRIENT_KEYS = Object.keys(NUTRIENTS) as NutrientKey[];
export type NutrientQuality = 'known' | 'zero' | 'trace' | 'estimate' | 'unknown';
export type NutrientValue = {
  value: number | null; unit: string; basis: '100g' | '100ml'; quality: NutrientQuality;
  source: string; sourceVersion: string;
};
export type Nutrients = Partial<Record<NutrientKey, NutrientValue>>;
export type FoodCategory = 'soy' | 'legume' | 'seed-oil';
export type Food = {
  category?: string;
  collections?: string[];
  name: string; brand: string; aliases: string[]; ingredients: string;
  state: 'raw' | 'cooked' | 'dry' | 'reconstituted' | 'unknown';
  basis: '100g' | '100ml'; densityGPerMl: number | null; edibleFraction: number;
  servingAmount: number; servingName: string; nutrients: Nutrients;
  contains: FoodCategory[]; mayContain: FoodCategory[]; compositionKnown: boolean;
  legumePreparation: 'not-applicable' | 'adequately-cooked' | 'undercooked' | 'unknown';
  fortified: boolean; favorite: boolean; archived: boolean;
  provenance: { provider: 'label' | 'USDA' | 'recipe' | 'manual'; id: string; version: string; source: string; license: string };
};
export type MealItem = { id: string; foodId: string; food: Food; snapshotAt: string; quantity: number; unit: 'g' | 'ml' | 'serving' };
export type Meal = { date: string; time: string; timeZone: string; name: string; status: 'planned' | 'actual'; items: MealItem[]; note: string; copiedFrom?: string };
export type Recipe = { name: string; ingredients: MealItem[]; yieldGrams: number; servings: number; note: string; food: Food };
export type DietTemplate = { name: string; meals: Meal[] };
export type FoodRule = {
  id: string; category: FoodCategory; enabled: boolean; type: 'personal'; text: string;
  scope: string; level: 'notice'; source: string; reviewedAt: string;
};
export type CustomFoodRule = { id: string; name: string; terms: string[]; text: string; enabled: boolean; reviewedAt: string };
export type NutritionTarget = { energy: number; protein: number; fat: number; carbohydrate: number; fiber: number | null };
export type NutritionProfile = {
  mode: 'macros' | 'calories'; macroUnit: 'g' | 'energy-percent' | 'g-per-kg';
  goal: 'maintain' | 'lose' | 'gain' | 'custom'; method: 'manual' | 'mifflin-st-jeor';
  age: number | null; heightCm: number | null; weightKg: number | null; formulaSex: 'female' | 'male';
  activityFactor: number; excluded: boolean;
  formulaVersion: string; formulaSource: string; activitySource: string;
  training: NutritionTarget; rest: NutritionTarget; selectedNutrients: NutrientKey[];
  foodRules: FoodRule[];
  customFoodRules?: CustomFoodRule[];
  personal?: { activityLevel: 'low' | 'moderate' | 'high'; fitnessGoal: 'lose' | 'maintain' | 'gain' | 'recomposition' | 'endurance' | 'flexibility' };
};
export type NutrientTotal = { value: number | null; knownValue: number; knownItems: number; totalItems: number; unit: string; estimated: boolean };
export type NutrientTotals = Record<NutrientKey, NutrientTotal>;
export type NutrientReference = {
  id: string; nutrient: NutrientKey; value: number; unit: string; type: 'RDA' | 'AI' | 'PRI' | 'UL';
  organization: string; minAge: number; maxAge: number | null; sex: 'any' | 'female' | 'male';
  state: 'any' | 'general' | 'pregnancy' | 'lactation'; sourceScope: 'food' | 'supplement-medication' | 'all-oral';
  source: string; version: string;
};
/** US adult supplemental magnesium UL; this is not a food target or a treatment dose. */
export const NUTRIENT_REFERENCES: NutrientReference[] = [{
  id: 'us-dri-magnesium-ul-adult-1997', nutrient: 'magnesium', value: 350, unit: 'mg', type: 'UL',
  organization: 'US Food and Nutrition Board / NIH ODS', minAge: 19, maxAge: null, sex: 'any', state: 'any',
  sourceScope: 'supplement-medication', source: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/', version: 'DRI 1997; NIH ODS table 3',
}];
export function compareNutrientReference(reference: NutrientReference, person: { age: number | null; sex: 'female' | 'male'; state: NutrientReference['state'] }, sources: { food: number | null; supplement: number | null; medicine: number | null; unit: string }) {
  if (person.age === null || person.age < reference.minAge || (reference.maxAge !== null && person.age > reference.maxAge) || (reference.sex !== 'any' && reference.sex !== person.sex) || (reference.state !== 'any' && reference.state !== person.state) || sources.unit !== reference.unit) return null;
  const values = reference.sourceScope === 'food' ? [sources.food] : reference.sourceScope === 'supplement-medication' ? [sources.supplement, sources.medicine] : [sources.food, sources.supplement, sources.medicine];
  if (values.some(value => value === null || !Number.isFinite(value) || value < 0)) return null;
  const value = values.reduce<number>((sum, amount) => sum + amount!, 0);
  return { value, percent: value / reference.value * 100, aboveUpperLimit: reference.type === 'UL' && value > reference.value };
}

export const DEFAULT_FOOD_RULES: FoodRule[] = [
  ['soy', 'Соя и её производные: личное правило питания'],
  ['legume', 'Бобовые: личное правило питания'],
  ['seed-oil', 'Масла из семян: личное правило питания'],
].map(([category, text]) => ({ id: `personal-${category}`, category: category as FoodCategory, enabled: true, type: 'personal', text, scope: 'Личный рацион; не универсальное медицинское ограничение', level: 'notice', source: 'Пользовательское правило Фюзиса', reviewedAt: '2026-10-24' }));

export function blankFood(): Food {
  return { name: '', brand: '', aliases: [], ingredients: '', state: 'unknown', basis: '100g', densityGPerMl: null, edibleFraction: 1, servingAmount: 100, servingName: 'Порция', nutrients: {}, contains: [], mayContain: [], compositionKnown: false, legumePreparation: 'not-applicable', fortified: false, favorite: false, archived: false, provenance: { provider: 'label', id: '', version: '1', source: 'Этикетка продукта', license: 'Личная запись' } };
}
export function nutrient(value: number | null, key: NutrientKey, basis: Food['basis'], source: string, version = '1', quality?: NutrientQuality): NutrientValue {
  return { value, unit: NUTRIENTS[key].unit, basis, source, sourceVersion: version, quality: quality ?? (value === null ? 'unknown' : value === 0 ? 'zero' : 'known') };
}
/** Units are never inferred from a product name; only explicit density bridges mass and volume. */
export function baseAmount(food: Food, quantity: number, unit: MealItem['unit']): number {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Укажите положительное количество / Enter a positive amount');
  if (unit === 'serving') return quantity * food.servingAmount;
  if ((unit === 'g' && food.basis === '100g') || (unit === 'ml' && food.basis === '100ml')) return quantity;
  if (!food.densityGPerMl || food.densityGPerMl <= 0) throw new Error('Для перевода мл и г нужна плотность / Density is required to convert ml and g');
  return unit === 'ml' ? quantity * food.densityGPerMl : quantity / food.densityGPerMl;
}
export function itemNutrients(item: MealItem): Nutrients {
  const factor = baseAmount(item.food, item.quantity, item.unit) / 100;
  return Object.fromEntries(NUTRIENT_KEYS.map(key => {
    const entry = item.food.nutrients[key];
    return [key, entry ? { ...entry, value: entry.value === null ? null : entry.value * factor } : nutrient(null, key, item.food.basis, item.food.provenance.source, item.food.provenance.version)];
  }));
}
export function totalNutrients(items: MealItem[]): NutrientTotals {
  const values = items.map(itemNutrients);
  return Object.fromEntries(NUTRIENT_KEYS.map(key => {
    const known = values.flatMap(value => value[key]?.value == null ? [] : [value[key]!.value!]);
    const knownValue = known.reduce((a, b) => a + b, 0);
    return [key, { value: known.length === items.length ? knownValue : null, knownValue, knownItems: known.length, totalItems: items.length, unit: NUTRIENTS[key].unit, estimated: values.some(value => value[key]?.quality === 'estimate') }];
  })) as NutrientTotals;
}
export function summaryForDay(store: Pick<PhysisStore, 'records'>, date: string) {
  const meals = store.records.filter(record => record.kind === 'meal' && (record.data as Meal).date === date) as PhysisRecord<Meal>[];
  const plannedItems = meals.filter(record => record.data.status === 'planned').flatMap(record => record.data.items);
  const actualItems = meals.filter(record => record.data.status === 'actual').flatMap(record => record.data.items);
  return { planned: totalNutrients(plannedItems), actual: totalNutrients(actualItems), meals,
    food: totalNutrients(actualItems.filter(item => !item.food.fortified)), fortified: totalNutrients(actualItems.filter(item => item.food.fortified)) };
}
export function snapshotItem(foodId: string, food: Food, quantity: number, unit: MealItem['unit']): MealItem {
  baseAmount(food, quantity, unit);
  return { id: crypto.randomUUID(), foodId, food: structuredClone(food), snapshotAt: new Date().toISOString(), quantity, unit };
}
export function copyMeal(meal: Meal, date: string, originalId = ''): Meal {
  if (!isCivilDate(date)) throw new Error('Некорректная дата / Invalid date');
  return { ...structuredClone(meal), date, status: 'planned', copiedFrom: originalId, items: meal.items.map(item => ({ ...structuredClone(item), id: crypto.randomUUID() })) };
}
/** Recipes retain ingredient composition; cooking loss is deliberately not invented. */
export function recipeFood(name: string, ingredients: MealItem[], yieldGrams: number, servings: number): Food {
  if (!ingredients.length || !Number.isFinite(yieldGrams) || yieldGrams <= 0 || !Number.isFinite(servings) || servings <= 0) throw new Error('Нужны ингредиенты, положительный выход и число порций / Enter ingredients, yield and servings');
  const totals = totalNutrients(ingredients);
  const result = blankFood();
  result.name = name;
  result.state = 'cooked';
  result.servingAmount = yieldGrams / servings;
  result.ingredients = ingredients.map(item => `${item.food.name}: ${item.quantity} ${item.unit}`).join('; ');
  result.provenance = { provider: 'recipe', id: '', version: '1', source: 'Расчёт по ингредиентам; удержание витаминов не моделируется', license: 'Личный рецепт' };
  result.nutrients = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, nutrient(totals[key].value === null ? null : totals[key].value * 100 / yieldGrams, key, '100g', result.provenance.source, '1', totals[key].value === null ? 'unknown' : 'estimate')]));
  result.contains = [...new Set(ingredients.flatMap(item => item.food.contains))];
  result.mayContain = [...new Set(ingredients.flatMap(item => item.food.mayContain))].filter(category => !result.contains.includes(category));
  result.compositionKnown = ingredients.every(item => item.food.compositionKnown);
  const legumes = ingredients.filter(item => item.food.contains.includes('legume'));
  result.legumePreparation = legumes.length === 0 ? 'not-applicable' : legumes.every(item => item.food.legumePreparation === 'adequately-cooked') ? 'adequately-cooked' : legumes.some(item => item.food.legumePreparation === 'undercooked') ? 'undercooked' : 'unknown';
  result.fortified = ingredients.some(item => item.food.fortified);
  return result;
}
export type FoodWarning = { type: 'personal' | 'allergen' | 'preparation' | 'incomplete'; text: string; source: string; scope: string; level: 'notice' | 'warning'; reviewedAt: string };
export function customFoodRuleMatches(food: Food, rule: CustomFoodRule): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replaceAll(String.fromCodePoint(0x451), String.fromCodePoint(0x435)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${normalize([food.name, food.brand, ...food.aliases, food.ingredients].join(' '))} `;
  return rule.enabled && rule.terms.some(term => { const value = normalize(term); return !!value && haystack.includes(` ${value} `); });
}
export function validCustomFoodRule(rule: unknown): rule is CustomFoodRule {
  return object(rule) && ['id', 'name', 'text', 'reviewedAt'].every(key => text(rule[key], key === 'text' ? 2000 : 200) && String(rule[key]).trim().length > 0)
    && typeof rule.enabled === 'boolean' && Array.isArray(rule.terms) && rule.terms.length > 0 && rule.terms.length <= 20
    && rule.terms.every(term => text(term, 80) && term.trim().length > 0 && /[\p{L}\p{N}]/u.test(term));
}
export function foodWarnings(food: Food, rules = DEFAULT_FOOD_RULES, language = 'ru', customRules: CustomFoodRule[] = []): FoodWarning[] {
  const ru = language === 'ru';
  const warnings: FoodWarning[] = rules.filter(rule => rule.enabled && (food.contains.includes(rule.category) || food.mayContain.includes(rule.category))).map(rule => ({ ...rule, text: `${food.mayContain.includes(rule.category) ? ru ? 'Может содержать. ' : 'May contain. ' : ''}${rule.text}`, type: 'personal' }));
  warnings.push(...customRules.filter(rule => customFoodRuleMatches(food, rule)).map(rule => ({ type: 'personal' as const, text: `${rule.name}: ${rule.text}`, source: ru ? 'Ваше правило питания' : 'Your personal food rule', scope: ru ? 'Совпадение слов в названии, бренде, синонимах или составе. Не является проверкой аллергенов.' : 'Words matched in the name, brand, aliases or ingredients. This is not an allergen check.', level: 'notice' as const, reviewedAt: rule.reviewedAt })));
  if (!food.compositionKnown) warnings.push({ type: 'incomplete', text: ru ? 'Состав неполный: отсутствие метки не подтверждает отсутствие ингредиента.' : 'Composition is incomplete: missing tags do not confirm absence.', source: food.provenance.source, scope: 'composition', level: 'notice', reviewedAt: '2026-10-24' });
  if (food.contains.includes('soy') || food.mayContain.includes('soy')) warnings.push({ type: 'allergen', text: ru ? 'Соя — аллерген для людей с аллергией на сою. Пищевая соя и концентрированные изофлавоны различаются.' : 'Soy is relevant for people with soy allergy. Foods differ from concentrated isoflavone supplements.', source: 'https://www.nccih.nih.gov/health/soy', scope: 'soy allergy', level: 'notice', reviewedAt: '2026-10-24' });
  if (food.contains.includes('legume') && food.legumePreparation !== 'adequately-cooked') warnings.push({ type: 'preparation', text: ru ? 'Бобовые: проверьте достаточность обработки по инструкции. Сырые и недоваренные бобы могут содержать активные лектины.' : 'Legumes: verify adequate preparation. Raw and undercooked beans can contain active lectins.', source: 'https://www.efsa.europa.eu/en/news/lectins-food-undercooked-beans-pose-health-risk-says-efsa', scope: 'raw, undercooked or unknown preparation', level: 'warning', reviewedAt: '2026-10-24' });
  return warnings;
}
export function macroEnergy(protein: number, fat: number, carbohydrate: number) { return 4 * protein + 9 * fat + 4 * carbohydrate; }
export function energyDifference(food: Food): number | null {
  const { energy, protein, fat, carbohydrate } = food.nutrients;
  if ([energy, protein, fat, carbohydrate].some(value => value?.value == null)) return null;
  return energy!.value! - macroEnergy(protein!.value!, fat!.value!, carbohydrate!.value!);
}
export function resolveTargets(input: { mode: NutritionProfile['mode']; unit: NutritionProfile['macroUnit']; energy: number; protein: number; fat: number; carbohydrate: number; weightKg: number | null; fiber?: number | null }): NutritionTarget {
  let { energy, protein, fat, carbohydrate } = input;
  if (![energy, protein, fat, carbohydrate].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Цели должны быть неотрицательными числами / Targets must be nonnegative numbers');
  if (input.unit === 'energy-percent') {
    if (energy <= 0 || Math.abs(protein + fat + carbohydrate - 100) > 0.01) throw new Error('Сумма долей энергии должна быть 100%, калорийность — больше нуля / Energy percentages must total 100%');
    protein = energy * protein / 100 / 4; fat = energy * fat / 100 / 9; carbohydrate = energy * carbohydrate / 100 / 4;
  } else if (input.unit === 'g-per-kg') {
    if (!input.weightKg || input.weightKg <= 0) throw new Error('Для г/кг укажите массу / Enter body mass for g/kg');
    protein *= input.weightKg; fat *= input.weightKg; carbohydrate *= input.weightKg;
  }
  const derived = macroEnergy(protein, fat, carbohydrate);
  if (input.mode === 'macros') energy = derived;
  else if (Math.abs(derived - energy) > Math.max(1, energy * .005)) throw new Error('БЖУ не согласованы с калорийностью. Используйте доли энергии или скорректируйте граммы / Macros do not match the calorie target');
  return { energy, protein, fat, carbohydrate, fiber: input.fiber ?? null };
}
export function estimateEnergy(profile: Pick<NutritionProfile, 'age' | 'heightCm' | 'weightKg' | 'formulaSex' | 'activityFactor' | 'excluded'>): { resting: number; maintenance: number; version: string; source: string } {
  if (profile.excluded || profile.age === null || profile.age < 18 || profile.age > 120 || !profile.heightCm || !profile.weightKg) throw new Error('Оценка для взрослых здесь неприменима; задайте ручные цели / Use manual targets for this profile');
  if (profile.heightCm < 100 || profile.heightCm > 250 || profile.weightKg < 25 || profile.weightKg > 400 || !Number.isFinite(profile.activityFactor) || profile.activityFactor < 1 || profile.activityFactor > 2.5) throw new Error('Проверьте параметры формулы / Check formula parameters');
  const resting = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + (profile.formulaSex === 'male' ? 5 : -161);
  return { resting, maintenance: resting * profile.activityFactor, version: 'Mifflin-St Jeor 1990 / Genesis v1', source: 'https://doi.org/10.1093/ajcn/51.2.241' };
}
/** A transparent, editable starting point, never an automatic prescription. */
export function startingNutritionTargets(profile: Pick<NutritionProfile, 'age' | 'heightCm' | 'weightKg' | 'formulaSex' | 'activityFactor' | 'excluded' | 'goal'>) {
  const estimate = estimateEnergy(profile);
  if (profile.goal === 'custom') throw new Error('Для своей цели введите нормы вручную / Enter targets for a custom goal');
  const adjustment = profile.goal === 'lose' ? .9 : profile.goal === 'gain' ? 1.1 : 1;
  const energy = Math.round(estimate.maintenance * adjustment);
  if (energy < 1000) throw new Error('Автоматическая оценка ниже 1000 ккал не предлагается. Проверьте параметры / Automatic targets below 1000 kcal are not offered');
  const target = resolveTargets({ mode: 'calories', unit: 'energy-percent', energy, protein: 20, fat: 30, carbohydrate: 50, weightKg: profile.weightKg, fiber: 14 * energy / 1000 });
  return { estimate, adjustment, target };
}
export function suggestPortion(food: Food, key: NutrientKey, target: number, maxAmount = 1000): { quantity: number; unit: 'g' | 'ml'; fulfills: boolean } | null {
  const value = food.nutrients[key]?.value;
  if (value == null || value <= 0 || !Number.isFinite(target) || target <= 0) return null;
  const needed = target / value * 100;
  return { quantity: Math.min(needed, maxAmount), unit: food.basis === '100g' ? 'g' : 'ml', fulfills: needed <= maxAmount };
}

/** USDA API adapters consume downloaded JSON only; no credentials or personal queries leave the browser. */
export function importUsdaFood(value: unknown): Food {
  if (!object(value) || !Number.isInteger(value.fdcId) || !text(value.description, 500) || !Array.isArray(value.foodNutrients)) throw new Error('Ожидается объект FoodData Central с fdcId и foodNutrients / Invalid FoodData Central JSON');
  const food = blankFood();
  food.name = value.description as string;
  food.brand = typeof value.brandOwner === 'string' ? value.brandOwner.slice(0, 200) : '';
  food.ingredients = typeof value.ingredients === 'string' ? value.ingredients.slice(0, 10000) : '';
  food.provenance = { provider: 'USDA', id: String(value.fdcId), version: `${typeof value.dataType === 'string' ? value.dataType : 'USDA'} / ${typeof value.publicationDate === 'string' ? value.publicationDate : 'version not supplied'}`, source: `https://fdc.nal.usda.gov/food-details/${value.fdcId}/nutrients`, license: 'CC0 — USDA FoodData Central' };
  // FoodData Central foodNutrients use a 100 g basis, including branded foods.
  for (const key of NUTRIENT_KEYS) {
    const row = value.foodNutrients.find(item => object(item) && object(item.nutrient) && item.nutrient.id === NUTRIENTS[key].usda);
    if (!object(row) || !object(row.nutrient) || !finite(row.amount)) continue;
    const unit = String(row.nutrient.unitName).toLowerCase().replace('µg', 'mcg').replace('μg', 'mcg');
    if (unit !== NUTRIENTS[key].unit) continue;
    const derivation = object(row.foodNutrientDerivation) ? String(row.foodNutrientDerivation.description ?? '') : '';
    const estimated = /calculated|imputed|assumed|estimated/i.test(derivation);
    food.nutrients[key] = nutrient(row.amount, key, '100g', `${food.provenance.source}${derivation ? ` · ${derivation}` : ''}`, food.provenance.version, estimated ? 'estimate' : row.amount === 0 ? 'zero' : 'known');
  }
  return food;
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 10000): value is string { return typeof value === 'string' && value.length <= max; }
function finite(value: unknown, max = 1e8): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max; }
function positive(value: unknown, max = 1e8): value is number { return finite(value, max) && value > 0; }
function categories(value: unknown): value is FoodCategory[] { return Array.isArray(value) && value.length <= 3 && value.every(item => ['soy', 'legume', 'seed-oil'].includes(item)); }
function validFood(value: unknown): value is Food {
  if (object(value) && value.category !== undefined && !text(value.category, 80)) return false;
  if (object(value) && value.collections !== undefined && (!Array.isArray(value.collections) || value.collections.length > 20 || !value.collections.every(item => text(item, 80)))) return false;
  if (!object(value) || !text(value.name, 500) || !value.name.trim() || !text(value.brand, 200) || !text(value.ingredients) || !Array.isArray(value.aliases) || value.aliases.length > 100 || !value.aliases.every(item => text(item, 500)) || !['raw', 'cooked', 'dry', 'reconstituted', 'unknown'].includes(String(value.state)) || !['100g', '100ml'].includes(String(value.basis)) || !(value.densityGPerMl === null || positive(value.densityGPerMl, 30)) || !positive(value.edibleFraction, 1) || !positive(value.servingAmount, 100000) || !text(value.servingName, 200) || !object(value.nutrients) || !categories(value.contains) || !categories(value.mayContain) || !['not-applicable', 'adequately-cooked', 'undercooked', 'unknown'].includes(String(value.legumePreparation)) || !['compositionKnown', 'fortified', 'favorite', 'archived'].every(key => typeof value[key] === 'boolean')) return false;
  if (!object(value.provenance) || !['label', 'USDA', 'recipe', 'manual'].includes(String(value.provenance.provider)) || !['id', 'version', 'source', 'license'].every(key => text((value.provenance as Record<string, unknown>)[key], 2000))) return false;
  return Object.entries(value.nutrients).every(([key, item]) => NUTRIENT_KEYS.includes(key as NutrientKey) && object(item) && item.unit === NUTRIENTS[key as NutrientKey].unit && item.basis === value.basis && text(item.source, 2000) && text(item.sourceVersion, 500) && ['known', 'zero', 'trace', 'estimate', 'unknown'].includes(String(item.quality)) && (item.quality === 'unknown' || item.quality === 'trace' ? item.value === null : finite(item.value)) && (item.quality !== 'zero' || item.value === 0));
}
function validItem(value: unknown): value is MealItem {
  if (!object(value) || !text(value.id, 100) || !text(value.foodId, 100) || !text(value.snapshotAt, 100) || !Number.isFinite(Date.parse(value.snapshotAt)) || !validFood(value.food) || !positive(value.quantity, 100000) || !['g', 'ml', 'serving'].includes(String(value.unit))) return false;
  try { baseAmount(value.food, value.quantity, value.unit as MealItem['unit']); return true; } catch { return false; }
}
function validMeal(value: unknown): value is Meal {
  if (!object(value) || !text(value.date) || !isCivilDate(value.date) || !text(value.time) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) || !text(value.timeZone, 100) || !text(value.name, 200) || !value.name.trim() || !['actual', 'planned'].includes(String(value.status)) || !text(value.note) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 200 || !value.items.every(validItem) || new Set(value.items.map(item => item.id)).size !== value.items.length) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); return true; } catch { return false; }
}
function validTarget(value: unknown): value is NutritionTarget { return object(value) && ['energy', 'protein', 'fat', 'carbohydrate'].every(key => finite(value[key], 50000)) && (value.fiber === null || finite(value.fiber, 1000)) && Math.abs(Number(value.energy) - macroEnergy(Number(value.protein), Number(value.fat), Number(value.carbohydrate))) <= Math.max(1, Number(value.energy) * .005); }
export function validateNutritionRecord(record: PhysisRecord): boolean {
  const value = record.data;
  if (record.kind === 'food') return validFood(value);
  if (record.kind === 'meal') return validMeal(value);
  if (record.kind === 'recipe') {
    if (!object(value) || !text(value.name, 500) || !value.name.trim() || !Array.isArray(value.ingredients) || value.ingredients.length === 0 || value.ingredients.length > 200 || !value.ingredients.every(validItem) || !positive(value.yieldGrams, 1e6) || !positive(value.servings, 10000) || !text(value.note) || !validFood(value.food)) return false;
    const expected = recipeFood(value.name, value.ingredients, value.yieldGrams, value.servings);
    const actual = value.food;
    return actual.name === value.name && Math.abs(actual.servingAmount - expected.servingAmount) < 1e-6 && expected.contains.every(category => actual.contains.includes(category)) && expected.mayContain.every(category => actual.mayContain.includes(category)) && actual.compositionKnown === expected.compositionKnown && actual.legumePreparation === expected.legumePreparation && NUTRIENT_KEYS.every(key => actual.nutrients[key]?.value === expected.nutrients[key]?.value);
  }
  if (record.kind === 'diet-template') return object(value) && text(value.name, 200) && !!value.name.trim() && Array.isArray(value.meals) && value.meals.length > 0 && value.meals.length <= 100 && value.meals.every(validMeal);
  if (record.kind === 'nutrition-profile') return object(value) && (value.personal === undefined || object(value.personal) && ['low', 'moderate', 'high'].includes(String(value.personal.activityLevel)) && ['lose', 'maintain', 'gain', 'recomposition', 'endurance', 'flexibility'].includes(String(value.personal.fitnessGoal))) && ['macros', 'calories'].includes(String(value.mode)) && ['g', 'energy-percent', 'g-per-kg'].includes(String(value.macroUnit)) && ['maintain', 'lose', 'gain', 'custom'].includes(String(value.goal)) && ['manual', 'mifflin-st-jeor'].includes(String(value.method)) && ['female', 'male'].includes(String(value.formulaSex)) && ['age', 'heightCm', 'weightKg'].every(key => value[key] === null || finite(value[key], 1000)) && positive(value.activityFactor, 2.5) && typeof value.excluded === 'boolean' && text(value.formulaSource, 2000) && text(value.formulaVersion, 500) && text(value.activitySource, 500) && validTarget(value.training) && validTarget(value.rest) && Array.isArray(value.selectedNutrients) && value.selectedNutrients.every(key => NUTRIENT_KEYS.includes(key)) && (value.customFoodRules === undefined || Array.isArray(value.customFoodRules) && value.customFoodRules.length <= 100 && value.customFoodRules.every(validCustomFoodRule) && new Set(value.customFoodRules.map(rule => rule.id)).size === value.customFoodRules.length) && Array.isArray(value.foodRules) && value.foodRules.length <= 100 && value.foodRules.every(rule => object(rule) && categories([rule.category]) && typeof rule.enabled === 'boolean' && rule.type === 'personal' && rule.level === 'notice' && ['id', 'text', 'scope', 'source', 'reviewedAt'].every(key => text(rule[key], 2000)));
  return false;
}
