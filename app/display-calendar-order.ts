import type {CalendarMode} from './calendar-data';

export const DISPLAY_CALENDARS = ['profane', 'sacred', 'lunar'] as const;
export function displayCalendarOrder(value: unknown): CalendarMode[] {
  if (!Array.isArray(value) || value.length !== 3 || new Set(value).size !== 3 || value.some(id => !DISPLAY_CALENDARS.includes(id))) return [...DISPLAY_CALENDARS];
  return [...value];
}
export function moveDisplayCalendar(value: readonly CalendarMode[], source: CalendarMode, target: CalendarMode): CalendarMode[] {
  const next = displayCalendarOrder(value), from = next.indexOf(source), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1); next.splice(to, 0, source); return next;
}
