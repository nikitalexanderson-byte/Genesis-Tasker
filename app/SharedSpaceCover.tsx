/* eslint-disable @next/next/no-img-element -- Authenticated, user-uploaded covers. */
"use client";
import { useRef, useState, type CSSProperties } from "react";
export type CoverPosition = {x:number;y:number};
export type SpaceCoverDraft = {coverImage?:string;coverPosition:CoverPosition};
export function SharedSpaceCover({src,position,className=""}:{src:string;position?:CoverPosition;className?:string}) {
  return <img className={`shared-space-cover ${className}`} src={src} alt="" draggable={false} style={{objectPosition:`${position?.x??50}% ${position?.y??50}%`}}/>;
}
export function SharedSpaceCoverEditor({src,value,onChange,english,disabled,onLoadingChange}:{src:string;value:SpaceCoverDraft;onChange:(value:SpaceCoverDraft)=>void;english:boolean;disabled:boolean;onLoadingChange:(value:boolean)=>void}) {
  const [format,setFormat]=useState<"desktop"|"tablet"|"phone">("desktop");
  const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const generation=useRef(0);
  const drag=useRef<{x:number;y:number;position:CoverPosition;overflowX:number;overflowY:number}|null>(null);
  const image=value.coverImage===undefined ? src : value.coverImage;
  const move=(position:CoverPosition)=>onChange({...value,coverPosition:{x:Math.max(0,Math.min(100,position.x)),y:Math.max(0,Math.min(100,position.y))}});
  const choose=async(file:File)=>{
    const version=++generation.current;setError("");
    if(!["image/jpeg","image/png"].includes(file.type)||file.size>3*1024*1024){setError(english ? "Choose a JPG or PNG up to 3 MB." : "Выберите JPG или PNG размером до 3 МБ.");return;}
    setLoading(true);onLoadingChange(true);
    try {
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error("read"));reader.readAsDataURL(file);});
      const preview=new Image();preview.src=data;await preview.decode();
      if(preview.naturalWidth*preview.naturalHeight>40000000)throw Error("size");
      if(version===generation.current)onChange({coverImage:data,coverPosition:{x:50,y:50}});
    }catch{if(version===generation.current)setError(english ? "Could not open the image. Choose another JPG or PNG." : "Не удалось открыть изображение. Выберите другой JPG или PNG.");}
    finally{if(version===generation.current){setLoading(false);onLoadingChange(false);}}
  };
  return <fieldset className="shared-space-cover-editor" disabled={disabled||loading}><legend>{english ? "Workspace cover" : "Обложка пространства"}</legend>
    <label>{english ? "JPG or PNG, up to 3 MB" : "JPG или PNG, до 3 МБ"}<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void choose(file);}}/></label>
    {error ? <p role="alert">{error}</p> : null}{loading ? <p role="status">{english ? "Opening image…" : "Открываем изображение…"}</p> : null}
    {image ? <><div className="shared-cover-formats" role="group" aria-label={english ? "Preview format" : "Формат предпросмотра"}>{(["desktop","tablet","phone"] as const).map(item=><button type="button" key={item} aria-pressed={item===format} onClick={()=>setFormat(item)}>{({desktop:english ? "Desktop" : "Компьютер",tablet:english ? "Tablet" : "Планшет",phone:english ? "Phone" : "Телефон"})[item]}</button>)}</div>
      <button type="button" className="shared-cover-crop" style={{"--cover-ratio":format==="desktop" ? "3 / 1" : format==="tablet" ? "16 / 9" : "4 / 3"} as CSSProperties}
        aria-label={english ? "Move the cover. Drag or use arrow keys." : "Положение обложки. Перетащите изображение или используйте стрелки."}
        onPointerDown={event=>{if(event.button!==0||disabled)return;const img=event.currentTarget.querySelector("img")!;const rect=event.currentTarget.getBoundingClientRect();const scale=Math.max(rect.width/img.naturalWidth,rect.height/img.naturalHeight);drag.current={x:event.clientX,y:event.clientY,position:value.coverPosition,overflowX:img.naturalWidth*scale-rect.width,overflowY:img.naturalHeight*scale-rect.height};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{const start=drag.current;if(!start)return;move({x:start.position.x-(start.overflowX>1 ? (event.clientX-start.x)/start.overflowX*100 : 0),y:start.position.y-(start.overflowY>1 ? (event.clientY-start.y)/start.overflowY*100 : 0)});}}
        onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
        onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;event.preventDefault();move({x:value.coverPosition.x+(event.key==="ArrowRight" ? -2 : event.key==="ArrowLeft" ? 2 : 0),y:value.coverPosition.y+(event.key==="ArrowDown" ? -2 : event.key==="ArrowUp" ? 2 : 0)});}}>
        <SharedSpaceCover src={image} position={value.coverPosition}/>
      </button><p>{english ? "Drag the image to position it. Compare the same crop on each screen format." : "Двигайте изображение внутри кадра. Сравните выбранное положение на разных форматах экрана."}</p>
      <div className="shared-cover-position">{(["x","y"] as const).map(axis=><label key={axis}>{axis==="x" ? (english ? "Horizontal" : "По горизонтали") : (english ? "Vertical" : "По вертикали")}<input type="range" min="0" max="100" value={value.coverPosition[axis]} onChange={event=>move({...value.coverPosition,[axis]:Number(event.target.value)})}/></label>)}</div>
      <div className="shared-cover-previews">{["desktop","tablet","phone"].map(item=><figure className={`format-${item}`} key={item}><SharedSpaceCover src={image} position={value.coverPosition}/><figcaption>{({desktop:english ? "Desktop" : "Компьютер",tablet:english ? "Tablet" : "Планшет",phone:english ? "Phone" : "Телефон"})[item as "desktop"]}</figcaption></figure>)}</div>
      <button type="button" onClick={()=>onChange({coverImage:"",coverPosition:{x:50,y:50}})}>{english ? "Remove cover" : "Убрать обложку"}</button>
    </> : null}
  </fieldset>;
}
