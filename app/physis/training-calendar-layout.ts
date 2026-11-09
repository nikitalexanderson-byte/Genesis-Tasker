import { addCivilDays, civilDateCarrier, type CalendarContext } from '../calendar-context';
import { calendarMonthRange, getLunarDate, getSacredDate, type CalendarMode } from '../calendar-data';

/** Calendar-native month boundaries; padding belongs only to Gregorian weeks. */
export function trainingCalendarLayout(value: string, mode: CalendarMode, context: CalendarContext, weekStart: 'sunday' | 'monday' = 'sunday') {
  const range = calendarMonthRange(value, mode, context);
  const days: { date: string; number: number }[] = [];
  for (let date = range.start; date <= range.end; date = addCivilDays(date, 1)) {
    const carrier = civilDateCarrier(date);
    days.push({ date, number: mode === 'sacred' ? getSacredDate(carrier, context).day : mode === 'lunar' ? getLunarDate(carrier, context).day : Number(date.slice(-2)) });
  }
  if (mode === 'profane') {
    const offset = (civilDateCarrier(range.start).getDay() - (weekStart === 'monday' ? 1 : 0) + 7) % 7;
    const cells: (typeof days[number] | null)[] = [...Array.from({ length: offset }, () => null), ...days];
    while (cells.length % 7) cells.push(null);
    return { range, columns: 7, groups: [{ index: 0, cells }] };
  }
  const size = mode === 'sacred' ? 5 : 10;
  return { range, columns: 5, groups: Array.from({ length: Math.ceil(days.length / size) }, (_, index) => ({ index, cells: days.slice(index * size, (index + 1) * size) })) };
}
