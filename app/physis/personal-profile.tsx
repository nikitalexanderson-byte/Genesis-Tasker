'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { DialogCloseButton } from '../DialogCloseButton';
import { useDialogAccessibility } from '../use-dialog-accessibility';
import { usePhysisAction } from './fields';
import { validateNutritionRecord, type NutritionProfile } from './nutrition-domain';
import { ACTIVITY_LEVELS, FITNESS_GOALS, applyPersonalProfile, defaultNutritionProfile, personalProfileDraft } from './personal-profile-domain';
import { editPhysisRecord, newPhysisRecord, physisRecords, type PhysisFeatureProps } from './types';
import { NutritionSettings, type NutritionSettingsHandle } from './nutrition';
import './personal-profile.css';

export function PhysisPersonalProfile({ onClose, ...props }: PhysisFeatureProps & { onClose: () => void }) {
  const { store, language } = props;
  const nutritionEditor = useRef<NutritionSettingsHandle>(null);
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  const titleId = useId(); const ref = useDialogAccessibility<HTMLElement>(onClose);
  const record = physisRecords<NutritionProfile>(store, 'nutrition-profile')[0];
  const [draft, setDraft] = useState(() => personalProfileDraft(record?.data));
  const [newRecord] = useState(() => newPhysisRecord('nutrition-profile', defaultNutritionProfile()));
  const action = usePhysisAction(); const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(false), 2300); return () => clearTimeout(timer); }, [saved]);
  const change = (patch: Partial<typeof draft>) => { setSaved(false); setDraft(current => ({ ...current, ...patch })); };
  return <div className="modal-backdrop physis-settings-backdrop">
    <section ref={ref} className="physis-settings-dialog physis-personal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="physis-settings-heading"><h2 id={titleId}>{t('Личные данные', 'Personal details')}</h2><DialogCloseButton aria-label={t('Закрыть личные данные', 'Close personal details')} onClick={onClose} /></header>
      <form className="physis-form physis-personal-form" onSubmit={event => { event.preventDefault(); void action.run(async () => {
        const current = record ?? newRecord;
        const nextData = nutritionEditor.current?.resolve() ?? applyPersonalProfile(current.data, draft);
        const next = editPhysisRecord(current, nextData);
        if (!validateNutritionRecord(next)) throw new Error(t('Проверьте данные профиля.', 'Check profile details.'));
        await store.save(next); setSaved(true);
      }); }}>
        <p className="physis-muted">{t('Общий профиль Фюзиса для питания и тренировок. В упражнениях будет показана модель выбранного пола.', 'Your shared Physis profile for nutrition and training. Exercise demonstrations use the selected sex.')}</p>
        <fieldset><legend>{t('Параметры тела', 'Body details')}</legend><div className="physis-personal-fields">
          <label>{t('Пол', 'Sex')}<select required value={draft.sex} onChange={event => change({ sex: event.target.value as typeof draft.sex })}><option value="" disabled>{t('Выберите пол', 'Select sex')}</option><option value="male">{t('Мужской', 'Male')}</option><option value="female">{t('Женский', 'Female')}</option></select></label>
          {(['age', 'heightCm', 'weightKg'] as const).map((key, index) => <label key={key}>{t(['Возраст, лет', 'Рост, см', 'Вес, кг'][index], ['Age, years', 'Height, cm', 'Weight, kg'][index])}<input required inputMode={key === 'age' ? 'numeric' : 'decimal'} value={draft[key]} onChange={event => change({ [key]: event.target.value })} maxLength={8} /></label>)}
        </div></fieldset>
        <fieldset><legend>{t('Активность и цель', 'Activity and goal')}</legend><div className="physis-personal-fields">
          <label>{t('Уровень активности', 'Activity level')}<select value={draft.activityLevel} onChange={event => change({ activityLevel: event.target.value as typeof draft.activityLevel })}>{Object.entries(ACTIVITY_LEVELS).map(([key, value]) => <option key={key} value={key}>{t(value.ru, value.en)}</option>)}</select></label>
          <label>{t('Цель', 'Goal')}<select value={draft.fitnessGoal} onChange={event => change({ fitnessGoal: event.target.value as typeof draft.fitnessGoal })}>{Object.entries(FITNESS_GOALS).map(([key, value]) => <option key={key} value={key}>{t(value[0], value[1])}</option>)}</select></label>
        </div><p className="physis-muted">{t('Низкий — преимущественно сидячий день; умеренный — регулярная ходьба и тренировки; высокий — много движения или физическая работа. Нормы питания и личные правила настраиваются ниже.', 'Low: mostly sedentary days. Moderate: regular walking and training. High: extensive movement or physical work. Adjust nutrition targets and personal rules below.')}</p></fieldset>
        <NutritionSettings {...props} personalDraft={draft} editorRef={nutritionEditor} />
        {action.error && <p className="physis-warning" role="alert">{action.error}</p>}
        <div className="physis-actions"><button className="physis-primary" type="submit" disabled={action.busy}>{action.busy ? t('Сохраняется…', 'Saving…') : t('Сохранить личные данные', 'Save personal details')}</button><button type="button" disabled={action.busy} onClick={onClose}>{t('Закрыть', 'Close')}</button></div>
        {saved && <p className="physis-status" role="status">{t('Личные данные сохранены', 'Personal details saved')}</p>}
      </form>
    </section>
  </div>;
}
