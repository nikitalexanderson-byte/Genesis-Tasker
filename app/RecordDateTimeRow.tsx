import {CalendarDatePicker} from './CalendarDatePicker';
import {TimeClockPicker} from './TimeClockPicker';
import {formatCalendarDateValue, type CalendarMode} from './calendar-data';
import {getRuntimeLanguage, translateText, type Language} from './i18n';
import type {TimeFormat} from './time-format';
import {useSacredFeaturesEnabled} from './sacred-features';

/** Keep the primary date and time visible while project and repeat settings fold. */
export function RecordDateTimeRow({date, time, onDateChange, onTimeChange, mode, timeFormat, min,
  dateId, timeId, dateLabel, timeLabel, timeDisabled = false, required = false, className = ''}: {
  date: string; time: string; onDateChange: (value: string) => void; onTimeChange: (value: string) => void;
  mode: CalendarMode; timeFormat: TimeFormat; min?: string; dateId?: string; timeId?: string;
  dateLabel?: string; timeLabel?: string; timeDisabled?: boolean; required?: boolean; className?: string;
}) {
  const language = getRuntimeLanguage() as Language;
  const effectiveMode = useSacredFeaturesEnabled() ? mode : 'profane';
  const dateName = dateLabel ?? translateText('Начало', language), timeName = timeLabel ?? translateText('Время', language);
  return <div className={`record-date-time-row ${className}`.trim()}>
    <label htmlFor={dateId}><span className="sr-only">{dateName}</span>
      <CalendarDatePicker id={dateId} ariaLabel={date ? `${dateName}: ${formatCalendarDateValue(date, effectiveMode, true)}` : dateName} mode={effectiveMode} min={min} value={date}
        triggerText={effectiveMode === 'profane' ? undefined : formatCalendarDateValue(date, effectiveMode)} referencePlacement="inline" onChange={onDateChange} required={required}/></label>
    <label htmlFor={timeId}><span className="sr-only">{timeName}</span>
      <TimeClockPicker id={timeId} ariaLabel={timeName} value={time} timeFormat={timeFormat} disabled={timeDisabled} onChange={onTimeChange}/></label>
  </div>;
}
