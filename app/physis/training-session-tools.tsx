import { useState } from 'react';
import { usePhysisAction } from './fields';
import { exerciseTagLabel } from './exercise-media';
import { exerciseDisplayName, trainingDistanceFromKm, trainingWeightFromKg, type ExerciseChoice, type ExerciseDefinition, type TrainingExercise, type TrainingSet } from './training-domain';

export function setDescription(set: TrainingSet, definition: ExerciseDefinition, weightUnit: 'kg' | 'lb', distanceUnit: 'km' | 'mi', en: boolean) {
  const number = (v: number) => Number(v.toFixed(2)).toLocaleString(en ? 'en' : 'ru');
  if (definition.metric === 'time') return set.seconds === null ? '—' : `${number(set.seconds)} ${en ? 's' : 'сек'}`;
  if (definition.metric === 'distance') return set.distanceKm === null ? '—' : `${number(trainingDistanceFromKm(set.distanceKm, distanceUnit))} ${distanceUnit}${set.seconds ? ` · ${number(set.seconds)} ${en ? 's' : 'сек'}` : ''}`;
  return `${set.weightKg === null ? '—' : number(trainingWeightFromKg(set.weightKg, weightUnit))} ${weightUnit} × ${set.reps ?? '—'}${set.repsMax ? `–${set.repsMax}` : ''}`;
}

export function ExerciseReplacement({ exercise, choices, en, allowProgram, onReplace }: {
  exercise: TrainingExercise; choices: ExerciseChoice[]; en: boolean; allowProgram: boolean;
  onReplace: (choice: ExerciseChoice, scope: 'today' | 'program') => Promise<void>;
}) {
  const t = (ru: string, english: string) => en ? english : ru;
  const [equipment, setEquipment] = useState(''); const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''); const [scope, setScope] = useState<'today' | 'program'>('today');
  const action = usePhysisAction();
  const alternatives = choices.filter(choice => choice.id !== exercise.exerciseId && choice.data.movement === exercise.snapshot.movement);
  const visible = alternatives.filter(choice => (!equipment || choice.data.equipment === equipment) && `${choice.data.name} ${choice.data.nameEn}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <details className="physis-exercise-replacement"><summary>{t('Заменить упражнение', 'Replace exercise')}</summary>
    <p className="physis-muted">{t('То же движение. Выберите доступное оборудование; вес задаётся заново или копируется из собственной истории замены.', 'Same movement. Choose available equipment; enter load again or copy the replacement’s own history.')}</p>
    <div className="physis-form">
      <label>{t('Доступное оборудование', 'Available equipment')}<select value={equipment} onChange={e => { setEquipment(e.target.value); setSelected(''); }}><option value="">{t('Любое', 'Any')}</option>{[...new Set(alternatives.map(c => c.data.equipment))].map(value => <option key={value} value={value}>{exerciseTagLabel(value, en)}</option>)}</select></label>
      <label>{t('Найти замену', 'Find replacement')}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setSelected(''); }} /></label>
      <label>{t('Новое упражнение', 'Replacement exercise')}<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t('Выберите упражнение', 'Choose exercise')}</option>{visible.map(choice => <option key={choice.id} value={choice.id}>{exerciseDisplayName(choice.data, en)}</option>)}</select></label>
      {allowProgram && <label>{t('Область замены', 'Replacement scope')}<select value={scope} onChange={e => setScope(e.target.value as 'today' | 'program')}><option value="today">{t('Только в этом занятии', 'This session only')}</option><option value="program">{t('Занятие и новая версия программы', 'Session and new program version')}</option></select></label>}
    </div>
    {scope === 'program' && <p>{t('Изменится этот день в новой версии программы. Существующие назначения и история останутся прежними; новую версию можно применить к будущим датам в программах.', 'Changes this day in a new program version. Existing assignments and history stay as recorded; apply the version to future dates in Programs.')}</p>}
    {!visible.length && <p>{t('С этим оборудованием замены не найдены. Измените фильтр или добавьте своё упражнение в справочник.', 'No alternatives for this equipment. Change the filter or add a personal exercise in the library.')}</p>}
    {action.error && <p role="alert">{action.error}</p>}
    <button type="button" disabled={action.busy || !selected} onClick={() => void action.run(async () => { const choice = visible.find(c => c.id === selected); if (choice) await onReplace(choice, scope); })}>{t('Применить замену', 'Apply replacement')}</button>
  </details>;
}
