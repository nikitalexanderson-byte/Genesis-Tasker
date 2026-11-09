import { NUTRIENT_KEYS, nutrient, type Food, type NutrientKey } from './nutrition-domain.ts';
import raw from './food-composition-data.json';

/** Values are per edible 100 g / 100 ml, never a mixture of food states or brands. */
export type FoodComposition = {
  state: Food['state']; basis: Food['basis']; densityGPerMl: number | null;
  descriptionRu: string; descriptionEn: string; source: string; version: string; license: string;
  provider: Food['provenance']['provider']; values: Partial<Record<NutrientKey, number>>;
  estimated: NutrientKey[]; trace: NutrientKey[];
};
export const FOOD_COMPOSITIONS = raw as Record<string, FoodComposition>;
export function applyFoodComposition(food: Food, composition: FoodComposition): Food {
  return { ...food, state: composition.state, basis: composition.basis, densityGPerMl: composition.densityGPerMl,
    provenance: { ...food.provenance, provider: composition.provider, source: composition.source, version: composition.version, license: composition.license },
    nutrients: Object.fromEntries(NUTRIENT_KEYS.map(key => [key, nutrient(composition.values[key] ?? null, key, composition.basis, composition.source, composition.version,
      composition.trace.includes(key) ? 'trace' : composition.values[key] == null ? 'unknown' : composition.estimated.includes(key) ? 'estimate' : undefined)])) };
}
export function compositionFromFood(food: Food): FoodComposition {
  return { state: food.state, basis: food.basis, densityGPerMl: food.densityGPerMl, descriptionRu: food.name, descriptionEn: food.aliases.find(name => /^[A-Za-z]/.test(name)) ?? food.name,
    source: food.provenance.source, version: food.provenance.version, license: food.provenance.license, provider: food.provenance.provider,
    values: Object.fromEntries(NUTRIENT_KEYS.flatMap(key => food.nutrients[key]?.value == null ? [] : [[key, food.nutrients[key]!.value]])),
    estimated: NUTRIENT_KEYS.filter(key => food.nutrients[key]?.quality === 'estimate'), trace: NUTRIENT_KEYS.filter(key => food.nutrients[key]?.quality === 'trace') };
}

// User's catalog policy, not a universal nutritional or medical claim. Historical data is retained.
export const EXCLUDED_FOOD_CATALOG_IDS = new Set(['PHY-0216','PHY-0223','PHY-0233','PHY-0237','PHY-0810','PHY-0963','PHY-0987','PHY-1039','PHY-1117']);
const legumes = /(?:^|[^\p{L}])(?:соя|соев[\p{L}]*|бобов[\p{L}]*|бобы|боб|фасол[\p{L}]*|чечевиц[\p{L}]*|горох[\p{L}]*|нут|нута|арахис[\p{L}]*|люпин[\p{L}]*|маш|эдамаме|тофу|темпе|натто|soy(?:bean)?s?|soya|tofu|tempeh|natto|lentils?|peanuts?|chickpeas?|peas?|legumes?|lupins?)(?:$|[^\p{L}])/iu;
const seedOil = /(?:масл[\p{L}]*.*(?:семян|подсолнеч|кунжут|льнян|рапс|кукуруз|тыквен|конопл|виноградн.*косточ|сафлор|хлопк|горчич|рисов.*отруб|ч[её]рн.*тмин)|(?:подсолнеч|кунжут|льнян|рапс|кукуруз|тыквен|конопл|сафлор|хлопк|горчич)[\p{L}\s]*масл|(?:seed|sunflower|sesame|flax|linseed|rapeseed|canola|corn|hemp|safflower|cottonseed|mustard|rice bran).*oil)/iu;
export function excludedCatalogFood(food: Pick<Food,'name'|'aliases'|'category'|'contains'>, catalogId = ''): boolean {
  const names=[food.name,...food.aliases].join(' ').replace(/(?:какао[\s-]+бобы|кофейные\s+бобы|бобы\s+(?:какао|кофе)|(?:coffee|cocoa|cacao|vanilla)\s+beans?)/giu,'');
  return EXCLUDED_FOOD_CATALOG_IDS.has(catalogId) || food.category === 'Бобовые' || food.contains.some(value => ['soy','legume','seed-oil'].includes(value))
    || legumes.test(names) || /\bbeans?\b/i.test(names) || seedOil.test(names);
}
