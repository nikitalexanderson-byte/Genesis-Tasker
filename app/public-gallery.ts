import copy from './public-gallery-copy.json';

export const PUBLIC_GALLERY_IDS=['today','today-tasks','projects','project-create','task-create','task-recurrence','calendar-gregorian','calendar-sacred','calendar-lunar','calendar-year','habits','habit-settings','habit-statistics','mood','sleep','diary','mindmap','stoicheion','theokyklos','day-rhythm'] as const;
export function publicGalleryCopy(language:string){return copy[language as keyof typeof copy]??copy.en;}
export function publicGalleryItems(language:string){
  const locale=Object.hasOwn(copy,language)?language:'en';
  return PUBLIC_GALLERY_IDS.map((id,index)=>({id,src:`/product-preview/free/${locale}/${id}.jpg`,caption:publicGalleryCopy(locale).items[index]}));
}
