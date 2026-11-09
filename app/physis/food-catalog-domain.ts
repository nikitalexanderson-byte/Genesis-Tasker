import type { Food, NutrientKey } from './nutrition-domain.ts';

export const FOOD_TYPE_GROUPS = ['Фрукты', 'Ягоды', 'Овощи и зелень', 'Крупы и злаки', 'Орехи и семена', 'Грибы', 'Морские водоросли', 'Мясо и рыба', 'Яйца', 'Молочные продукты', 'Протеины', 'Масла и жиры', 'Специи', 'Чаи и напитки', 'Хлебобулочные', 'Кулинарные ингредиенты', 'Готовые блюда', 'Другое'];
const aliases: Record<string, string> = {
  'Овощи': 'Овощи и зелень', 'Зелень': 'Овощи и зелень', 'Злаки': 'Крупы и злаки',
  'Орехи': 'Орехи и семена', 'Семена': 'Орехи и семена', 'Молочные и ферментированные продукты': 'Молочные продукты',
};
// Collection membership is separate from the food type; keep source records untouched.
const collectionFoodTypes: Record<string, string> = {
  'PHY-0191': 'Морские водоросли', 'PHY-0337': 'Кулинарные ингредиенты', 'PHY-0963': 'Кулинарные ингредиенты',
  'PHY-0990': 'Овощи и зелень', 'PHY-1013': 'Овощи и зелень', 'PHY-1065': 'Овощи и зелень',
  'PHY-1085': 'Овощи и зелень', 'PHY-1195': 'Кулинарные ингредиенты', 'PHY-1196': 'Орехи и семена',
};
type FoodClassification = {
  food: Pick<Food, 'category'>;
  record?: { kind: string };
  reference?: { id: string; family: string; tags: string[] };
};
const canonicalType = (value: string) => aliases[value] ?? (FOOD_TYPE_GROUPS.includes(value) ? value : undefined);
export function foodTypeCategories(entry: FoodClassification): string[] {
  if (entry.record?.kind === 'recipe') return ['Готовые блюда'];
  const types = [entry.food.category ?? '', entry.reference?.family ?? '', ...(entry.reference?.tags ?? [])]
    .map(canonicalType).filter((value): value is string => !!value);
  if (types.length) return [...new Set(types)];
  return [collectionFoodTypes[entry.reference?.id ?? ''] ?? 'Другое'];
}
export function foodResearchCategories(entry: FoodClassification): string[] {
  return [...new Set(entry.reference?.tags ?? [])].filter(value => !canonicalType(value) && value !== 'Суперфуды' && value !== 'ТОП СУПЕРФУДОВ');
}

export const FOOD_MACROS: NutrientKey[] = ['energy', 'protein', 'fat', 'carbohydrate'];
export function foodMacrosPer100g(food: Pick<Food, 'nutrients' | 'basis' | 'densityGPerMl'>) {
  const hasDensity = food.densityGPerMl !== null && Number.isFinite(food.densityGPerMl) && food.densityGPerMl > 0;
  let needsDensity = false;
  const values = FOOD_MACROS.map(key => {
    const item = food.nutrients[key];
    if ((item?.basis ?? food.basis) === '100ml' && !hasDensity) {
      needsDensity = true;
      return null;
    }
    if (item?.value == null || !Number.isFinite(item.value)) return null;
    return item.basis === '100ml' ? item.value / food.densityGPerMl! : item.value;
  });
  return { values, needsDensity };
}
