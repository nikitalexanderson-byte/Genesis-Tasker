import { validateTrainingRecord } from './training-domain.ts';
import { validateNutritionRecord } from './nutrition-domain.ts';
import { validateCareRecord } from './care-domain.ts';
import type { PhysisRecord } from './types.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validatePhysisRecord(value: unknown): value is PhysisRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as PhysisRecord;
  if (record.schemaVersion !== 1 || !UUID.test(record.id) || !['manual', 'import'].includes(record.source) ||
      !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt)) ||
      !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return false;
  try {
    if (['exercise', 'program', 'assignment', 'session'].includes(record.kind)) return validateTrainingRecord(record);
    if (['food', 'recipe', 'meal', 'nutrition-profile', 'diet-template'].includes(record.kind)) return validateNutritionRecord(record);
    return validateCareRecord(record);
  } catch { return false; }
}
