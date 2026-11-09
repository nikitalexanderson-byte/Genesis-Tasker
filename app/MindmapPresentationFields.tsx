import { useEffect, useId, useRef, useState } from "react";
import { getRuntimeLanguage } from "./i18n";
import { mindmapCopy as c } from "./mindmap-copy";
import { MINDMAP_ICONS, MINDMAP_ICON_GROUPS, mindmapIconLabel } from "./mindmap-icons";
import { MindmapGlyph } from "./MindmapNodeContent";
import { prepareMindmapImage } from "./mindmap-image";
import type { MapNode, MapNodePresentation } from "./mindmaps-model";


export function MindmapPresentationFields({node,onChange}: {node:MapNode;onChange:(patch:Partial<MapNodePresentation>)=>void}) {
  const id=useId(),language=getRuntimeLanguage(),p=node.presentation;
  const [iconsOpen,setIconsOpen]=useState(false),[rootOpen,setRootOpen]=useState(false);
  const [search,setSearch]=useState(""),[group,setGroup]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const alive=useRef(true);
  const iconSummary=useRef<HTMLElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const filtered=MINDMAP_ICONS.filter(icon=>(!group||icon.group===group)&&`${mindmapIconLabel(icon.id,language)} ${mindmapIconLabel(icon.id,"en")} ${mindmapIconLabel(icon.id,"ru")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectIcon=(icon?:string)=>{onChange({icon});setIconsOpen(false);requestAnimationFrame(()=>iconSummary.current?.focus());};
  return <div className="mindmap-presentation-fields" data-no-translate>
    <details className="mindmap-icon-library" open={iconsOpen} onToggle={event=>setIconsOpen(event.currentTarget.open)}>
      <summary ref={iconSummary}>{p?.icon ? <MindmapGlyph id={p.icon}/> : null}<span>{c("icon")}</span>{p?.icon ? <small data-no-translate>{mindmapIconLabel(p.icon,language)}</small> : null}</summary>
      {iconsOpen ? <div className="mindmap-icon-picker">
        <div className="mindmap-icon-filters"><label htmlFor={`${id}-search`}><span>{c("search")}</span><input id={`${id}-search`} type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
          <label htmlFor={`${id}-group`}><span>{c("group")}</span><select id={`${id}-group`} aria-label={c("group")} value={group} onChange={event=>setGroup(event.target.value)}><option value="">{c("all")}</option>{MINDMAP_ICON_GROUPS.map(value=><option key={value} value={value}>{c(value)}</option>)}</select></label></div>
        <div className="mindmap-icon-picker-actions"><button type="button" aria-pressed={!p?.icon} onClick={()=>selectIcon()}>{c("none")}</button><span data-no-translate>{filtered.length} / 100</span></div>
        {!filtered.length ? <p>{c("empty")}</p> : <div className="mindmap-icon-grid" role="group" aria-label={c("choose")}>{filtered.map(icon=><button key={icon.id} type="button" aria-label={`${c("select")} ${mindmapIconLabel(icon.id,language)}`} title={mindmapIconLabel(icon.id,language)} aria-pressed={p?.icon===icon.id} data-icon-id={icon.id} onKeyDown={event=>{
          if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
          const buttons=[...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button")],index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
          event.preventDefault();const firstTop=buttons[0].offsetTop,rowEnd=buttons.findIndex(button=>button.offsetTop!==firstTop),columns=rowEnd<0?buttons.length:rowEnd;
          const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:index+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key]??0);
          buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus();
        }} onClick={()=>selectIcon(icon.id)}><MindmapGlyph id={icon.id}/><span data-no-translate>{mindmapIconLabel(icon.id,language)}</span></button>)}</div>}
      </div> : null}
    </details>
    {node.parentId===null ? <details className="mindmap-root-options" open={rootOpen} onToggle={event=>setRootOpen(event.currentTarget.open)}><summary>{c("appearance")}</summary><div className="mindmap-root-fields">
      <label htmlFor={`${id}-align`}><span>{c("align")}</span><select id={`${id}-align`} aria-label={c("align")} value={p?.align??"left"} onChange={event=>onChange({align:event.target.value as MapNodePresentation["align"]})}><option value="left">{c("left")}</option><option value="center">{c("center")}</option><option value="right">{c("right")}</option></select></label>
      <label htmlFor={`${id}-width`}><span>{c("width")}</span><select id={`${id}-width`} aria-label={c("width")} value={p?.width??240} onChange={event=>onChange({width:Number(event.target.value) as MapNodePresentation["width"]})}><option value={240}>{c("compact")}</option><option value={320}>{c("medium")}</option><option value={400}>{c("wide")}</option></select></label>
      <label className="mindmap-presentation-check"><input type="checkbox" checked={p?.showNote??false} onChange={event=>onChange({showNote:event.target.checked})}/><span>{c("showNote")}</span></label>
      <label htmlFor={`${id}-image`} className="mindmap-image-upload"><span>{c("image")}</span><input id={`${id}-image`} aria-label={c("image")} type="file" aria-describedby={`${id}-image-help`} accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event=>{
        const input=event.currentTarget,file=input.files?.[0];if(!file)return;setBusy(true);setError("");
        try { const data=await prepareMindmapImage(file);if(alive.current)onChange({image:{data,alt:"",fit:"contain"}}); }
        catch(caught) { if(alive.current)setError(caught instanceof Error&&["invalid-type","invalid-image","too-large","prepare-failed"].includes(caught.message)?caught.message:"prepare-failed"); }
        finally { input.value="";if(alive.current)setBusy(false); }
      }}/><small id={`${id}-image-help`}>{c("imageHelp")}</small></label>
      {busy ? <p role="status">{c("preparing")}</p> : null}{error ? <p role="alert">{c(error as Parameters<typeof c>[0])}</p> : null}
      {p?.image ? <>
        <img className="mindmap-image-preview" src={p.image.data} alt={p.image.alt||node.text||c("root")}/>
        <label htmlFor={`${id}-alt`}><span>{c("alt")}</span><input id={`${id}-alt`} maxLength={240} value={p.image.alt} onChange={event=>onChange({image:{...p.image!,alt:event.target.value}})}/></label>
        <label htmlFor={`${id}-fit`}><span>{c("fit")}</span><select id={`${id}-fit`} aria-label={c("fit")} value={p.image.fit} onChange={event=>onChange({image:{...p.image!,fit:event.target.value as "contain"|"cover"}})}><option value="contain">{c("contain")}</option><option value="cover">{c("cover")}</option></select></label>
        <label htmlFor={`${id}-layout`}><span>{c("layout")}</span><select id={`${id}-layout`} aria-label={c("layout")} value={p.layout??"stack"} onChange={event=>onChange({layout:event.target.value as MapNodePresentation["layout"]})}><option value="stack">{c("stack")}</option><option value="side">{c("side")}</option></select></label>
        <button type="button" disabled={busy} onClick={()=>onChange({image:undefined})}>{c("remove")}</button>
      </> : null}
    </div></details> : null}
  </div>;
}
