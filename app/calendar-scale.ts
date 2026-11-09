export type CalendarScale = 1 | 0.5 | 0.25;
export const calendarScaleValue = (value: unknown): CalendarScale => value === 0.5 || value === 0.25 ? value : 1;
