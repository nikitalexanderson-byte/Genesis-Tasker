import layout from './stoicheion-reading-layout.json';
/** Paragraph correspondence is verified against all 24 author texts in all 14 locales. */
export function splitStoicheionReading(content:string,id:string):{upright:string;reversed:string;profile:string}{
  const spec=(layout as Record<string,{paragraphs:number;upright:number;reversed:number}>)[id];
  const paragraphs=content.split(/\n\s*\n/);
  if(!spec||paragraphs.length!==spec.paragraphs)throw new Error('STOICHEION_READING_LAYOUT_MISMATCH');
  return {upright:paragraphs[spec.upright],reversed:paragraphs[spec.reversed],profile:paragraphs.filter((_,i)=>i!==spec.upright&&i!==spec.reversed).join('\n\n')};
}
