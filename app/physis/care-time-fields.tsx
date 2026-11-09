import { useState } from 'react';
import { CalendarDatePicker } from '../CalendarDatePicker';
import { TimeClockPicker } from '../TimeClockPicker';
import type { CalendarContext } from '../calendar-context';
import type { CalendarMode } from '../calendar-data';
import { careMomentParts, editCareMoment } from './care-domain';
import { Field } from './fields';

export function PhysisMomentFields({ value, fallbackDay, timeZone, context, calendarMode, dayLabel, timeLabel, onChange }: {
  value: string | null; fallbackDay: string; timeZone: string; context: CalendarContext; calendarMode: CalendarMode;
  dayLabel: string; timeLabel: string; onChange: (timestamp: string, day: string) => void;
}) {
  const [notice, setNotice] = useState('');
  let parts: { day: string; time: string };
  try { parts = careMomentParts(value, timeZone, fallbackDay); }
  catch { return <p className="physis-warning physis-wide" role="alert">Проверьте часовой пояс записи.</p>; }
  const update = (day: string, time: string) => {
    try {
      const next = editCareMoment(value, timeZone, day, time);
      onChange(next.timestamp, next.day);
      setNotice(next.adjustment === 'exact' ? '' : 'Время скорректировано существующим правилом Genesis для перехода летнего времени.');
    } catch { setNotice('Проверьте дату и время.'); }
  };
  return <>
    <Field label={dayLabel}><CalendarDatePicker value={value === null ? '' : parts.day} mode={calendarMode} calculationContext={{ ...context, timeZone }} onChange={day => update(day, parts.time)} ariaLabel={dayLabel} /></Field>
    <Field label={timeLabel}><TimeClockPicker value={value === null ? '' : parts.time} onChange={time => update(parts.day, time)} ariaLabel={timeLabel} /></Field>
    <p className="physis-muted physis-wide">Часовой пояс записи: {timeZone}</p>
    {notice ? <p className="physis-status physis-wide" role="status">{notice}</p> : null}
  </>;
}
