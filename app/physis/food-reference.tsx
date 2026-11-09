import type { Food } from './nutrition-domain';
import { foodReferenceFor } from './food-reference-domain';
export { FOOD_REFERENCES, isTopFood, manualReferenceFoods } from './food-reference-domain';
import './reference-catalogs.css';
export function FoodReferenceNote({ food, language, expanded = false }: { food: Food; language: string; expanded?: boolean }) {
  const entry = foodReferenceFor(food); if (!entry) return null;
  const en = language === 'en'; const at = en ? 1 : 0;
  const labelNote = en ? 'Label reference: values are normalized to 100 g for the named product. Other brands may differ; undeclared nutrients stay unknown.' : 'Пример состава по этикетке указанной марки, в пересчёте на 100 г. Другие марки могут отличаться; неуказанные нутриенты остаются неизвестными.';
  const sources = <><p>{entry.limits[at]}</p>{entry.fdcId ? <p><a href={`https://fdc.nal.usda.gov/food-details/${entry.fdcId}/nutrients`} target="_blank" rel="noreferrer">USDA FoodData Central · {entry.fdcId}</a></p> : <p>{food.provenance.provider === 'label' ? labelNote : (en ? 'No matching verified numerical composition: enter the actual label values. Missing values stay unknown.' : 'Точного проверенного численного состава нет: внесите значения с этикетки. Отсутствующие данные остаются неизвестными.')}{food.provenance.provider === 'label' && <> <a href={food.provenance.source} target="_blank" rel="noreferrer">{en ? 'Product label' : 'Этикетка продукта'}</a></>}</p>}{entry.links.map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></p>)}</>;
  return <section className="physis-food-reference"><h4>{en ? 'Nutrient properties' : 'Нутриентные свойства'}</h4><p>{entry.properties[at]}</p><p>{entry.health[at]}</p>{expanded?<section><h4>{en ? 'Limits and sources' : 'Ограничения и источники'}</h4>{sources}</section>:<details><summary>{en ? 'Limits and sources' : 'Ограничения и источники'}</summary>{sources}</details>}</section>;
}
export function SuperfoodCollectionNote({ language }: { language: string }) {
  const en = language === 'en';
  return <div className="physis-food-collection-note"><p>{en ? 'A selection from your source table. Foods remain in their regular categories too. Health effects depend on the whole diet and portion; the collection is not a medical ranking.' : 'Подборка из вашей исходной таблицы. Продукты доступны и в обычных категориях. Влияние на здоровье зависит от всего рациона и порции; подборка не является медицинским рейтингом.'}</p></div>;
}
