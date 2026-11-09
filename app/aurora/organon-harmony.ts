import {GREEK_VOWELS} from './greek';

export const WORD_HARMONY_VERSION='aurora-word-harmony-v2';
const PHI=(1+Math.sqrt(5))/2;
const FIBONACCI=[1,2,3,5,8,13];
export const TETRACTYS_WEIGHTS=[1,2,3,4] as const;
// The generated grammar uses open CV/CCV syllables; lexical words keep their authored pronunciation.
export const openSyllables=(form:string)=>form.match(/[^ΑΕΗΙΟΥΩ]*[ΑΕΗΙΟΥΩ]/g)??[];
export const phoneme=(letter:string)=>({Η:'Ε',Υ:'Ι',Ω:'Ο',Θ:'Τ'}[letter]??letter);
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const nearFibonacci=(value:number)=>1/(1+Math.min(...FIBONACCI.map(n=>Math.abs(n-value))));
// Authored musical correspondence, not measured speech frequencies or a therapeutic effect.
const VOWEL_INTERVAL:Readonly<Record<string,number>>={Α:1,Ε:9/8,Η:9/8,Ι:4/3,Υ:4/3,Ο:3/2,Ω:3/2};
const CONSONANT_SONORITY:Readonly<Record<string,number>>={Μ:1,Ν:1,Λ:.95,Ρ:.9,Β:.65,Γ:.6,Δ:.6,Ζ:.5,Φ:.35,Χ:.3,Σ:.3,Θ:.25,Τ:.25,Κ:.2,Π:.2,Ξ:.15,Ψ:.15};

/** Dimensionless design scores in [0,1]. Exact isopsephy is a separate hard constraint. */
export function wordHarmony(form:string) {
    const syllables=openSyllables(form),count=syllables.length;
    const sounds=syllables.map(s=>[...s].map(phoneme).join(''));
    const vowels=[...form].filter(c=>GREEK_VOWELS.includes(c));
    const consonants=[...form].filter(c=>!GREEK_VOWELS.includes(c)).map(phoneme);
    const diversity=count?new Set(sounds).size/count:0;
    const duration=syllables.map(s=>s.length===3?2:1),beats=duration.reduce((a,b)=>a+b,0);
    const rhythm=count>1?clamp((diversity+new Set(duration).size/2+nearFibonacci(count))/3):0;
    const intervals=vowels.map(v=>VOWEL_INTERVAL[v]);
    const steps=intervals.slice(1).map((value,i)=>Math.max(value,intervals[i])/Math.min(value,intervals[i]));
    const motion=steps.length?steps.filter(ratio=>ratio>1).length/steps.length:0;
    const music=steps.length?clamp((steps.reduce((sum,ratio)=>sum+1/(1+Math.abs(Math.log2(ratio))*2),0)/steps.length+motion)/2):0;
    const golden=clamp(1-Math.abs(vowels.length/Math.max(1,form.length)-PHI**-2)/(PHI**-2));
    const fibonacci=(nearFibonacci(form.length)+nearFibonacci(count))/2;
    const accents=syllables.map(s=>[...s].filter(c=>!GREEK_VOWELS.includes(c)).reduce((sum,c)=>sum+(CONSONANT_SONORITY[c]??0),0)/Math.max(1,s.length-1));
    const peak=accents.indexOf(Math.max(...accents));
    const pivot=beats?((duration.slice(0,Math.max(0,peak)).reduce((a,b)=>a+b,0)+(duration[peak]??0)/2)/beats):0;
    const arc=clamp(1-Math.abs(pivot-PHI**-1));
    const proportion=clamp((golden+fibonacci+arc)/3);
    const voice=consonants.length?new Set(consonants).size/consonants.length:0;
    const articulation=clamp((2*diversity+voice)/3);
    const components=[articulation,rhythm,music,proportion];
    const total=components.reduce((sum,value,index)=>sum+value*TETRACTYS_WEIGHTS[index],0)/10;
    return {version:WORD_HARMONY_VERSION,syllables:count,pattern:duration,articulation,rhythm,music,golden,fibonacci,arc,total};
}

/** Fibonacci word lengths 5/8/13 carry 2/3/5 vowels: their ratio approaches φ⁻². */
export function rhythmicPatterns(preferShort=false):number[][] {
    const patterns:number[][]=[];
    for(const [count,clusters]of (preferShort?[[2,1],[3,2],[5,3]]:[[3,2],[5,3],[2,1]])){
        const visit=(sizes:number[],left:number)=>{
            if(sizes.length===count){if(!left)patterns.push(sizes.flatMap(n=>n===3?[0,0,1]:[0,1]));return;}
            const remaining=count-sizes.length;
            if(left<remaining)visit([...sizes,2],left);
            if(left>0)visit([...sizes,3],left-1);
        };
        visit([],clusters);
    }
    // Short unclustered alternatives remain available for low target sums and pronunciation preferences.
    for(const count of [2,3,5,6])patterns.push(Array.from({length:count},()=>[0,1]).flat());
    return patterns;
}
