import { useState, type CSSProperties } from "react";
import { mindmapCopy } from "./mindmap-copy";
import { mindmapIconPath } from "./mindmap-icons";
import type { MapNode } from "./mindmaps-model";

export function MindmapGlyph({ id }: { id: string }) {
  return <span aria-hidden="true" className="mindmap-node-icon" style={{maskImage:`url("${mindmapIconPath(id)}")`,WebkitMaskImage:`url("${mindmapIconPath(id)}")`} as CSSProperties}/>;
}
export function MindmapNodeContent({ node, title, compact=false }: { node: MapNode; title:string; compact?:boolean }) {
  const p=node.presentation,root=node.parentId===null;
  const [failedImage,setFailedImage]=useState<string|null>(null);
  return <div className={`mindmap-node-content${root&&p&&!compact?" mindmap-root-content":""}${p?.image&&p.layout==="side"&&!compact?" mindmap-content-side":""}${compact?" mindmap-content-compact":""}`} data-align={root?p?.align:undefined}>
    {p?.image ? <div className="mindmap-node-image">{failedImage===p.image.data ? <span data-no-translate>{mindmapCopy("unavailable")}</span> : <img src={p.image.data} alt={p.image.alt||title} draggable={false} style={{objectFit:p.image.fit}} onError={()=>setFailedImage(p.image!.data)}/>}</div> : null}
    <div className="mindmap-node-copy"><div className="mindmap-node-heading">{p?.icon ? <MindmapGlyph id={p.icon}/> : null}<strong data-no-translate>{title}</strong></div>
      {root&&p?.showNote&&node.note&&!compact ? <p className="mindmap-node-note" data-no-translate title={node.note}>{node.note}</p> : null}
    </div>
  </div>;
}
