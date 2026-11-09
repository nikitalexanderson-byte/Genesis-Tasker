import { calendarPeriod } from '../calendar-astronomy.ts';
import { addCivilDays, civilDayNumber, type CalendarContext } from '../calendar-context.ts';
import type { CalendarMode } from '../calendar-data.ts';

/** Inclusive display periods. The short final lunar decade stays inside its month. */
export function nutritionPeriodRange(anchor: string, mode: CalendarMode, period: 'day' | 'week' | 'month', context: CalendarContext) {
  if (period === 'day') return { start: anchor, end: anchor };
  if (period === 'week' && mode === 'profane') return { start: anchor, end: addCivilDays(anchor, 6) };
  const month = calendarPeriod(anchor, mode, 'month', context); const monthEnd = addCivilDays(month.end, -1);
  if (period === 'month') return { start: month.start, end: monthEnd };
  const length = mode === 'sacred' ? 5 : 10;
  const offset = civilDayNumber(anchor) - civilDayNumber(month.start);
  const start = addCivilDays(month.start, Math.floor(offset / length) * length);
  const end = addCivilDays(start, length - 1);
  return { start, end: end < monthEnd ? end : monthEnd };
}
