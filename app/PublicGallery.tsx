"use client";
/* eslint-disable @next/next/no-img-element -- Static screenshots stay lazy and preserve their full frame. */
import {useEffect,useRef,useState} from 'react';
import {publicGalleryCopy,publicGalleryItems} from './public-gallery';

export function PublicGallery({language,title}:{language:string;title:string}) {
  const copy=publicGalleryCopy(language),items=publicGalleryItems(language);
  const track=useRef<HTMLDivElement>(null);
  const [playing,setPlaying]=useState(()=>typeof matchMedia!=='undefined'&&!matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hovered=useRef(false);
  useEffect(()=>{
    const element=track.current;if(!element)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const changed=()=>{if(reduced.matches)setPlaying(false);};
    reduced.addEventListener('change',changed);
    let visible=false,frame=0,last=0,direction=1;
    let position=element.scrollLeft,rendered=position;
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;},{threshold:0.1});observer.observe(element);
    const tick=(now:number)=>{
      const elapsed=last?Math.min(now-last,64):0;last=now;
      if(playing&&visible&&!document.hidden&&!hovered.current&&!element.contains(document.activeElement)){
        const end=element.scrollWidth-element.clientWidth;
        if(end>0){
          if(Math.abs(element.scrollLeft-rendered)>.5)position=element.scrollLeft;
          if(position>=end)direction=-1;
          else if(position<=0)direction=1;
          // Keep subpixel progress: browsers may round each scrollLeft assignment.
          position=Math.max(0,Math.min(end,position+direction*elapsed*0.018));
          element.scrollLeft=position;
          rendered=element.scrollLeft;
        }
      }else {position=element.scrollLeft;rendered=position;}
      frame=requestAnimationFrame(tick);
    };
    if(playing)frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();reduced.removeEventListener('change',changed);};
  },[playing,language]);
  const move=(direction:number)=>{
    setPlaying(false);
    track.current?.scrollBy({left:direction*(track.current.clientWidth*0.85),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  };
  return <div className="public-gallery" aria-label={title}>
    <div className="public-gallery-controls">
      <button type="button" onClick={()=>move(-1)} aria-label={copy.previous} title={copy.previous}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button>
      <button className="public-gallery-play" type="button" onClick={()=>setPlaying(value=>!value)} aria-pressed={playing}>{playing?copy.pause:copy.play}</button>
      <button type="button" onClick={()=>move(1)} aria-label={copy.next} title={copy.next}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5 7 7-7 7"/></svg></button>
    </div>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- A labelled horizontal scroll region needs keyboard focus and arrow scrolling. */}
    <div className="public-previews" ref={track} tabIndex={0} role="region" aria-label={title}
      onPointerEnter={()=>{hovered.current=true;}} onPointerLeave={()=>{hovered.current=false;}}
      onPointerDown={()=>setPlaying(false)} onWheel={()=>setPlaying(false)} onFocus={()=>setPlaying(false)}
      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}}}>
      {items.map((item,index)=><figure key={`${language}:${item.id}`}><a href={item.src} target="_blank" rel="noreferrer"><img src={item.src} alt={item.caption} width={1440} height={1000} loading="lazy" decoding="async" /></a><figcaption><span aria-hidden="true">{String(index+1).padStart(2,'0')} / 20</span>{item.caption}</figcaption></figure>)}
    </div>
  </div>;
}
