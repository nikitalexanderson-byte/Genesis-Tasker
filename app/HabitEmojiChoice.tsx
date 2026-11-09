import {useEffect, useRef, useState} from 'react';
import {emojiVariants, emojiVariantKey} from './emoji-variants';
import copy from './emoji-variant-copy.json';
import type {Language} from './i18n';

export function HabitEmojiChoice({emoji,value,language,onChange}:{emoji:string;value:string;language:Language;onChange:(value:string)=>void}) {
  const variants=emojiVariants(emoji),hasVariants=variants.length>1,selected=emojiVariantKey(emoji)===emojiVariantKey(value);
  const [position,setPosition]=useState<{left:number;top:number}|null>(null);
  const button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),held=useRef(false),point=useRef({x:0,y:0});
  const labels=(copy as Record<string,string[]>)[language]??copy.en;
  const cancelHold=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
  const close=()=>{setPosition(null);requestAnimationFrame(()=>button.current?.focus({preventScroll:true}));};
  const show=()=>{const box=button.current?.getBoundingClientRect();if(!box)return;setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-252)),top:box.bottom+112<window.innerHeight?box.bottom+6:Math.max(12,box.top-112)});};
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  useEffect(()=>{
    if(!position)return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"],button')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setPosition(null);};
    const reposition=()=>setPosition(null);
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
  },[position]);
  return <span className="habit-emoji-choice">
    <button ref={button} type="button" className={selected?'selected':''} aria-label={selected?value:emoji} aria-pressed={selected} aria-haspopup={hasVariants?'dialog':undefined} aria-expanded={hasVariants?Boolean(position):undefined} title={hasVariants?labels[1]:undefined}
      onPointerDown={event=>{if(!hasVariants||event.button!==0)return;cancelHold();held.current=false;point.current={x:event.clientX,y:event.clientY};timer.current=setTimeout(()=>{held.current=true;show();},450);}}
      onPointerMove={event=>{if(Math.hypot(event.clientX-point.current.x,event.clientY-point.current.y)>10)cancelHold();}}
      onPointerUp={cancelHold} onPointerCancel={()=>{cancelHold();held.current=false;}}
      onContextMenu={event=>{if(hasVariants){event.preventDefault();cancelHold();show();}}}
      onKeyDown={event=>{if(hasVariants&&['ArrowDown','ContextMenu'].includes(event.key)){event.preventDefault();show();}}}
      onClick={()=>{if(held.current){held.current=false;return;}if(position){close();return;}onChange(selected?value:emoji);}}>
      {selected?value:emoji}{hasVariants?<svg className="habit-emoji-variants-mark" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 2l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>:null}
    </button>
    {position?<div ref={menu} className="habit-emoji-variants" role="dialog" aria-label={labels[0]} style={position} data-no-translate>
      <strong>{labels[0]}</strong><div>{variants.map(variant=><button key={variant} type="button" aria-label={variant} aria-pressed={value===variant} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}}} onClick={()=>{onChange(variant);close();}}>{variant}</button>)}</div>
    </div>:null}
  </span>;
}
