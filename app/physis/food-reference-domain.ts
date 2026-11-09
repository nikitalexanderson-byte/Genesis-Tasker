import type { Food, NutrientKey } from './nutrition-domain.ts';
import { blankFood, NUTRIENT_KEYS, nutrient } from './nutrition-domain.ts';
import raw from './food-reference-data.json';
import labels from './food-label-nutrients.json';
type FoodReference = { id: string; fdcId: number | null; manualId?: number; name: string[]; aliases?: string[]; category: string; state: Food['state']; top: boolean; properties: string[]; health: string[]; limits: string[]; links: string[]; legume?: boolean };
export const FOOD_REFERENCES = raw as FoodReference[];
export const foodReferenceFor = (food: Food) => FOOD_REFERENCES.find(entry => entry.id === food.provenance.id || `reference:${entry.id}` === food.provenance.id);
export const isTopFood = (food: Food) => food.category === 'ТОП СУПЕРФУДОВ' || !!food.collections?.includes('superfoods') || !!foodReferenceFor(food)?.top;
export function manualReferenceFoods(language: string) {
  return FOOD_REFERENCES.filter(entry => entry.manualId).map(entry => {
    const food = blankFood();
    food.name = entry.name[language === 'en' ? 1 : 0]; food.aliases = [...entry.name, ...(entry.aliases ?? [])];
    food.category = entry.category; food.state = entry.state; food.collections = ['superfoods'];
    food.ingredients = food.name; food.compositionKnown = false;
    if (entry.legume) food.contains = ['legume'];
    food.provenance = { provider: 'manual', id: `reference:${entry.id}`, version: 'GENESIS / 2026-10-25 / label required', source: entry.links[0], license: 'Original reference text; numerical composition requires the product label.' };
    const label = (labels as Record<string, {brand:string;source:string;basisGrams:number;values:Partial<Record<NutrientKey,number>>}>)[entry.id];
    if (label) {
      food.brand = label.brand;
      food.provenance = { provider: 'label', id: `reference:${entry.id}`, version: 'Label checked 2026-10-26; normalized to 100 g', source: label.source, license: 'Factual product-label values; attribution to the linked publisher.' };
      food.nutrients = Object.fromEntries(NUTRIENT_KEYS.map(key => [key, nutrient(label.values[key] === undefined ? null : Number((label.values[key]! * 100 / label.basisGrams).toFixed(8)), key, '100g', label.source, food.provenance.version)]));
    }
    return { id: `00000000-0000-4000-8000-${String(entry.manualId).padStart(12, '0')}`, food };
  });
}
