import { useId, useState } from 'react';
import { DialogCloseButton } from '../DialogCloseButton';
import { IconActionButton } from '../IconActionButton';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { Field, usePhysisAction } from './fields';
import { HealthIcon, healthIconLabel } from './health-icons';
import { HEALTH_ICON_NAMES } from './health-icon-names';
import { validCustomMetrics, type CustomMetricDefinition } from './custom-metric-domain';

export function MetricDefinitionDialog({ definition, language, onSave, onClose }: {
  definition?: CustomMetricDefinition; language: string; onSave: (value: CustomMetricDefinition) => Promise<void>; onClose: () => void;
}) {
  const en = language !== 'ru'; const t = (ru: string, english: string) => en ? english : ru;
  const [draft, setDraft] = useState<CustomMetricDefinition>(() => definition ? { ...definition } : {
    id: crypto.randomUUID(), name: '', unit: '', scale: 'numeric', icon: 'sliders-horizontal',
  });
  const action = usePhysisAction(); const titleId = useId();
  const close = () => { if (!action.busy) onClose(); };
  const ref = useDialogAccessibility<HTMLElement>(close);
  return <div className="modal-backdrop physis-settings-backdrop"><section ref={ref} className="modal physis-settings-dialog physis-metric-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="physis-settings-heading"><h2 id={titleId}>{definition ? t('Изменить показатель', 'Edit metric') : t('Новый показатель', 'New metric')}</h2><DialogCloseButton aria-label={t('Закрыть', 'Close')} onClick={close} disabled={action.busy} /></header>
    <form className="physis-settings-content" onSubmit={event => { event.preventDefault(); void action.run(async () => {
      const next = { ...draft, name: draft.name.trim(), unit: draft.unit.trim() };
      if (!validCustomMetrics([next])) throw new Error(t('Проверьте название, единицу и иконку показателя.', 'Check the metric name, unit and icon.'));
      await onSave(next); onClose();
    }); }}>
      <div className="physis-form"><Field label={t('Название показателя', 'Metric name')}><input required maxLength={200} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label={t('Единица измерения', 'Measurement unit')}><input required maxLength={60} placeholder={t('см, кг, %, балл', 'cm, kg, %, score')} value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })} /></Field>
        <Field label={t('Тип шкалы', 'Scale type')}><select value={draft.scale} onChange={event => setDraft({ ...draft, scale: event.target.value as CustomMetricDefinition['scale'] })}><option value="numeric">{t('Числовая', 'Numeric')}</option><option value="subjective">{t('Субъективная', 'Subjective')}</option></select></Field>
      </div>
      <fieldset className="physis-metric-icons"><legend>{t('Иконка показателя', 'Metric icon')}</legend><p className="physis-muted">{healthIconLabel(draft.icon, language)}</p><div className="physis-metric-icon-grid">{HEALTH_ICON_NAMES.map(name => <IconActionButton key={name} icon={<HealthIcon name={name} />} label={healthIconLabel(name, language)} aria-pressed={draft.icon === name} onClick={() => setDraft({ ...draft, icon: name })} />)}</div></fieldset>
      <p className="physis-muted">{t('Изменение названия, единицы или иконки не пересчитывает и не переименовывает прошлые измерения.', 'Changing the name, unit or icon does not recalculate or rename past measurements.')}</p>
      {action.error && <p role="alert" className="physis-warning">{action.error}</p>}
      <div className="physis-actions"><button className="physis-primary" disabled={action.busy}>{t('Сохранить показатель', 'Save metric')}</button><button type="button" onClick={close} disabled={action.busy}>{t('Отмена', 'Cancel')}</button></div>
      <details className="physis-metric-license"><summary>{t('Иконки Lucide · ISC', 'Lucide icons · ISC')}</summary><p><a href="https://lucide.dev/" target="_blank" rel="noreferrer">Lucide</a> · <a href="https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE" target="_blank" rel="noreferrer">ISC License</a>. {t('Бесплатное использование, включая коммерческое. Копия лицензии и сведения об авторах сохранены в проекте.', 'Free to use, including commercially. The license and author notices are included in the project.')}</p></details>
    </form>
  </section></div>;
}
