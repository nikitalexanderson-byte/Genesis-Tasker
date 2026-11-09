import {useLayoutEffect,useRef} from 'react';

/** Fit the complete authored name to its container without breaking words or clipping it. */
export function SingleLineTitle({text,className}:{text:string;className:string}) {
  const ref=useRef<HTMLSpanElement>(null);
  // Reserve a fitting line even before the webfont has loaded; then measure the actual glyphs.
  const units=[...text].reduce((sum,char)=>sum+(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)?2:1),0);
  const preferredSize=`clamp(12px,${(160/Math.max(1,units)).toFixed(3)}cqw,1em)`;
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const fit=()=>{
      element.style.fontSize=preferredSize;
      const width=element.clientWidth,preferred=parseFloat(getComputedStyle(element).fontSize);
      const range=document.createRange();range.selectNodeContents(element);
      const measured=range.getBoundingClientRect().width;
      if(width>0&&measured>width)element.style.fontSize=`${Math.max(12,Math.floor(preferred*(width-1)/measured))}px`;
    };
    fit();const frame=requestAnimationFrame(fit);
    const observer=new ResizeObserver(fit);if(element.parentElement)observer.observe(element.parentElement);
    document.fonts.addEventListener('loadingdone',fit);
    let live=true;void document.fonts.ready.then(()=>{if(live)fit();});
    void document.fonts.load(getComputedStyle(element).font,text).then(()=>{if(live)fit();}).catch(()=>{});
    return()=>{live=false;cancelAnimationFrame(frame);observer.disconnect();document.fonts.removeEventListener('loadingdone',fit);};
  },[text,preferredSize]);
  return <span ref={ref} className={className} style={{whiteSpace:'nowrap',fontSize:preferredSize}}>{text}</span>;
}
