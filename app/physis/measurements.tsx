import { useEffect, useState } from 'react';
import { momentCivilDate, todayCivilDate, addCivilDays } from '../calendar-context';
import { formatCalendarDateValue } from '../calendar-data';
import { METRICS, convertGlucose, measurementUnits, type Measurement } from './care-domain';
import { editPhysisRecord, newPhysisRecord, physisRecords, type PhysisFeatureProps, type PhysisRecord, type PhysisSettings } from './types';
import { Field, NumberField, usePhysisAction } from './fields';
import { PhysisMomentFields } from './care-time-fields';
import { IconActionButton } from '../IconActionButton';
import { customMetricDefinitions, measurementInCustomMetric, type CustomMetricDefinition } from './custom-metric-domain';
import { HealthIcon } from './health-icons';
import { MetricNavigation } from './metric-navigation';
import { MetricDefinitionDialog } from './metric-definition-dialog';
import './monitoring.css';
import { translateText, type Language } from '../i18n';

const metricDescriptions: Record<Measurement['type'], string> = {
  pressure: 'Систолическое и диастолическое давление, рука и положение тела.',
  glucose: 'Сахар крови с учётом времени приёма пищи и единиц измерения.',
  weight: 'Масса тела и её изменение по датам измерений.',
  waist: 'Обхват талии и история измерений в сантиметрах.',
  'resting-pulse': 'Частота сердечных сокращений в покое.',
  sleep: 'Продолжительность сна и заметки о восстановлении.',
  wellbeing: 'Личная оценка самочувствия по шкале от 1 до 10.',
  soreness: 'Личная оценка мышечной болезненности по шкале от 0 до 10.',
  steps: 'Количество шагов и история ежедневной активности.',
  water: 'Объём выпитой воды и записи по времени.',
  hrv: 'Вариабельность сердечного ритма с указанием устройства и контекста.',
  spo2: 'Насыщение крови кислородом по показанию пульсоксиметра.',
  temperature: 'Температура тела, время и условия измерения.',
  custom: 'Свой показатель с названием, единицей и личной шкалой.',
};
const metricName = (type: string) => METRICS.find(([key]) => key === type)?.[1] ?? type;
export function PhysisMeasurements({ store, settings, context, language, hintOwner, onDisableHints }: PhysisFeatureProps & { hintOwner?: string; onDisableHints?: () => void }) {
  const text = (value: string) => translateText(value, language as Language);
  const [hintOpen, setHintOpen] = useState(false);
  useEffect(() => {
    if (!hintOwner || settings.monitoringHints === false) return;
    try {
      const key = `genesis:physis:monitoring-hint:${hintOwner}`;
      const last = Number(localStorage.getItem(key));
      if (!last || Date.now() - last >= 7 * 86400000) {
        const timer = setTimeout(() => { localStorage.setItem(key, String(Date.now())); setHintOpen(true); }, 650);
        return () => clearTimeout(timer);
      }
    } catch { /* Storage unavailable: the optional hint stays closed. */ }
  }, [hintOwner, settings.monitoringHints]);
  const hint = hintOpen && settings.monitoringHints !== false ? <aside className="physis-monitoring-hint" role="status"><h3>Больше показателей</h3><p>В настройках Фюзиса можно включить давление, сахар и другие показатели. История сохраняется и после отключения.</p><div className="physis-actions"><button type="button" onClick={() => setHintOpen(false)}>Понятно</button><button type="button" onClick={() => { setHintOpen(false); onDisableHints?.(); }}>Больше не показывать</button></div></aside> : null;
  const [selectedType, setType] = useState<Measurement['type']>((settings.enabledMetrics[0] as Measurement['type']) ?? 'weight');
  const type = settings.enabledMetrics.includes(selectedType) ? selectedType : (settings.enabledMetrics[0] as Measurement['type']) ?? 'weight';
  const [contextFilter, setContextFilter] = useState(''); const [period, setPeriod] = useState('30');
  const [selectedCustomId, setCustomId] = useState('');
  const [editingMetric, setEditingMetric] = useState<CustomMetricDefinition | 'new' | null>(null);
  const records = physisRecords<Measurement>(store, 'measurement');
  const allDefinitions = customMetricDefinitions(settings, records.map(record => record.data));
  const definitions = allDefinitions.filter(item => !item.deleted && !item.hidden);
  const customMetric = definitions.find(item => item.id === selectedCustomId) ?? definitions[0];
  const draftKey = type === 'custom' ? `custom:${customMetric?.id ?? ''}` : type;
  const [drafts, setDrafts] = useState<Record<string, PhysisRecord<Measurement> | null>>({});
  const draft = drafts[draftKey] ?? null;
  const setDraft = (next: PhysisRecord<Measurement> | null | ((current: PhysisRecord<Measurement> | null) => PhysisRecord<Measurement> | null)) => setDrafts(current => ({ ...current, [draftKey]: typeof next === 'function' ? next(current[draftKey] ?? null) : next }));
  const action = usePhysisAction(); const today = todayCivilDate(context);
  const history = records.filter(r => r.data.type === type && r.data.day >= addCivilDays(today, 1 - Number(period)) && r.data.day <= today && (!contextFilter || r.data.context === contextFilter) && (type !== 'custom' || !!customMetric && measurementInCustomMetric(r.data, customMetric)))
    .sort((a, b) => a.data.timestamp.localeCompare(b.data.timestamp));
  const contexts = [...new Set(records.filter(r => r.data.type === type && (type !== 'custom' || !!customMetric && measurementInCustomMetric(r.data, customMetric))).map(r => r.data.context))];
  const value = (m: Measurement) => m.type === 'glucose' ? convertGlucose(m.value, m.unit, settings.glucoseUnit)
    : m.type === 'weight' && m.unit === 'kg' && settings.weightUnit === 'lb' ? m.value * 2.2046226218
    : m.type === 'weight' && m.unit === 'lb' && settings.weightUnit === 'kg' ? m.value / 2.2046226218 : m.value;
  const unit = (m: Measurement) => m.type === 'glucose' ? settings.glucoseUnit : m.type === 'weight' ? settings.weightUnit : m.unit;
  const newEntry = () => {
    if (draft || type === 'custom' && !customMetric) return;
    const now = new Date().toISOString(); const metric = METRICS.find(([id]) => id === type)!;
    setDraft(newPhysisRecord<Measurement>('measurement', { type, ...(type === 'custom' && customMetric ? { customMetricId: customMetric.id } : {}), label: type === 'custom' ? customMetric!.name : metric[1], value: 0, secondValue: type === 'pressure' ? 0 : null, pulse: null,
      unit: type === 'custom' ? customMetric!.unit : type === 'glucose' ? settings.glucoseUnit : type === 'weight' ? settings.weightUnit : metric[2], timestamp: now, timeZone: settings.timeZone,
      day: momentCivilDate(new Date(now), settings.timeZone), source: 'Вручную', device: '', context: '', intervalMinutes: null, arm: '', position: '', note: '',
      scale: type === 'custom' ? customMetric!.scale : type === 'wellbeing' || type === 'soreness' ? 'subjective' : 'numeric', target: null, editedAt: null }));
  };
  const change = (patch: Partial<Measurement>) => setDraft(record => record ? editPhysisRecord(record, { ...record.data, ...patch }) : record);
  const chartAllowed = history.length > 1 && new Set(history.map(r => `${r.data.type === 'custom' ? customMetric?.id : r.data.type}:${unit(r.data)}:${r.data.scale}:${r.data.context}`)).size === 1;
  const values = history.map(r => value(r.data)); const lo = Math.min(...values); const hi = Math.max(...values);
  const firstTime = history.length ? Date.parse(history[0].data.timestamp) : 0;
  const span = history.length ? Math.max(1, Date.parse(history.at(-1)!.data.timestamp) - firstTime) : 1;
  const points = history.map(r => `${20 + (Date.parse(r.data.timestamp) - firstTime) / span * 560},${140 - (value(r.data) - lo) / Math.max(1, hi - lo) * 120}`).join(' ');
  if (!settings.enabledMetrics.length) return <section className="physis-panel"><h2>Мониторинг показателей</h2>{hint}<p className="physis-empty">Включите нужные показатели в настройках Фюзиса. Отключение инструмента сохраняет историю.</p></section>;
  return <div className="physis-monitoring-layout">{hint}<MetricNavigation enabled={settings.enabledMetrics} selected={type} language={language} describe={(id, name) => `${text(name)}. ${text(metricDescriptions[id])}`} onSelect={id => { setType(id); setContextFilter(''); }} /><section id="physis-measurement-page" aria-labelledby="physis-measurement-title" className="physis-panel"><header className="physis-measurement-heading"><div><h2 id="physis-measurement-title">{type === 'custom' ? customMetric?.name ?? text('Свои показатели') : text(metricName(type))}</h2><p className="physis-muted">{text(metricDescriptions[type])}</p></div><button className="physis-primary" disabled={type === 'custom' && !customMetric} onClick={newEntry}>Записать измерение</button></header><div className="physis-form"><Field label="Период истории"><select value={period} onChange={e => setPeriod(e.target.value)}><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="365">Год</option></select></Field><Field label="Контекст"><select value={contextFilter} onChange={e => setContextFilter(e.target.value)}><option value="">Все контексты (без общей линии)</option>{contexts.filter(Boolean).map(c => <option key={c}>{c}</option>)}</select></Field></div>
    {type === 'custom' && <div className="physis-custom-toolbar">{customMetric && <div className="physis-custom-choice"><HealthIcon name={customMetric.icon} /><Field label="Мои показатели"><select value={customMetric.id} onChange={event => { setCustomId(event.target.value); setContextFilter(''); }}>{definitions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field></div>}<div className="physis-actions">{customMetric && <><IconActionButton icon="gear" label={text('Изменить показатель')} aria-haspopup="dialog" onClick={() => setEditingMetric(customMetric)} /><IconActionButton icon="trash" label={text('Удалить показатель')} disabled={action.busy} onClick={() => {
      if (!confirm(text('Удалить показатель из списка? История измерений сохранится в аккаунте.'))) return;
      void action.run(async () => {
        const current = physisRecords<PhysisSettings>(store, 'settings')[0];
        const customMetrics = allDefinitions.map(item => item.id === customMetric.id ? { ...item, deleted: true } : item);
        await store.save(current ? editPhysisRecord(current, { ...current.data, customMetrics }) : newPhysisRecord('settings', { ...settings, customMetrics }));
        setCustomId(''); setDraft(null);
      });
    }} /></>}<button type="button" className="physis-primary" onClick={() => setEditingMetric('new')}>Добавить показатель</button></div></div>}

    {action.error ? <p role="alert" className="physis-warning">{action.error}</p> : null}
    {draft ? <form key={draft.id} className="physis-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await store.save(editPhysisRecord(draft, { ...draft.data, editedAt: records.some(r => r.id === draft.id) ? new Date().toISOString() : null })); setDraft(current => current === draft ? null : current); }); }}>
      <h3 className="physis-wide">{draft.data.type === 'custom' ? draft.data.label : metricName(draft.data.type)}</h3>

      <NumberField label={draft.data.type === 'pressure' ? 'Систолическое, мм рт. ст.' : 'Значение'} required value={draft.data.value} min={draft.data.type === 'custom' ? -1e6 : draft.data.type === 'temperature' ? -50 : 0} onChange={v => change({ value: v ?? 0 })} />
      {draft.data.type === 'pressure' ? <><NumberField label="Диастолическое, мм рт. ст." required value={draft.data.secondValue} onChange={secondValue => change({ secondValue })} /><NumberField label="Пульс (необязательно), уд/мин" value={draft.data.pulse} onChange={pulse => change({ pulse })} /><Field label="Рука"><select value={draft.data.arm} onChange={e => change({ arm: e.target.value })}><option value="">Не указана</option><option>Левая</option><option>Правая</option></select></Field><Field label="Положение"><select value={draft.data.position} onChange={e => change({ position: e.target.value })}><option value="">Не указано</option><option>Сидя</option><option>Лёжа</option><option>Стоя</option></select></Field></> : null}
      {draft.data.type === 'glucose' ? <><Field label="Исходная единица"><select value={draft.data.unit} onChange={e => change({ unit: e.target.value })}><option value="mmol/L">ммоль/л</option><option value="mg/dL">мг/дл</option></select></Field><Field label="Контекст сахара"><select value={draft.data.context} onChange={e => change({ context: e.target.value })}><option value="">Не указан</option><option>Натощак</option><option>До еды</option><option>После еды</option></select></Field><NumberField label="Минут после еды" value={draft.data.intervalMinutes} onChange={intervalMinutes => change({ intervalMinutes })} /><Field label="Источник"><select value={draft.data.source} onChange={e => change({ source: e.target.value })}><option>Вручную</option><option>Глюкометр</option><option>Лаборатория</option><option>CGM</option></select></Field></> : <><Field label="Единица">{draft.data.type === 'custom' ? <input required value={draft.data.unit} onChange={e => change({ unit: e.target.value })} /> : <select value={draft.data.unit} onChange={e => change({ unit: e.target.value })}>{measurementUnits(draft.data.type).map(unit => <option key={unit}>{unit}</option>)}</select>}</Field><Field label="Контекст"><input value={draft.data.context} onChange={e => change({ context: e.target.value })} placeholder="Например, после пробуждения" /></Field><Field label="Источник"><input value={draft.data.source} onChange={e => change({ source: e.target.value })} /></Field></>}
      <PhysisMomentFields value={draft.data.timestamp} fallbackDay={draft.data.day} timeZone={draft.data.timeZone} context={context} calendarMode={settings.inputCalendarMode} dayLabel="День измерения" timeLabel="Время измерения" onChange={(timestamp, day) => change({ timestamp, day })} />
      <Field label="Устройство"><input value={draft.data.device} onChange={e => change({ device: e.target.value })} /></Field><Field label="Заметка"><textarea value={draft.data.note} onChange={e => change({ note: e.target.value })} /></Field>
      {draft.data.type === 'custom' ? <Field label="Тип шкалы"><select value={draft.data.scale} onChange={e => change({ scale: e.target.value as Measurement['scale'] })}><option value="numeric">Числовая</option><option value="subjective">Субъективная</option></select></Field> : null}
      <div className="physis-wide"><label className="physis-check"><input type="checkbox" checked={draft.data.target !== null} onChange={e => change({ target: e.target.checked ? { min: 0, max: 0, source: '' } : null })} />Указать личный целевой диапазон</label>{draft.data.target ? <div className="physis-form"><NumberField label="Нижняя граница" value={draft.data.target.min} onChange={v => change({ target: { ...draft.data.target!, min: v ?? 0 } })} /><NumberField label="Верхняя граница" value={draft.data.target.max} onChange={v => change({ target: { ...draft.data.target!, max: v ?? 0 } })} /><Field label="Источник диапазона"><input required value={draft.data.target.source} onChange={e => change({ target: { ...draft.data.target!, source: e.target.value } })} /></Field></div> : null}</div>
      <div className="physis-actions"><button className="physis-primary" disabled={action.busy}>Сохранить измерение</button><button type="button" onClick={() => setDraft(null)}>Отмена</button></div>
    </form> : null}
    {!history.length ? <p className="physis-empty">За этот период измерений нет. Добавьте первое.</p> : <>
      {chartAllowed ? <figure><figcaption>{type === 'custom' ? customMetric?.name : metricName(type)} · {history.length} отдельных измерений · {unit(history[0].data)} · {history[0].data.context || 'Контекст не указан'}</figcaption><svg className="physis-chart" viewBox="0 0 600 160" role="img" aria-label={`График ${metricName(type)}: от ${lo.toFixed(2)} до ${hi.toFixed(2)}. Точные значения в таблице ниже.`}><polyline points={points} /></svg></figure> : <p className="physis-muted">Выберите один контекст и совместимые единицы для графика. Разные контексты не объединяются.</p>}
      <div className="physis-table-wrap"><table><caption>История измерений — каждое измерение отдельно</caption><thead><tr><th>Дата</th><th>Значение</th><th>Контекст и источник</th><th>Действия</th></tr></thead><tbody>{[...history].reverse().map(r => <tr key={r.id}><td>{formatCalendarDateValue(r.data.day, settings.calendarMode, false, context)}<br />{new Date(r.data.timestamp).toLocaleTimeString('ru', { timeZone: r.data.timeZone, hour: '2-digit', minute: '2-digit' })}{r.data.editedAt ? ' · Исправлено' : ''}</td><td>{value(r.data).toLocaleString('ru', { maximumFractionDigits: 2 })}{r.data.type === 'pressure' ? ` / ${r.data.secondValue}` : ''} {unit(r.data)}{r.data.pulse !== null ? ` · пульс ${r.data.pulse}` : ''}{r.data.unit !== unit(r.data) ? <small> (исходно {r.data.value} {r.data.unit})</small> : null}</td><td>{r.data.context || 'Не указан'} {r.data.intervalMinutes !== null ? ` · ${r.data.intervalMinutes} мин` : ''}<br />{r.data.source} · {r.data.device}{r.data.target ? <p>Личный диапазон: {r.data.target.min}–{r.data.target.max} {r.data.unit}, источник: {r.data.target.source}</p> : null}</td><td><button onClick={() => setDraft(structuredClone(r))}>Изменить</button><button onClick={() => { if (confirm('Удалить измерение?')) void action.run(() => store.remove(r.id)); }}>Удалить</button></td></tr>)}</tbody></table></div></>}
    <details className="physis-measurement-help"><summary>Об измерениях</summary><p className="physis-muted">Фюзис не измеряет показатели браузером и не ставит диагнозы. Перевод глюкозы использует коэффициент 18,0182 мг/дл на ммоль/л; исходное значение сохраняется.</p></details>
  </section>{editingMetric && <MetricDefinitionDialog key={editingMetric === 'new' ? 'new' : editingMetric.id} definition={editingMetric === 'new' ? undefined : editingMetric} language={language} onClose={() => setEditingMetric(null)} onSave={async next => {
    if (definitions.some(item => item.id !== next.id && item.name.trim().toLocaleLowerCase() === next.name.toLocaleLowerCase())) throw new Error(text('Показатель с таким названием уже есть.'));
    const current = physisRecords<PhysisSettings>(store, 'settings')[0];
    const customMetrics = allDefinitions.some(item => item.id === next.id) ? allDefinitions.map(item => item.id === next.id ? next : item) : [...allDefinitions, next];
    await store.save(current ? editPhysisRecord(current, { ...current.data, customMetrics }) : newPhysisRecord('settings', { ...settings, customMetrics }));
    setCustomId(next.id);
  }} />}</div>;
}
