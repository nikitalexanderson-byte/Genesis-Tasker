import type { Measurement } from './care-domain.ts';
import type { PhysisSettings } from './types.ts';
import { HEALTH_ICON_NAMES, type HealthIconName } from './health-icon-names.ts';

export type CustomMetricDefinition = {
  id: string; name: string; unit: string; icon: HealthIconName;
  scale: 'numeric' | 'subjective'; legacyLabel?: string;
  hidden?: boolean; deleted?: boolean;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
export function validCustomMetrics(value: unknown): value is CustomMetricDefinition[] {
  if (!Array.isArray(value) || value.length > 200) return false;
  return value.every(item => item && typeof item === 'object' && text(item.id, 240) && text(item.name, 200) && text(item.unit, 60) &&
    HEALTH_ICON_NAMES.includes(item.icon) && ['numeric', 'subjective'].includes(item.scale) &&
    (item.legacyLabel === undefined || text(item.legacyLabel, 200)) &&
    (item.hidden === undefined || typeof item.hidden === 'boolean') &&
    (item.deleted === undefined || typeof item.deleted === 'boolean')) && new Set(value.map(item => item.id)).size === value.length &&
    new Set(value.filter(item => item.legacyLabel).map(item => item.legacyLabel)).size === value.filter(item => item.legacyLabel).length;
}
export function customMetricDefinitions(settings: Pick<PhysisSettings, 'customMetrics'>, measurements: Measurement[]): CustomMetricDefinition[] {
  const result = (settings.customMetrics ?? []).map(item => ({ ...item }));
  for (const measurement of measurements) {
    if (measurement.type !== 'custom') continue;
    if (result.some(definition => measurementInCustomMetric(measurement, definition))) continue;
    result.push({ id: measurement.customMetricId ?? `legacy:${measurement.label}`, name: measurement.label, unit: measurement.unit,
      scale: measurement.scale, icon: 'sliders-horizontal', ...(measurement.customMetricId ? {} : { legacyLabel: measurement.label }) });
  }
  return result;
}
export function measurementInCustomMetric(measurement: Measurement, definition: CustomMetricDefinition): boolean {
  return measurement.type === 'custom' && (measurement.customMetricId ? measurement.customMetricId === definition.id :
    measurement.label === definition.legacyLabel || definition.id === `legacy:${measurement.label}`);
}
