import raw from './vitamin-food-sources.json';
import minerals from './mineral-food-sources.json';

export type VitaminFoodSource = { food: string[]; amount: number; amountMax?: number; approximate?: boolean; unit: string; portion: string[]; source: string; fdcId?: number; nutrientId?: number };
export type VitaminFoodProfile = { label: string[]; note: string[] | null; items: VitaminFoodSource[] };
export const VITAMIN_FOOD_SOURCES = raw as Record<string, VitaminFoodProfile>;
export const NUTRIENT_FOOD_SOURCES = { ...VITAMIN_FOOD_SOURCES, ...minerals } as Record<string, VitaminFoodProfile>;
