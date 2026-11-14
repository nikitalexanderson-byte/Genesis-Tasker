"use client";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import webHeaderCopy from './web-header-copy.json';
import { LOCAL_SESSION_ENDED_EVENT, PERSONAL_DOCUMENT_READY_EVENT, captureAccountSessionGuard, personalDocumentAccess, physisRequest } from '../cloud-sync';
import { calendarContext } from '../calendar-context';
import type { CalendarMode } from '../calendar-data';
import { IconActionButton } from '../IconActionButton';
import { DialogCloseButton } from '../DialogCloseButton';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { translateText, type Language } from '../i18n';
import { openPhysisAccount, type VaultState } from './account-session';
import { PhysisMemoryStore } from './store';
import { editPhysisRecord, newPhysisRecord, physisRecords, type PhysisFeatureProps, type PhysisSettings } from './types';
import { METRICS, type Measurement } from './care-domain';
import { customMetricDefinitions } from './custom-metric-domain';
import { PhysisDrugCatalog, PhysisIntakes } from './care';
import { useReferenceCatalog } from './reference-catalog-store';
import { PhysisMeasurements } from './measurements';
import { PhysisTraining } from './training';
import { PhysisDailyContext } from './daily-context';
import { PhysisNutrition } from './nutrition';
import { PhysisPersonalProfile } from './personal-profile';
import { HealthIcon } from './health-icons';
import type { HealthIconName } from './health-icon-names';
import type { NutritionProfile } from './nutrition-domain';
import { ExerciseModelProvider } from './exercise-media';
import { PhysisExchange, downloadPhysis } from './exchange';
import { Field, NumberField, usePhysisAction } from './fields';
import './physis.css';

type PageName = 'overview' | 'today' | 'programs' | 'control' | 'exercises' | 'diary' | 'foods' | 'intakes' | 'drugs';
type KeyState = { key: CryptoKey; model: PhysisMemoryStore };
type Props = { owner: string; language: string; calendarMode: CalendarMode; inputCalendarMode: CalendarMode; timeZone: string; settingsRequest?: number; weekStart?: 'sunday' | 'monday'; webHeaderEnabled?: boolean; webHeaderTarget?: HTMLElement | null };
type Area = 'training' | 'nutrition' | 'care' | 'monitoring';
const GROUPS: { id: Area; title: string; subtitle: string; icon: HealthIconName; pages: [PageName, string][] }[] = [
  { id: 'training', title: 'Тренировки', subtitle: 'Контроль и программы', icon: 'dumbbell', pages: [['control', 'Контроль выполнения'], ['exercises', 'Справочник упражнений']] },
  { id: 'nutrition', title: 'Питание', subtitle: 'Рацион и продукты', icon: 'apple', pages: [['diary', 'Рацион'], ['foods', 'Список продуктов']] },
  { id: 'care', title: 'БАДы и лекарства', subtitle: 'Схемы и приёмы', icon: 'pill', pages: [['intakes', 'Контроль приема'], ['drugs', 'Справочник']] },
  { id: 'monitoring', title: 'Мониторинг показателей', subtitle: 'Измерения и история', icon: 'heart-pulse', pages: [] },
];

function PhysisHero({ language, onSettings, onPersonal, status, area }: { language: string; onSettings?: () => void; onPersonal?: () => void; status?: string; area?: Area }) {
  const copy = webHeaderCopy[language as keyof typeof webHeaderCopy] ?? webHeaderCopy.en;
  const index = GROUPS.findIndex(item => item.id === area);
  return <header className="physis-hero">
    <div className="physis-hero-copy">{index >= 0 ? <><h1 id="physis-title" data-no-translate>{copy.title} <span className="workspace-title-secondary">- {copy.tabs[index]}</span></h1><p data-no-translate>{copy.descriptions[index]}</p></> : <><h1 id="physis-title">Фюзис</h1><p>Тренировки, дневник питания, БАДы и лекарства.</p></>}</div>
    <div className="physis-hero-actions">
      {onPersonal ? <IconActionButton icon="account" label={language === 'ru' ? 'Личные данные' : 'Personal details'} className="physis-settings-button" aria-haspopup="dialog" onClick={onPersonal} /> : null}
      {onSettings ? <IconActionButton icon="gear" label={translateText('Настройки Фюзиса', language as Language)} className="physis-settings-button" aria-haspopup="dialog" onClick={onSettings} /> : null}
      {status ? <p className="physis-status" role="status" aria-live="polite">{status}</p> : null}
    </div>
  </header>;
}
export const defaultPhysisSettings = (props: Pick<Props, 'calendarMode' | 'inputCalendarMode' | 'timeZone'>): PhysisSettings => ({
  calendarMode: props.calendarMode, inputCalendarMode: props.inputCalendarMode, timeZone: props.timeZone,
  weightUnit: 'kg', distanceUnit: 'km', energyUnit: 'kcal', glucoseUnit: 'mmol/L', restSeconds: 90, reminders: true,
  foodRules: ['soy', 'legumes', 'seed-oils'], enabledMetrics: ['weight', 'resting-pulse'], monitoringHints: true, overviewBlocks: ['workout', 'nutrition', 'intakes', 'measurements'],
});
export function PhysisPage(props: Props) {
  const [vaultState, setVaultState] = useState<VaultState | null>(null); const [keys, setKeys] = useState<KeyState | null>(null);
  const [method, setMethod] = useState<'password' | 'recovery'>('password'); const [secret, setSecret] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const keyRef = useRef<KeyState | null>(null); const generation = useRef(0); const pending = useRef(false);
  const open = useCallback(async (legacy?: { secret: string; method: 'password' | 'recovery' }) => {
    if (pending.current || keyRef.current) return;
    const epoch = generation.current; const active = captureAccountSessionGuard();
    const check = () => { active(); if (epoch !== generation.current) throw new Error('PHYSIS_SESSION_ENDED'); };
    pending.current = true; setBusy(true); setError('');
    let model: PhysisMemoryStore | undefined;
    try {
      const access = personalDocumentAccess(props.owner); access.check();
      const result = await openPhysisAccount(props.owner, access, physisRequest, check, legacy); check();
      setVaultState(result.state);
      if (result.key) {
        model = new PhysisMemoryStore(props.owner, result.key, result.state.vault!.keyVersion);
        await model.reload(); check();
        keyRef.current = { key: result.key, model }; setKeys(keyRef.current); setSecret('');
      }
    } catch (failure) {
      model?.destroy();
      if (epoch === generation.current) setError(failure instanceof Error ? failure.message : 'Не удалось открыть Фюзис.');
    } finally {
      if (epoch === generation.current) { pending.current = false; setBusy(false); }
    }
  }, [props.owner]);
  useEffect(() => {
    const end = () => { generation.current++; pending.current = false; keyRef.current?.model.destroy(); keyRef.current = null; setKeys(null); setVaultState(null); setSecret(''); };
    const retry = () => { void open(); };
    void open();
    window.addEventListener(LOCAL_SESSION_ENDED_EVENT, end);
    window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT, retry);
    window.addEventListener('online', retry);
    return () => { end(); window.removeEventListener(LOCAL_SESSION_ENDED_EVENT, end); window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT, retry); window.removeEventListener('online', retry); };
  }, [open]);
  return <div className="physis" data-physis-private="true">
    {keys ? <UnlockedPhysis {...props} keys={keys} vaultState={vaultState!} /> : <><PhysisHero language={props.language} /><section className="physis-panel physis-lock">
      {vaultState?.vault?.version === 1 ? <><h2>Перенести сохранённые данные</h2><p>Эти записи были сохранены со старым паролем Фюзиса. Введите его один раз, чтобы подключить их к общему аккаунту. После переноса Фюзис будет открываться вместе с сайтом.</p>
        <form className="physis-form" onSubmit={e => { e.preventDefault(); void open({ secret, method }); }}>
          <div className="physis-tabs"><button type="button" aria-pressed={method === 'password'} onClick={() => { setMethod('password'); setSecret(''); }}>Прежний пароль</button><button type="button" aria-pressed={method === 'recovery'} onClick={() => { setMethod('recovery'); setSecret(''); }}>Код восстановления</button></div>
          <Field label={method === 'password' ? 'Прежний пароль Фюзиса' : 'Код восстановления PHY1-…'}><input type="password" required maxLength={1024} autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)} /></Field>
          <button className="physis-primary" disabled={busy}>{busy ? 'Переносим…' : 'Подключить данные к аккаунту'}</button>
        </form></> : <p role="status">{busy ? 'Открываем Фюзис…' : 'Фюзис открывается вместе с вашим аккаунтом GENESIS.'}</p>}
      {error ? <div role="alert" className="physis-warning"><p>{error}</p><button disabled={busy} onClick={() => void open()}>Повторить</button></div> : null}
    </section></>}
  </div>;
}

function UnlockedPhysis(props: Props & { keys: KeyState; vaultState: VaultState }) {
  const webCopy = webHeaderCopy[props.language as keyof typeof webHeaderCopy] ?? webHeaderCopy.en;
  const referenceCatalog = useReferenceCatalog(props.owner);
  const { keys: { model }, vaultState } = props;
  const store = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [area, setArea] = useState<Area>('training');
  const [pages, setPages] = useState<Record<Area, PageName>>({ training: 'control', nutrition: 'diary', care: 'intakes', monitoring: 'overview' });
  const [settingsOpen, setSettingsOpen] = useState(Boolean(props.settingsRequest));
  const [personalOpen, setPersonalOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(0);
  useEffect(() => { if (!settingsSaved) return; const timer = setTimeout(() => setSettingsSaved(0), 2300); return () => clearTimeout(timer); }, [settingsSaved]);
  const page = pages[area]; const group = GROUPS.find(item => item.id === area) ?? { title: 'Мониторинг показателей', pages: [] };
  const setPage = (next: PageName) => setPages(current => ({ ...current, [area]: next }));
  const openIntakes = () => { setArea('care'); setPages(current => ({ ...current, care: 'intakes' })); };
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now()); const action = usePhysisAction();
  const settingsRecord = physisRecords<PhysisSettings>(store, 'settings')[0];
  const settings = { ...(settingsRecord?.data ?? defaultPhysisSettings(props)), calendarMode: props.calendarMode }; const context = calendarContext({ timeZone: settings.timeZone });
  const feature: PhysisFeatureProps = { store, settings, context, language: props.language, weekStart: props.weekStart, referenceCatalog };
  const personalRecord = physisRecords<NutritionProfile>(store, 'nutrition-profile')[0];
  const personalProfile = personalRecord?.data;
  useEffect(() => {
    if (!props.settingsRequest) return;
    const frame = requestAnimationFrame(() => setSettingsOpen(true)); return () => cancelAnimationFrame(frame);
  }, [props.settingsRequest]);
  useEffect(() => {
    const retry = () => { if (model.hasPending) void model.flush().catch(() => undefined); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (model.hasPending || model.rotationPending) { event.preventDefault(); event.returnValue = ''; } };
    const timer = setInterval(() => { setNow(Date.now()); if (navigator.onLine) retry(); }, 15000);
    window.addEventListener('online', retry); window.addEventListener('beforeunload', beforeUnload);
    return () => { clearInterval(timer); window.removeEventListener('online', retry); window.removeEventListener('beforeunload', beforeUnload); };
  }, [model]);
  const exportEncrypted = async () => {
    const records = await model.exportWire();
    downloadPhysis('physis-encrypted.json', JSON.stringify({ format: 'physis-encrypted', version: 1, owner: props.owner, exportedAt: new Date().toISOString(), vault: vaultState.vault, records }));
  };
  return <>
    <PhysisHero language={props.language} area={props.webHeaderEnabled ? area : undefined} onSettings={() => setSettingsOpen(true)} onPersonal={() => setPersonalOpen(true)} status={({ saved: '', saving: 'Сохраняется…', offline: 'Не сохранено — нет связи', conflict: 'Конфликт устройств', error: 'Не сохранено — ошибка' })[store.status]} />
    <div className="habit-workspace-frame physis-workspace-frame">
    {props.webHeaderEnabled ? props.webHeaderTarget && createPortal(<nav className="header-section-switch habit-header-tabs physis-header-tabs" aria-label={webCopy.title} data-no-translate>{GROUPS.map((item, index) => <button type="button" key={item.id} data-physis-area={item.id} aria-label={webCopy.tabs[index]} title={webCopy.tabs[index]} aria-pressed={area === item.id} onClick={() => setArea(item.id)}><HealthIcon name={item.icon} /><strong>{webCopy.tabs[index]}</strong></button>)}</nav>, props.webHeaderTarget) : <nav className="experimental-habit-tabs physis-area-switch" aria-label="Разделы Фюзиса">{GROUPS.map(item => <button type="button" key={item.id} aria-label={translateText(item.title, props.language as Language)} data-tooltip={translateText(item.title, props.language as Language)} aria-current={area === item.id ? 'page' : undefined} onClick={() => setArea(item.id)}><span className="physis-area-icon"><HealthIcon name={item.icon} /></span><strong className="physis-area-label">{item.title}</strong><small className="physis-area-subtitle">{item.subtitle}</small></button>)}</nav>}

    {store.error ? <div role="alert" className="physis-warning"><p>{store.error}</p><div className="physis-actions"><button onClick={() => void action.run(() => model.flush())}>Повторить сохранение</button><button onClick={() => { if (confirm('Открытый файл содержит личные данные. Экспортировать локальный вариант?')) downloadPhysis('physis-unsaved.json', JSON.stringify({ format: 'physis-plain', version: 1, records: store.records })); }}>Экспортировать локальный вариант</button><button onClick={() => { if (confirm('Отменить все несохранённые изменения этой вкладки и загрузить серверный вариант?')) void action.run(async () => { await model.discardAndReload(); setEditorEpoch(value => value + 1); }); }}>Загрузить серверный вариант</button></div></div> : null}
    {action.error ? <p role="alert" className="physis-warning">{action.error}</p> : null}
    <Fragment key={editorEpoch}>
    <div className="habit-workspace-panel physis-workspace-panel">
    <div className={group.pages.length ? 'physis-section-frame' : 'physis-section-plain'} data-tabs={group.pages.length || undefined}>
    {group.pages.length ? <nav className="physis-tabs physis-subnav" aria-label={translateText(group.title, props.language as Language)}>{group.pages.map(([id, name]) => <button type="button" key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>{name}</button>)}</nav> : null}
    <section className="physis-page-content" aria-label={translateText(group.title, props.language as Language)}>
    {area === 'training' && (page === 'today' || page === 'programs' || page === 'control' || page === 'exercises') ? <ExerciseModelProvider sex={personalProfile?.personal ? personalProfile.formulaSex : undefined}><PhysisTraining key={page} {...feature} page={page} dailyContext={<PhysisDailyContext {...feature} now={now} onNutrition={() => { setArea('nutrition'); setPages(current => ({ ...current, nutrition: 'diary' })); }} onIntakes={openIntakes} onMeasurements={() => setArea('monitoring')} />} /></ExerciseModelProvider> : null}
    {area === 'nutrition' && (page === 'today' || page === 'diary' || page === 'foods') ? <PhysisNutrition {...feature} page={page} /> : null}
    {area === 'care' && page === 'overview' ? settings.overviewBlocks.includes('intakes') ? <PhysisIntakes {...feature} owner={props.owner} onOpenCatalog={() => setPage('drugs')} compact /> : <p className="physis-muted">Блок обзора выключен в настройках.</p> : null}
    {area === 'monitoring' ? <PhysisMeasurements key={settings.enabledMetrics.join(':')} {...feature} hintOwner={props.owner} onDisableHints={() => { void action.run(() => store.save(settingsRecord ? editPhysisRecord(settingsRecord, { ...settings, monitoringHints: false }) : newPhysisRecord('settings', { ...settings, monitoringHints: false }))); }} /> : null}
    {page === 'drugs' ? <PhysisDrugCatalog {...feature} /> : null}
    {page === 'intakes' ? <PhysisIntakes {...feature} owner={props.owner} onOpenCatalog={() => setPage('drugs')} /> : null}
    </section>
    </div>
    </div>
    </Fragment>
    </div>
    {personalOpen && <PhysisPersonalProfile {...feature} onClose={() => setPersonalOpen(false)} />}
    <PhysisSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} language={props.language}>
      <PhysisSettingsForm onSaved={() => setSettingsSaved(Date.now())} key={settingsRecord?.updatedAt ?? 'general-settings'} {...feature} /><section className="physis-panel"><h2>Данные и резервные копии</h2><p>Фюзис использует ваш общий аккаунт GENESIS. Данные сохраняются в зашифрованном виде и доступны после входа на сайт. Зашифрованная копия открывается в том же аккаунте.</p><PhysisExchange store={store} exportEncrypted={exportEncrypted} /><p className="physis-muted">Удалённое содержимое убирается из активного хранилища. Журнал удалений и повторных запросов: 90 дней; минимальный реестр использованных ID сохраняется для защиты от восстановления старыми устройствами. Время удаления из резервных копий зависит от политики хранения оператора.</p></section><section className="physis-panel"><h2>Будущие подключения</h2><ul><li>Google Health API — планируется</li><li>Health Connect — планируется через отдельный Android-клиент</li><li>HealthKit — планируется через Apple-клиент</li><li>Garmin и Health Services — планируется</li></ul><p>Ни одно подключение не включено. Сейчас работают ручной учет и импорт/экспорт; данные не отправляются этим поставщикам.</p></section>
      {settingsSaved > 0 && <div className="physis-save-toast" role="status" aria-live="polite">Настройки сохранены</div>}
    </PhysisSettingsDialog>
  </>;
}

function PhysisSettingsDialog({ open, onClose, language, children }: { open: boolean; onClose: () => void; language: string; children: ReactNode }) {
  const ref = useDialogAccessibility<HTMLElement>(onClose, open);
  return <div className="modal-backdrop physis-settings-backdrop" hidden={!open}>
    <section ref={ref} className="physis-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="physis-settings-title" tabIndex={-1}>
      <header className="physis-settings-heading"><h2 id="physis-settings-title">Настройки Фюзиса</h2><DialogCloseButton aria-label={translateText('Закрыть', language as Language)} onClick={onClose} /></header>
      <div className="physis-settings-content">{children}</div>
    </section>
  </div>;
}

function PhysisSettingsForm({ store, settings, onSaved }: PhysisFeatureProps & { onSaved: () => void }) {
  const [draft, setDraft] = useState(settings); const action = usePhysisAction();
  const change = (patch: Partial<PhysisSettings>) => setDraft(s => ({ ...s, ...patch }));
  const customDefinitions = customMetricDefinitions(draft, physisRecords<Measurement>(store, 'measurement').map(record => record.data));
  const calendarOptions = <><option value="profane">Григорианский</option><option value="sacred">Сакральный</option><option value="lunar">Лунный</option></>;
  return <section className="physis-panel"><h3>Общие настройки</h3><form className="physis-form" onSubmit={e => { e.preventDefault(); void action.run(async () => {
    const record = physisRecords<PhysisSettings>(store, 'settings')[0]; await store.save(record ? editPhysisRecord(record, draft) : newPhysisRecord('settings', draft)); onSaved();
  }); }}>
    <Field label="Календарь ввода"><select value={draft.inputCalendarMode} onChange={e => change({ inputCalendarMode: e.target.value as CalendarMode })}>{calendarOptions}</select></Field><Field label="Часовой пояс IANA"><input required value={draft.timeZone} onChange={e => change({ timeZone: e.target.value })} /></Field>
    <Field label="Масса"><select value={draft.weightUnit} onChange={e => change({ weightUnit: e.target.value as 'kg' })}><option value="kg">кг</option><option value="lb">фунты</option></select></Field><Field label="Расстояние"><select value={draft.distanceUnit} onChange={e => change({ distanceUnit: e.target.value as 'km' })}><option value="km">км</option><option value="mi">мили</option></select></Field><Field label="Энергия"><select value={draft.energyUnit} onChange={e => change({ energyUnit: e.target.value as 'kcal' })}><option value="kcal">ккал</option><option value="kJ">кДж</option></select></Field><Field label="Глюкоза"><select value={draft.glucoseUnit} onChange={e => change({ glucoseUnit: e.target.value as 'mmol/L' })}><option value="mmol/L">ммоль/л</option><option value="mg/dL">мг/дл</option></select></Field>
    <NumberField label="Отдых между подходами, секунд" min={0} max={3600} value={draft.restSeconds} onChange={v => change({ restSeconds: v ?? 0 })} />
    <label className="physis-check physis-wide"><input type="checkbox" checked={draft.monitoringHints !== false} onChange={e => change({ monitoringHints: e.target.checked })} />Периодические подсказки в мониторинге показателей</label>
    <div className="physis-wide"><h3>Включенные показатели</h3><p className="physis-muted">Переключатели независимы. Выключение скрывает инструмент и сохраняет всю историю.</p><div className="physis-grid">{METRICS.map(([id, title]) => <label className="physis-check" key={id}><input type="checkbox" checked={draft.enabledMetrics.includes(id)} onChange={e => change({ enabledMetrics: e.target.checked ? [...draft.enabledMetrics, id] : draft.enabledMetrics.filter(k => k !== id) })} />{title}</label>)}</div></div>
    {customDefinitions.some(item => !item.deleted) && <fieldset className="physis-wide"><legend>Мои показатели — отображение</legend><p className="physis-muted">Показатели этого аккаунта. Снятая отметка скрывает показатель и сохраняет его историю.</p><div className="physis-grid">{customDefinitions.filter(item => !item.deleted).map(item => <label className="physis-check" key={item.id}><input type="checkbox" checked={!item.hidden} onChange={event => change({ customMetrics: customDefinitions.map(metric => metric.id === item.id ? { ...metric, hidden: !event.target.checked } : metric), ...(event.target.checked && !draft.enabledMetrics.includes('custom') ? { enabledMetrics: [...draft.enabledMetrics, 'custom'] } : {}) })} />{item.name} · {item.unit}</label>)}</div></fieldset>}
    <div className="physis-wide"><h3>Обзор</h3>{[['intakes', 'Ближайшие приемы']].map(([id, title]) => <label key={id} className="physis-check"><input type="checkbox" checked={draft.overviewBlocks.includes(id)} onChange={e => change({ overviewBlocks: e.target.checked ? [...draft.overviewBlocks, id] : draft.overviewBlocks.filter(k => k !== id) })} />{title}</label>)}</div>
    <label className="physis-check physis-wide"><input type="checkbox" checked={draft.reminders} onChange={e => change({ reminders: e.target.checked })} />Внутренние напоминания о приёмах</label>
    <p className="physis-wide physis-muted">Изменение timezone не переносит прошлые факты. Плановые дни — даты без времени; факты сохраняют момент, timezone и исторический локальный день. Внешние уведомления и offline cache не включены.</p>
    <div className="physis-actions"><button className="physis-primary" disabled={action.busy}>Сохранить настройки</button></div>{action.error ? <p role="alert" className="physis-warning">{action.error}</p> : null}
  </form></section>;
}
