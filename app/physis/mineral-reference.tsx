import { useState } from 'react';
import { MINERAL_PROFILES, mineralIntake, type MineralIntake } from './mineral-reference-data';

const ageLabel = (row: MineralIntake) => row.maxAge === null ? `${row.minAge}+` : `${row.minAge}–${row.maxAge}`;
const amount = (value: number, unit: string, en: boolean) => `${value.toLocaleString(en ? 'en' : 'ru')} ${en ? unit : unit === 'mcg' ? 'мкг' : 'мг'}`;

export function MineralOverview({ ids, en }: { ids: string[]; en: boolean }) {
  const [age, setAge] = useState(19);
  const profiles = MINERAL_PROFILES.filter(item => ids.includes(item.id));
  if (!profiles.length) return null;
  return <details className="physis-mineral-overview">
    <summary>{en ? 'Minerals: daily intake references' : 'Минералы: суточные ориентиры'}</summary>
    <p>{en ? 'NASEM / NIH ODS references for healthy adults aged 19+, excluding pregnancy and lactation. These describe total dietary intake, not a supplement prescription. Countries may use different references.' : 'Ориентиры NASEM / NIH ODS для здоровых взрослых от 19 лет, кроме беременности и грудного вскармливания. Это общее поступление с пищей, а не назначение добавки. Национальные рекомендации могут различаться.'}</p>
    <label>{en ? 'Age group' : 'Возрастная группа'}<select value={age} onChange={event => setAge(Number(event.target.value))}><option value={19}>19–30</option><option value={31}>31–50</option><option value={51}>51–70</option><option value={71}>71+</option></select></label>
    <div className="physis-mineral-table"><table><caption className="sr-only">{en ? 'Daily mineral references by sex' : 'Суточные ориентиры минералов по полу'}</caption><thead><tr><th scope="col">{en ? 'Mineral' : 'Минерал'}</th><th scope="col">{en ? 'Men' : 'Мужчины'}</th><th scope="col">{en ? 'Women' : 'Женщины'}</th></tr></thead><tbody>{profiles.map(item => {
      const row = mineralIntake(item.id, age)!;
      return <tr key={item.id}><th scope="row">{item.name[en ? 1 : 0]}<small>{item.kind}{item.id === 'chromium' ? '*' : ''}</small></th><td>{amount(row.male, item.unit, en)}</td><td>{amount(row.female, item.unit, en)}</td></tr>;
    })}</tbody></table></div>
    <p className="physis-muted">{en ? 'RDA: intake sufficient for nearly all healthy people. AI: adequate intake used when evidence is insufficient for an RDA. Neither is a treatment dose or a maximum safe amount.' : 'RDA — потребление, достаточное почти всем здоровым людям. AI — адекватное потребление, когда данных для RDA недостаточно. Оба показателя не являются лечебной дозой или максимально безопасным количеством.'}</p>
    {profiles.some(item => item.id === 'chromium') && <p className="physis-muted">{en ? '*Chromium: US AI from 2001; EFSA did not establish a reference because essentiality is unproven. See the chromium card for sources and limitations.' : '*Хром: AI США 2001 года; EFSA не установила норму из-за недоказанной незаменимости. Источники и ограничения — в карточке хрома.'}</p>}
    <p className="physis-muted">{en ? 'Open a mineral card for source links, age-specific amounts, absorption, interactions and food composition.' : 'В карточке каждого минерала — ссылки на источники, возрастные нормы, усвоение, взаимодействия и содержание в продуктах.'}</p>
  </details>;
}

export function MineralReference({ id, en }: { id: string; en: boolean }) {
  const profile = MINERAL_PROFILES.find(item => item.id === id);
  if (!profile) return null;
  const at = en ? 1 : 0;
  return <section className="physis-mineral-reference">
    <h4>{en ? 'Dietary requirements and absorption' : 'Потребность и усвоение'}</h4>
    <p className="physis-muted">{en ? 'Daily total intake for healthy adults; not pregnant or breastfeeding. RDA / AI are dietary references, not supplement doses. National guidance can differ.' : 'Общее суточное поступление для здоровых взрослых вне беременности и грудного вскармливания. RDA / AI — пищевые ориентиры, а не дозировки добавок. Национальные рекомендации могут отличаться.'}</p>
    <div className="physis-mineral-table"><table><caption>{profile.kind} · {profile.name[at]}</caption><thead><tr><th scope="col">{en ? 'Age' : 'Возраст'}</th><th scope="col">{en ? 'Men' : 'Мужчины'}</th><th scope="col">{en ? 'Women' : 'Женщины'}</th></tr></thead><tbody>{profile.intakes.map(row => <tr key={row.minAge}><th scope="row">{ageLabel(row)}</th><td>{amount(row.male, profile.unit, en)}</td><td>{amount(row.female, profile.unit, en)}</td></tr>)}</tbody></table></div>
    <p>{profile.note[at]}</p>
    <dl><div><dt>{en ? 'Forms and absorption' : 'Формы и усвоение'}</dt><dd>{profile.absorption[at]}</dd></div><div><dt>{en ? 'When to consider a supplement' : 'Когда рассматривать добавку'}</dt><dd>{profile.supplementation[at]}</dd></div><div><dt>{en ? 'Combinations and interactions' : 'Сочетания и взаимодействия'}</dt><dd>{profile.interactions[at]}</dd></div><div><dt>{en ? 'Combination products' : 'Комплексные препараты'}</dt><dd>{profile.combinations[at]}</dd></div></dl>
    <div className="physis-nutrient-term-sources">{profile.sources.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a>)}</div>
  </section>;
}
