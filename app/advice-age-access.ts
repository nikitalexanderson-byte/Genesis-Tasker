import policy from '../server/resources/advice-age-access-policy.json' with {type:'json'};

export const ADVICE_AGE_POLICY = policy;
export const PSYCHOPOMPIA_SUBCATEGORIES = policy.subcategories;
export type AdvicePsychopompiaPreferences = {adultConfirmed:boolean;subcategories:string[];alcohol:{consent:boolean;countryCode:string;subdivisionCode:string;ageAtLeast:number|null;policyVersion:string}};
type JurisdictionRule={status:string;minimumAge?:number|null;subdivisions?:Record<string,JurisdictionRule>;name?:string};
export function adviceAlcoholJurisdiction(country:string,subdivision='',rules:typeof policy=policy):{state:'verified'|'unknown'|'subdivision-required'|'blocked';minimumAge:number|null}{
  let rule=(rules.jurisdictions as Record<string,JurisdictionRule>)[country];
  if(!rule)return{state:'unknown',minimumAge:null};
  if(rule.status==='subdivision-required'){
    if(!subdivision)return{state:'subdivision-required',minimumAge:null};
    rule=rule.subdivisions?.[subdivision] as JurisdictionRule;
  }else if(subdivision)return{state:'unknown',minimumAge:null};
  if(rule?.status==='blocked')return{state:'blocked',minimumAge:null};
  return rule?.status==='verified'&&Number.isInteger(rule.minimumAge)?{state:'verified',minimumAge:Math.max(18,rule.minimumAge!)}:{state:'unknown',minimumAge:null};
}
export function advicePsychopompiaPreferences(value?:Partial<AdvicePsychopompiaPreferences>|null):AdvicePsychopompiaPreferences{
  const alcohol=value?.alcohol;
  const ids=PSYCHOPOMPIA_SUBCATEGORIES.map(row=>row.id);
  const country=typeof alcohol?.countryCode==='string'&&/^(?:[A-Z]{2})?$/.test(alcohol.countryCode)?alcohol.countryCode:'';
  const subdivision=typeof alcohol?.subdivisionCode==='string'&&/^(?:[A-Z]{2}-[A-Z0-9]{1,4})?$/.test(alcohol.subdivisionCode)&&(!alcohol.subdivisionCode||alcohol.subdivisionCode.startsWith(country+'-'))?alcohol.subdivisionCode:'';
  return{adultConfirmed:value?.adultConfirmed===true,subcategories:ids.filter(id=>!Array.isArray(value?.subcategories)||value.subcategories.includes(id)),
    alcohol:{consent:alcohol?.consent===true,countryCode:country,subdivisionCode:subdivision,
      ageAtLeast:typeof alcohol?.ageAtLeast==='number'&&[18,19,20,21,25].includes(alcohol.ageAtLeast)?alcohol.ageAtLeast:null,
      policyVersion:typeof alcohol?.policyVersion==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(alcohol.policyVersion)?alcohol.policyVersion:policy.policyVersion}};
}
export function adviceAlcoholAllowed(value:AdvicePsychopompiaPreferences,rules:typeof policy=policy):boolean{
  const rule=adviceAlcoholJurisdiction(value.alcohol.countryCode,value.alcohol.subdivisionCode,rules);
  return value.adultConfirmed&&value.alcohol.consent&&value.alcohol.policyVersion===rules.policyVersion&&rule.state==='verified'&&value.alcohol.ageAtLeast===rule.minimumAge;
}
export type PsychopompiaCardAccess={categories:readonly string[];requiresAdult?:boolean;subcategories?:string[];containsAlcohol?:boolean;psychopompiaPublished?:boolean;review?:{status?:string}};
export function advicePsychopompiaAllowed(card:PsychopompiaCardAccess,value:AdvicePsychopompiaPreferences,selectedCategories:readonly string[],rules:typeof policy=policy):boolean{
  const ids=rules.subcategories.map(row=>row.id);
  return rules.corpusEnabled&&card.categories.includes('psychopompia')&&selectedCategories.includes('psychopompia')&&value.adultConfirmed&&card.requiresAdult===true&&typeof card.containsAlcohol==='boolean'
    &&card.psychopompiaPublished===true&&card.review?.status==='cleared'&&Array.isArray(card.subcategories)&&card.subcategories.length>0
    &&card.subcategories.every(id=>ids.includes(id))&&card.subcategories.some(id=>value.subcategories.includes(id))&&(!card.containsAlcohol||adviceAlcoholAllowed(value,rules));
}
export function adviceNotificationSafe(card:PsychopompiaCardAccess):boolean{
  return card.requiresAdult!==true&&card.containsAlcohol!==true&&!card.categories.some(id=>id==='aphrodisia'||id==='psychopompia');
}
