/** Conventional transliteration for display; it is separate from isopsephy normalization. */
export function transliterateGreek(value:string):string {
 const letters=[...value.normalize('NFD').toLowerCase().matchAll(/([α-ως])([\u0300-\u036f]*)/gu)].map(row=>({letter:row[1],marks:row[2]}));
 const latin:Record<string,string>={α:'a',β:'b',γ:'g',δ:'d',ε:'e',ζ:'z',η:'ē',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'ph',χ:'kh',ψ:'ps',ω:'ō'};
 let text='';
 const rough=letters.slice(0,2).some(row=>row.marks.includes('\u0314'));
 if(rough&&letters[0]&&/[αεηιουω]/u.test(letters[0].letter))text='h';
 for(let index=0;index<letters.length;index++) {
  const row=letters[index],next=letters[index+1];
  const pair=row.letter+(next?.letter??'');
  if(next&&!next.marks.includes('\u0308')&&['ου','αι','ει','οι','υι','αυ','ευ','ηυ'].includes(pair)) {
   text+=({ου:'ou',αι:'ai',ει:'ei',οι:'oi',υι:'yi',αυ:'au',ευ:'eu',ηυ:'ēu'} as Record<string,string>)[pair];index++;
  } else if(row.letter==='γ'&&next&&/[γκξχ]/u.test(next.letter))text+='n';
  else if(row.letter==='ρ'&&row.marks.includes('\u0314'))text+='rh';
  else text+=latin[row.letter];
  if(row.marks.includes('\u0345'))text+='i';
 }
 return text;
}
