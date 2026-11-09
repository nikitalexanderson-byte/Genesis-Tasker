'use client';
import { useRef } from 'react';
import type { CustomFoodRule, NutritionProfile } from './nutrition-domain';

type Rules = Pick<NutritionProfile, 'foodRules' | 'customFoodRules'>;
const categoryNames = { soy: ['Соя и производные', 'Soy and derivatives'], legume: ['Бобовые', 'Legumes'], 'seed-oil': ['Масла из семян', 'Seed oils'] };

export function NutritionRulesEditor({ value, onChange, language, today }: {
  value: Rules; onChange: (next: Rules) => void; language: string; today: string;
}) {
  const t = (ru: string, en: string) => language === 'en' ? en : ru;
  const root = useRef<HTMLFieldSetElement>(null);
  const custom = value.customFoodRules ?? [];
  const update = (id: string, patch: Partial<CustomFoodRule>) => onChange({ ...value, customFoodRules: custom.map(rule => rule.id === id ? { ...rule, ...patch, reviewedAt: today } : rule) });
  const add = () => {
    const id = crypto.randomUUID();
    onChange({ ...value, customFoodRules: [...custom, { id, name: '', terms: [], text: '', enabled: true, reviewedAt: today }] });
    requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>(`[data-food-rule="${id}"] input[type=text]`)?.focus());
  };
  return <fieldset ref={root} className="physis-food-rules"><legend>{t('Личные правила питания', 'Personal food rules')}</legend>
    <p>{t('Правила помогают заметить выбранные вами продукты перед добавлением в рацион. Напишите, на что хотите обратить внимание и почему. Предупреждение не мешает записать то, что вы действительно съели.', 'Rules help you notice foods you choose to watch before adding them to your diary. Say what you want to notice and why. A warning never blocks logging what you actually ate.')}</p>
    <div className="physis-food-rule-list">{value.foodRules.map((rule, index) => <article className="physis-food-rule" key={rule.id}>
      <label className="physis-nutrition-check"><input type="checkbox" checked={rule.enabled} onChange={event => onChange({ ...value, foodRules: value.foodRules.map((item, position) => position === index ? { ...item, enabled: event.target.checked, reviewedAt: today } : item) })} /><strong>{categoryNames[rule.category][language === 'en' ? 1 : 0]}</strong></label>
      <p className="physis-muted">{t('Подсказка появляется, если в карточке продукта указано «содержит» или «может содержать» эту категорию.', 'A notice appears when a food is marked as containing or possibly containing this category.')}</p>
      <label>{t('Текст подсказки и причина', 'Notice and reason')}<textarea rows={2} maxLength={2000} value={rule.text} onChange={event => onChange({ ...value, foodRules: value.foodRules.map((item, position) => position === index ? { ...item, text: event.target.value, reviewedAt: today } : item) })} /></label>
    </article>)}
    {custom.map(rule => <article className="physis-food-rule" key={rule.id} data-food-rule={rule.id}>
      <header className="physis-row"><label className="physis-nutrition-check"><input type="checkbox" checked={rule.enabled} onChange={event => update(rule.id, { enabled: event.target.checked })} /><strong>{t('Своё правило', 'Custom rule')}</strong></label><button type="button" onClick={() => onChange({ ...value, customFoodRules: custom.filter(item => item.id !== rule.id) })}>{t('Убрать из правил', 'Remove rule')}</button></header>
      <div className="physis-nutrition-fields"><label>{t('Название правила', 'Rule name')}<input type="text" required maxLength={200} value={rule.name} placeholder={t('Например: обращать внимание на сахар', 'For example: watch added sugar')} onChange={event => update(rule.id, { name: event.target.value })} /></label>
        <label>{t('Слова или фразы через запятую', 'Words or phrases, comma separated')}<input type="text" required maxLength={1600} value={rule.terms.join(',')} placeholder={t('Например: сахар, глюкозный сироп', 'For example: sugar, glucose syrup')} onChange={event => update(rule.id, { terms: event.target.value.split(',') })} /></label></div>
      <label>{t('Что напомнить и зачем', 'What to remind you and why')}<textarea required rows={2} maxLength={2000} value={rule.text} onChange={event => update(rule.id, { text: event.target.value })} /></label>
      <p className="physis-muted">{t('Ищем целые слова и фразы в названии, бренде, синонимах и указанном составе, без учёта регистра. До 20 фраз, каждая до 80 символов. Если состав не указан, правило не подтверждает отсутствие ингредиента.', 'Matches whole words and phrases in the name, brand, aliases and listed ingredients, ignoring case. Up to 20 phrases, 80 characters each. Missing ingredients cannot confirm that an ingredient is absent.')}</p>
    </article>)}</div>
    <button type="button" disabled={custom.length >= 100} onClick={add}>{t('Добавить своё правило', 'Add custom rule')}</button>
    <p className="physis-muted">{t('Изменения сохраняются вместе с профилем питания. Это ваши предпочтения, а не проверка аллергенов или медицинское назначение. Выключение правила сохраняет его текст и историю питания.', 'Changes are saved with your nutrition profile. These are personal preferences, not an allergen check or a medical prescription. Turning a rule off keeps its text and food history.')}</p>
  </fieldset>;
}
