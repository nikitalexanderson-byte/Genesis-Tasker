import raw from './reference-catalog-seed.ts';
import pharmacology from './pharmacology-seed.ts';
import proteins from './protein-catalog-data.json';
import { SUBSTANCE_RESEARCH } from './substance-research.ts';
import { SUPPLEMENT_REFERENCES, type SupplementReference } from './supplement-reference-data.ts';
import { blankFood, type Food } from './nutrition-domain.ts';
import type { Drug } from './care-domain.ts';
import { editPhysisRecord, newPhysisRecord, type PhysisRecord } from './types.ts';
import type { Recipe } from './nutrition-domain.ts';
import { FOOD_COMPOSITIONS, applyFoodComposition, compositionFromFood, excludedCatalogFood, type FoodComposition } from './food-composition-domain.ts';

export type CatalogItem = {
  id: string; kind: 'food' | 'supplement' | 'medicine'; nameRu: string; nameEn: string; aliases: string[];
  family: string; tags: string[]; description: string; uses: string; evidence: string; risks: string;
  sources: string[]; reviewedAt: string; verification: string; restricted: boolean; hidden: boolean;
  scopeNote: string; legacyId: string;
  composition?: FoodComposition;
  status?: string; mechanism?: string; contraindications?: string; interactions?: string;
};
export type CatalogOverride = { id: string; entry: CatalogItem; revision: number; updatedAt: string };
export type CatalogView = CatalogItem & { revision: number };
export type ReferenceCatalog = {
  entries: CatalogView[]; canEdit: boolean; loading: boolean; error: string;
  reload: () => Promise<void>; save: (entry: CatalogItem, expectedRevision: number) => Promise<void>;
};
export const catalogText = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, String.fromCodePoint(0x435)).normalize('NFKC');
// Exact normalized names only: fruit, bark, extracts and mineral salts are different ingredients.
export const identityKey = (value: string) => catalogText(value).replace(/[^\p{L}\p{N}]/gu, '');
const identityKeys = (entry: Pick<CatalogItem, 'nameRu' | 'nameEn' | 'aliases'>) => [entry.nameRu, entry.nameEn, ...entry.aliases].map(identityKey).filter(Boolean);
function legacyItem(entry: SupplementReference): CatalogItem {
  return { id: 'legacy-'+entry.id, kind:'supplement', nameRu:entry.name[0], nameEn:entry.name[1], aliases:entry.name,
    family:entry.path[0], tags:entry.path.slice(1), description:entry.substance[0], uses:entry.path.slice(1).join(', '),
    evidence:entry.evidence[0], risks:entry.cautions[0], sources:entry.sources, reviewedAt:entry.reviewedAt,
    verification:'Тематическая проверка', restricted:false, hidden:false, scopeNote:entry.limits[0], legacyId:entry.id };
}
function seedCatalog(): CatalogItem[] {
  const entries = ([...raw,...proteins,...pharmacology] as CatalogItem[]).map(entry => ({...entry, aliases:[...entry.aliases], tags:[...entry.tags], sources:[...entry.sources], ...(FOOD_COMPOSITIONS[entry.id] ? {composition:FOOD_COMPOSITIONS[entry.id]} : {})}));
  const equivalents:Record<string,string>={inositol:'PHY-0098',paba:'PHY-0180',carnitine:'PHY-0015','pangamic-acid':'PHY-0177','lipoic-acid':'PHY-0069',chromium:'PHY-0289',thiamin:'PHY-0183',riboflavin:'PHY-0181',niacin:'PHY-0175',pantothenate:'PHY-0179',biotin:'PHY-0166',folate:'PHY-0185'};
  for (const legacy of SUPPLEMENT_REFERENCES) {
    // The generic dietary-protein reference is now represented by the food catalog.
    if (legacy.id === 'protein') { entries.find(entry=>entry.id==='PHY-0058')!.legacyId='protein'; continue; }
    const item = legacyItem(legacy), keys = identityKeys(item);
    const existing = entries.find(entry => entry.id===equivalents[legacy.id]) ?? entries.find(entry => entry.kind === 'supplement' && identityKeys(entry).some(key => keys.includes(key)));
    if (!existing) { entries.push(item); continue; }
    existing.legacyId = legacy.id;
    existing.aliases = [...new Set([...existing.aliases, ...legacy.name])];
    existing.tags = [...new Set([...existing.tags, ...legacy.path])];
    existing.scopeNote = [existing.scopeNote, legacy.limits[0]].filter(Boolean).join('\n\n');
    existing.evidence = legacy.evidence[0]+'\n\nДругие применения в исходном справочнике: '+existing.evidence;
    existing.risks = [...new Set([legacy.cautions[0], existing.risks])].join('\n\n');
    existing.sources = [...new Set([...legacy.sources, ...existing.sources])];
  }
  // Apply current evidence after legacy equivalences; administrator overrides still
  // take precedence in mergeCatalog. Food identities and historical records stay stable.
  for (const entry of entries) {
    const research = (SUBSTANCE_RESEARCH as Record<string, Partial<CatalogItem>>)[entry.id];
    // Replace the scraped summaries and inferred indications with authored text.
    // Do not let old plant-part guesses or legacy claims contradict the review.
    if (research) Object.assign(entry, {description:research.mechanism??entry.description,uses:'',scopeNote:''}, research,
      {sources:[...new Set([...(research.sources??[]),...entry.sources])],
        aliases:[...new Set([...entry.aliases,...(research.nameRu&&research.nameRu!==entry.nameRu?[entry.nameRu]:[])])]});
  }
  return entries;
}
export const CATALOG_SEED = seedCatalog();
const seedById = new Map(CATALOG_SEED.map(entry=>[entry.id,entry]));
export function mergeCatalog(overrides: CatalogOverride[]): CatalogView[] {
  const entries = new Map(CATALOG_SEED.map(entry => [entry.id, {...entry, revision:0}]));
  for (const value of overrides) entries.set(value.id, {...value.entry, composition:value.entry.composition ?? entries.get(value.id)?.composition, revision:value.revision});
  return [...entries.values()].sort((a,b)=>a.nameRu.localeCompare(b.nameRu,'ru'));
}
export function catalogItem(view: CatalogView): CatalogItem {
  const entry: Partial<CatalogView> = {...view}; delete entry.revision; return entry as CatalogItem;
}
export function catalogCategories(entry: Pick<CatalogItem, 'family' | 'tags'>): string[] { return [...new Set([entry.family,...entry.tags])]; }
export function matchesCatalog(entry: CatalogItem, query: string, selected: string[], mode: 'any' | 'all' = 'any'): boolean {
  const haystack = catalogText([entry.nameRu,entry.nameEn,...entry.aliases,entry.description].join(' '));
  const words = catalogText(query.trim()).split(/\s+/).filter(Boolean);
  const categories = catalogCategories(entry);
  return words.every(word=>haystack.includes(word)) && (!selected.length || (mode==='all' ? selected.every(value=>categories.includes(value)) : selected.some(value=>categories.includes(value))));
}
export const catalogName = (entry: CatalogItem, language: string) => language === 'en' ? entry.nameEn || entry.nameRu : entry.nameRu;
/** Exact, unambiguous ingredient identities also recognise names used before a rename. */
export function referenceForDrug(drug: Drug, entries: CatalogItem[]): CatalogItem | undefined {
  const candidates=entries.filter(entry=>entry.kind===drug.category);
  const matches=(name:string)=>candidates.filter(entry=>[entry.nameRu,entry.nameEn,...entry.nameEn.split(';'),...entry.aliases].some(value=>identityKey(value)===identityKey(name)));
  const byName=drug.name.trim()?matches(drug.name):[];
  if(byName.length)return byName.length===1?byName[0]:undefined;
  const byIngredient=drug.activeIngredients.trim()?matches(drug.activeIngredients):[];
  return byIngredient.length===1?byIngredient[0]:undefined;
}
export function personalDrugCategories(drug: Drug, entries: CatalogItem[]): string[] {
  const reference=referenceForDrug(drug,entries);
  return [...new Set([...(reference?catalogCategories(reference):[]),...(drug.catalogPath??[])])];
}
/** Restore a matching archived card without losing its brand, dose or history. */
export function preparePersonalDrug(entry: CatalogItem, language: string, records: PhysisRecord<Drug>[], entries: CatalogItem[], pending?: PhysisRecord<Drug>) {
  if(entry.kind==='food'||entry.hidden)throw new Error('Эта карточка недоступна для добавления в препараты.');
  const matches=records.filter(record=>referenceForDrug(record.data,entries)?.id===entry.id);
  const active=matches.find(record=>!record.data.archived);
  if(active)return {record:active,action:'existing' as const};
  const archived=matches.find(record=>record.data.archived);
  if(archived)return {record:editPhysisRecord(archived,{...archived.data,archived:false}),action:'restore' as const};
  return {record:pending??newPhysisRecord('drug',catalogDrug(entry,language)),action:'create' as const};
}
export function newCatalogItem(kind: CatalogItem['kind']): CatalogItem {
  const now = new Date(), day = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  return { id:'custom-'+crypto.randomUUID(),kind,nameRu:'',nameEn:'',aliases:[],family:kind==='food'?'Другое':kind==='medicine'?'Фармакологические вещества':'Растения и экстракты',tags:[],
    description:'',uses:'',evidence:'',risks:'',sources:[],reviewedAt:day,verification:'Редакция администратора',restricted:false,hidden:false,scopeNote:'',legacyId:'' };
}
export function catalogDrug(entry: CatalogItem, language: string): Drug {
  // Personal records have smaller bounds; the complete text remains in the shared card.
  const sources=entry.sources.reduce((text,url)=>text.length+url.length+(text?1:0)<=2000?(text?text+'\n':'')+url:text,'');
  return { name:catalogName(entry,language).slice(0,200),brand:'',category:entry.kind==='medicine'?'medicine':'supplement',form:'Уточнить по этикетке',route:'other',activeIngredients:entry.nameRu,amountPerUnit:null,
    activeUnit:'mg',concentration:null,concentrationUnit:'mg/ml',packageSize:'',source:sources,
    notes:[entry.risks,entry.contraindications,entry.interactions,entry.scopeNote,entry.description,entry.evidence].filter(Boolean).join('\n\n').slice(0,10000),favorite:false,archived:false,nutrients:[],catalogPath:catalogCategories(entry).slice(0,5) };
}
/** Stable valid record ID keeps favorites and historical meal snapshots compatible. */
export function catalogFoodId(id: string): string {
  if (/^food-[0-9a-f-]{36}$/.test(id)) return id.slice(5);
  if (/^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return id.slice(7);
  if (/^PHY-[0-9]{4}$/.test(id)) return '00000000-0000-4000-9000-'+id.slice(4).padStart(12,'0');
  // Namespaced deterministic UUID for legacy entries moved to food by the administrator.
  const hex = [0,1,2,3].map(salt=>{
    let hash=2166136261;for(const char of `genesis:catalog:${salt}:${id}`)hash=Math.imul(hash^char.charCodeAt(0),16777619);
    return (hash>>>0).toString(16).padStart(8,'0');
  }).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
export function catalogFood(entry: CatalogItem, language: string): Food {
  const food = blankFood();
  food.name=catalogName(entry,language); food.aliases=[entry.nameRu,entry.nameEn,...entry.aliases].filter(Boolean);
  food.category=entry.family;food.collections=catalogCategories(entry).includes('Суперфуды')?['superfoods']:[];
  food.ingredients=food.name; food.compositionKnown=false;
  food.provenance={provider:'manual',id:'catalog:'+entry.id,version:'GENESIS / '+entry.reviewedAt,source:entry.sources[0]??'GENESIS',license:'Reference facts with linked sources; nutritional composition unknown.'};
  return entry.composition ? applyFoodComposition(food,entry.composition) : food;
}
export function referenceForFood(food: Food, entries: CatalogView[]): CatalogView | undefined {
  const id=food.provenance.id.replace(/^catalog:/,'');
  const direct=entries.find(entry=>entry.id===id);
  if(direct)return direct;
  const keys=[food.name,...food.aliases].map(identityKey).filter(Boolean);
  return entries.find(entry=>{
    const original=seedById.get(entry.id);
    return (entry.kind==='food'||original?.kind==='food') && [...identityKeys(entry),...(original?identityKeys(original):[])].some(key=>keys.includes(key));
  });
}

export type CatalogFoodEntry = { id:string; food:Food; record:PhysisRecord<Food>|PhysisRecord<Recipe>; reference?:CatalogView };
/** Give every built-in food a stable shared editor, including entries predating the imported catalog. */
export function standaloneFoodReference(entry: CatalogFoodEntry): CatalogView {
  const food=entry.food, nameRu=[food.name,...food.aliases].find(name=>/[А-Яа-яЁё]/.test(name))??food.name;
  const nameEn=[food.name,...food.aliases].find(name=>/^[A-Za-z]/.test(name))??food.name;
  return {id:'food-'+entry.id,kind:'food',nameRu,nameEn,aliases:[...new Set([food.name,...food.aliases])].slice(0,40),family:food.category??'Другое',
    tags:food.collections?.includes('superfoods')?['Суперфуды']:[],description:nameRu,uses:'',evidence:'',risks:'',
    sources:/^https?:\/\//.test(food.provenance.source)?[food.provenance.source]:[],reviewedAt:'2026-11-02',verification:'Состав по указанному источнику',
    restricted:false,hidden:false,scopeNote:'',legacyId:'',revision:0,composition:compositionFromFood(food)};
}
export function combineCatalogFoods(personal:CatalogFoodEntry[], base:CatalogFoodEntry[], entries:CatalogView[], language:string): CatalogFoodEntry[] {
  const represented=new Set<string>();
  const baseReferences=base.map(entry=>referenceForFood(entry.food,entries));
  const referenceCounts=new Map<string,number>();
  for(const reference of baseReferences)if(reference)referenceCounts.set(reference.id,(referenceCounts.get(reference.id)??0)+1);
  // Personal records and historical snapshots are never rewritten by shared edits.
  const saved=personal.map(entry=>{const reference=entries.find(item=>item.id==='food-'+entry.id)??referenceForFood(entry.food,entries);if(reference)represented.add(reference.id);return {...entry,reference};});
  const existing=base.flatMap((entry,index)=>{
    const shared=baseReferences[index];
    if(shared){represented.add(shared.id);if(shared.hidden||shared.kind!=='food')return [];}
    // Separate raw/cooked/label forms that share a substance name need independent editors.
    const reference=entries.find(item=>item.id==='food-'+entry.id)??(shared&&(referenceCounts.get(shared.id)??0)===1?shared:standaloneFoodReference(entry));
    represented.add(reference.id);
    if(reference.hidden||reference.kind!=='food')return [];
    const food={...(reference.revision && reference.composition ? applyFoodComposition(entry.food,reference.composition) : entry.food),category:reference.family,
      name:reference.revision?catalogName(reference,language):entry.food.name,
      aliases:[...new Set([...entry.food.aliases,reference.nameRu,reference.nameEn,...reference.aliases])].slice(0,100),
      collections:catalogCategories(reference).includes('Суперфуды')?[...new Set([...(entry.food.collections??[]),'superfoods'])]:entry.food.collections};
    return [{...entry,food,record:entry.record.kind==='food'?{...entry.record,data:food}:entry.record,reference}];
  });
  const imported=entries.filter(entry=>entry.kind==='food'&&!entry.hidden&&!represented.has(entry.id)).map(reference=>{
    const id=catalogFoodId(reference.id),food=catalogFood(reference,language);
    const record:PhysisRecord<Food>={id,kind:'food',schemaVersion:1,createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',source:'import',data:food};
    return {id,food,record,reference};
  });
  return [...saved,...existing,...imported].filter(entry=>!excludedCatalogFood(entry.food,entry.reference?.id));
}
