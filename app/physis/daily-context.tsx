import { useId } from 'react';
import { translateText, type Language } from '../i18n';
import { addCivilDays, todayCivilDate } from '../calendar-context';
import { formatCalendarDateValue } from '../calendar-data';
import { pendingIntakeEvents, METRICS, type Intake, type Regimen, type Measurement } from './care-domain';
import type { Meal } from './nutrition-domain';
import { physisRecords, type PhysisFeatureProps } from './types';

export function PhysisDailyContext({ onNutrition, onIntakes, onMeasurements, now, ...props }: PhysisFeatureProps & {
  now: number; onNutrition: () => void; onIntakes: () => void; onMeasurements: () => void;
}) {
  const en = props.language === 'en'; const t = (ru: string, english: string) => en ? english : ru;
  const headingId = useId();
  const today = todayCivilDate(props.context);
  const meals = physisRecords<Meal>(props.store, 'meal').filter(r => r.data.status === 'actual');
  const logged = meals.filter(r => r.data.date === today);
  const days = new Set(meals.filter(r => r.data.date >= addCivilDays(today, -6) && r.data.date <= today).map(r => r.data.date)).size;
  const pending = pendingIntakeEvents(physisRecords<Regimen>(props.store, 'regimen'), physisRecords<Intake>(props.store, 'intake'), today, true);
  const measurements = physisRecords<Measurement>(props.store, 'measurement').filter(r => props.settings.enabledMetrics.includes(r.data.type)).sort((a,b) => b.data.timestamp.localeCompare(a.data.timestamp));
  return <div className="physis-daily-context" aria-label={t('Другие записи дня', 'Other daily records')}>
    {props.settings.overviewBlocks.includes('nutrition') && <section className="physis-daily-block" aria-labelledby={`${headingId}-nutrition`}><h3 id={`${headingId}-nutrition`}>{t('Питание', 'Nutrition')}</h3><p>{logged.length ? `${t('Записано приёмов', 'Meals logged')}: ${logged.length}` : t('Съеденное ещё не записано', 'No food logged yet')}</p><p className="physis-muted">{t('За последние 7 дней есть записи', 'Days with entries in the last 7 days')}: {days}/7. {t('Полнота учёта не подтверждена.', 'Diary completeness is not confirmed.')}</p><button type="button" className="physis-day-action" onClick={onNutrition}>{t('Открыть рацион', 'Open diary')}</button></section>}
    {props.settings.overviewBlocks.includes('intakes') && <section className="physis-daily-block" aria-labelledby={`${headingId}-intakes`}><h3 id={`${headingId}-intakes`}>{t('Приёмы БАДов и лекарств', 'Supplement and medication intakes')}</h3><p>{pending.length ? `${pending[0].drugSnapshot.name} · ${pending[0].dose} ${pending[0].unit}` : t('Приёмов без отметки сегодня нет', 'No unmarked intakes today')}</p>{pending[0] && <p className="physis-muted">{Date.parse(pending[0].dueAt) <= now ? t('Не отмечено', 'Unmarked') : t('Запланировано', 'Planned')} · {new Date(pending[0].dueAt).toLocaleTimeString(en ? 'en-GB' : 'ru', {timeZone:pending[0].timeZone,hour:'2-digit',minute:'2-digit'})}</p>}<button type="button" className="physis-day-action" onClick={onIntakes}>{t('Открыть контроль приёма', 'Open intake tracker')}</button></section>}
    {props.settings.overviewBlocks.includes('measurements') && <section className="physis-daily-block" aria-labelledby={`${headingId}-measurements`}><h3 id={`${headingId}-measurements`}>{t('Показатели', 'Measurements')}</h3><p>{measurements[0] ? `${translateText(METRICS.find(([key]) => key === measurements[0].data.type)?.[1] ?? measurements[0].data.label, props.language as Language)}: ${measurements[0].data.value} ${measurements[0].data.unit}` : t('Нет записей выбранных показателей', 'No selected measurements logged')}</p>{measurements[0] && <p className="physis-muted">{formatCalendarDateValue(measurements[0].data.day,props.settings.calendarMode,false,props.context)}</p>}<button type="button" className="physis-day-action" onClick={onMeasurements}>{t('Открыть показатели', 'Open measurements')}</button></section>}
  </div>;
}
