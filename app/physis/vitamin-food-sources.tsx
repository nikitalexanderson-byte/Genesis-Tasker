import raw from './vitamin-food-sources.json';
import minerals from './mineral-food-sources.json';

export type VitaminFoodSource = { food: string[]; amount: number; amountMax?: number; approximate?: boolean; unit: string; portion: string[]; source: string; fdcId?: number; nutrientId?: number };
export type VitaminFoodProfile = { label: string[]; note: string[] | null; items: VitaminFoodSource[] };
export const VITAMIN_FOOD_SOURCES = raw as Record<string, VitaminFoodProfile>;
export const NUTRIENT_FOOD_SOURCES = { ...VITAMIN_FOOD_SOURCES, ...minerals } as Record<string, VitaminFoodProfile>;
export function NutrientFoodSources({ id, en }: { id: string; en: boolean }) {
  const profile = NUTRIENT_FOOD_SOURCES[id]; if (!profile) return null;
  const at = en ? 1 : 0;
  const unit = (value: string) => en ? value : value.replace('mcg', 'мкг').replace('mg', 'мг');
  const number = (value: number) => value.toLocaleString(en ? 'en' : 'ru', { maximumFractionDigits: 3 });
  return <section className="physis-reference-foods">
    <h4>{en ? 'Food sources and amounts' : 'Пищевые источники и количество'}</h4>
    <p>{profile.label[at]}</p>
    <p className="physis-muted">{en ? 'Approximate composition for the stated food and preparation. This is food content, not a supplement dose or an intake target. Each food links to its data source.' : 'Примерный состав указанного продукта с учётом приготовления. Это содержание в еде, а не доза добавки или норма потребления. Название продукта открывает источник данных.'}</p>
    <table><caption className="sr-only">{profile.label[at]}</caption><thead><tr><th scope="col">{en ? 'Food' : 'Продукт'}</th><th scope="col">{en ? 'Portion' : 'Порция'}</th><th scope="col">{en ? 'Amount' : 'Содержание'}</th></tr></thead><tbody>{profile.items.map((item, index) => <tr key={index}><th scope="row"><a href={item.source} target="_blank" rel="noreferrer">{item.food[at]}</a></th><td>{item.portion[at]}</td><td>{item.approximate ? '≈ ' : ''}{number(item.amount)}{item.amountMax === undefined ? '' : `–${number(item.amountMax)}`} {unit(item.unit)}</td></tr>)}</tbody></table>
    {profile.note && <p className="physis-muted">{profile.note[at]}</p>}
  </section>;
}
