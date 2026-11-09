"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateText } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { layoutMap, mapHomeView, mapConnection, nodeColors, type Mindmap, type MapNode, type MapView } from "./mindmaps-model";
import { MindmapNodeContent } from "./MindmapNodeContent";
import { MindmapInlineTitle } from "./MindmapInlineTitle";

export default function MindmapCanvas({ map, view, selected, selectedLink, title, onSelect, onEditNode, onSelectLink, onEditLink, onRemoveLink, onDeleteSelection, inlineNodeId, onCommitTitle, onCancelTitle, onZoom, onHome, onViewport, onPosition, onCreateAt, onLink, onContextAction, readOnly = false }: {
  map: Mindmap; view: MapView; selected: string; selectedLink: string | null; title: (node: MapNode) => string;
  onSelect: (id: string) => void; onZoom: (zoom: number) => void; onViewport: (viewport: {left:number;top:number}) => void;
  onHome: (view: MapView) => void;
  onPosition: (id:string,position:{x:number;y:number})=>void; onCreateAt:(position:{x:number;y:number})=>void;
  onLink:(from:string,to:string)=>void; onSelectLink:(id:string,from:string)=>void; onEditNode:(id:string)=>void; onDeleteSelection:()=>void;
  onEditLink: (id:string)=>void; onRemoveLink: (id:string)=>void;
  inlineNodeId: string | null; onCommitTitle:(id:string,text:string)=>void; onCancelTitle:()=>void;
  onContextAction:(action:"child"|"sibling"|"affair"|"remove"|"remove-thought"|"rename",nodeId?:string)=>void; readOnly?:boolean;
}) {
  const [moving, setMoving] = useState<{id:string;x:number;y:number} | null>(null);
  const rows = useMemo(() => layoutMap(map, view).map(row => moving?.id===row.node.id ? {...row,x:moving.x,y:moving.y} : row), [map, view, moving]);
  const scroller = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const fullscreenAvailable = typeof document !== "undefined" && document.fullscreenEnabled;
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeDrag = useRef<{id:string;clientX:number;clientY:number;x:number;y:number;active:boolean;moved:boolean;position?:{x:number;y:number}} | null>(null);
  const suppressClick = useRef(false);
  const [menu,setMenu] = useState<{left:number;top:number;x:number;y:number;nodeId?:string;linkId?:string;handle?:boolean} | null>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [connecting,setConnecting]=useState<{from:string;point?:{x:number;y:number}} | null>(null);
  const linkMoved=useRef(false);
  const linkStart=useRef({x:0,y:0});
  const touchPoints=useRef(new Map<number,{x:number;y:number}>());
  const pinch=useRef<{distance:number;zoom:number} | null>(null);
  const pinchGesture=useRef(false);
  const zoomRef=useRef(view.zoom);
  const pendingAnchor=useRef<{zoom:number;contentX:number;contentY:number;localX:number;localY:number} | null>(null);
  const pendingNavigation = useRef<{left:number;top:number} | null>(null);
  const [viewport, setViewport] = useState({ top: view.viewport?.top ?? 0, height: 800 });
  useEffect(() => {
    const canvas = scroller.current, surface = canvas?.closest<HTMLElement>(".mindmaps");
    if (!canvas || !surface) return;
    const changed = () => {
      const active = document.fullscreenElement === surface;
      setFullscreen(active);
      if (!active) fullscreenButton.current?.focus({ preventScroll: true });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.fullscreenElement !== surface
        || [...surface.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(dialog => dialog.getClientRects().length > 0)) return;
      event.preventDefault();
      void document.exitFullscreen().catch(() => setFullscreenError(true));
    };
    // Fullscreen changes the visible window, including the rows of large maps.
    const observer = new ResizeObserver(() => setViewport({ top: canvas.scrollTop, height: canvas.clientHeight }));
    observer.observe(canvas);
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", escape);
    return () => {
      observer.disconnect(); document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", escape);
      if (document.fullscreenElement === surface) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggleFullscreen = async () => {
    const surface = scroller.current?.closest<HTMLElement>(".mindmaps");
    if (!surface || !fullscreenAvailable) return;
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === surface) await document.exitFullscreen();
      else await surface.requestFullscreen();
    } catch { setFullscreenError(true); }
  };
  const fullscreenLabel = translateText(fullscreen ? "Выйти из полноэкранного режима" : "На весь экран");
  useEffect(() => { zoomRef.current=view.zoom; }, [view.zoom]);
  const zoomAt=useCallback((zoom:number,clientX:number,clientY:number)=>{
    const el=scroller.current;if(!el)return;
    const next=Math.max(.4,Math.min(2,zoom));if(Math.abs(next-zoomRef.current)<.001)return;
    const rect=el.getBoundingClientRect(),localX=clientX-rect.left,localY=clientY-rect.top;
    pendingAnchor.current={zoom:next,contentX:(el.scrollLeft+localX)/zoomRef.current,contentY:(el.scrollTop+localY)/zoomRef.current,localX,localY};
    zoomRef.current=next;onZoom(next);
  },[onZoom]);
  useLayoutEffect(()=>{
    const anchor=pendingAnchor.current,el=scroller.current;
    if(anchor&&el&&Math.abs(anchor.zoom-view.zoom)<.001){
      el.scrollTo({left:anchor.contentX*view.zoom-anchor.localX,top:anchor.contentY*view.zoom-anchor.localY,behavior:"instant"});
      pendingAnchor.current=null;
    }
  },[view.zoom]);
  useLayoutEffect(() => {
    const target = pendingNavigation.current, el = scroller.current;
    if (!target || !el) return;
    el.scrollTo({ ...target, behavior: "instant" });
    setViewport({ top: el.scrollTop, height: el.clientHeight });
    pendingNavigation.current = null;
  }, [view.zoom, view.focus, rows]);
  useEffect(()=>{
    const el=scroller.current;if(!el)return;
    const wheel=(event:WheelEvent)=>{
      if(event.shiftKey&&!event.ctrlKey)return;
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
      zoomAt(zoomRef.current*Math.exp(-delta*.0015),event.clientX,event.clientY);
    };
    el.addEventListener("wheel",wheel,{passive:false});
    return()=>el.removeEventListener("wheel",wheel);
  },[zoomAt]);
  const endTouch=(id:number)=>{touchPoints.current.delete(id);if(touchPoints.current.size<2)pinch.current=null;if(!touchPoints.current.size)drag.current=null;};
  useEffect(() => {
    // Decryption may finish after the canvas first mounts. Restore after layout
    // and again when the persisted coordinates arrive, not only on map ID changes.
    const frame = requestAnimationFrame(() => scroller.current?.scrollTo({
      left: view.viewport?.left ?? 0, top: view.viewport?.top ?? 0, behavior: "instant",
    }));
    return () => cancelAnimationFrame(frame);
  }, [map.id, view.viewport?.left, view.viewport?.top]);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); if(holdTimer.current)clearTimeout(holdTimer.current); }, []);
  useEffect(() => {
    if (!inlineNodeId) return;
    const frame = requestAnimationFrame(() => {
      const node = scroller.current?.querySelector<HTMLElement>('.mindmap-inline-node');
      node?.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
    });
    return () => cancelAnimationFrame(frame);
  }, [inlineNodeId]);
  useEffect(()=>{ if(!menu)return;menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();const close=(e:PointerEvent)=>{if(!(e.target as Element).closest('.mindmap-context-menu'))setMenu(null);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close); },[menu]);
  useLayoutEffect(()=>{if(!menu||!menuRef.current)return;const clamp=()=>{if(!menuRef.current)return;const rect=menuRef.current.getBoundingClientRect(),left=Math.max(8,Math.min(menu.left,innerWidth-rect.width-8)),top=Math.max(8,Math.min(menu.top,innerHeight-rect.height-8));if(left!==menu.left||top!==menu.top)setMenu({...menu,left,top});};clamp();const observer=new ResizeObserver(clamp);observer.observe(menuRef.current);return()=>observer.disconnect();},[menu]);
  const contextAt=(clientX:number,clientY:number,nodeId?:string,linkId?:string,handle=false)=>{const el=scroller.current!;const rect=el.getBoundingClientRect();if(nodeId)onSelect(nodeId);if(linkId){const link=map.links.find(item=>item.id===linkId);if(link)onSelectLink(linkId,link.from);}setMenu({left:Math.max(0,Math.min(clientX,window.innerWidth-210)),top:Math.max(0,Math.min(clientY,window.innerHeight-70)),x:Math.max(0,(clientX-rect.left+el.scrollLeft)/view.zoom),y:Math.max(0,(clientY-rect.top+el.scrollTop)/view.zoom),nodeId,linkId,handle});};
  const finishNode=(cancel=false)=>{if(holdTimer.current)clearTimeout(holdTimer.current);const current=nodeDrag.current;if(current?.moved)suppressClick.current=true;if(!cancel&&current?.position)onPosition(current.id,current.position);nodeDrag.current=null;setMoving(null);};
  const width = Math.max(...rows.map(r => r.x+r.width)) + 48; const height = Math.max(...rows.map(r=>r.y+r.height)) + 88;
  const byId = new Map(rows.map(r => [r.node.id, r]));
  // Large documents keep their geometry, but only visible buttons need DOM/layout.
  // Structure remains a complete native list for keyboard and assistive navigation.
  const paintedRows = rows.length <= 200 ? rows : rows.filter(r => r.node.id === selected
    || (r.y + r.height >= viewport.top / view.zoom - 200 && r.y <= (viewport.top + viewport.height) / view.zoom + 200));
  return <div className="mindmap-canvas-wrap">
    <div className="mindmap-canvas-zoom" role="group" aria-label="Масштаб карты">
      <button type="button" disabled={view.zoom <= .4} onClick={() => onZoom(Math.max(.4, view.zoom - .2))} aria-label="Уменьшить масштаб">−</button>
      <span>{Math.round(view.zoom * 100)}%</span>
      <button type="button" disabled={view.zoom >= 2} onClick={() => onZoom(Math.min(2, view.zoom + .2))} aria-label="Увеличить масштаб">+</button>
    </div>
    {selectedLink && map.links.some(link=>link.id===selectedLink) ? <div className="mindmap-selected-link-actions" role="group" aria-label="Действия со связью">
      <button type="button" onClick={()=>onEditLink(selectedLink)}><ExperimentalIcon name="gear"/><span>Настроить связь</span></button>
      <button type="button" disabled={readOnly} onClick={()=>onRemoveLink(selectedLink)}><ExperimentalIcon name="delete"/><span>Удалить связь</span></button>
    </div> : null}
    {/* Keyboard focus permits native arrow-key scrolling of this bounded canvas. */}
    {/* Interactive graphical editor; Structure supplies the alternative list semantics. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
    <div className="mindmap-canvas" ref={scroller} tabIndex={0} role="application" aria-label="Полотно карты: прокрутка и перемещение по пустому месту"
      onPointerDownCapture={e=>{if(e.pointerType!=="touch")return;if(!touchPoints.current.size)pinchGesture.current=false;touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touchPoints.current.size===2){const [a,b]=[...touchPoints.current.values()];pinch.current={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:zoomRef.current};pinchGesture.current=true;suppressClick.current=true;linkMoved.current=true;drag.current=null;nodeDrag.current=null;setMoving(null);}}}
      onPointerMoveCapture={e=>{if(e.pointerType!=="touch"||!touchPoints.current.has(e.pointerId))return;touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinch.current&&touchPoints.current.size>=2){e.preventDefault();const [a,b]=[...touchPoints.current.values()];zoomAt(pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance,(a.x+b.x)/2,(a.y+b.y)/2);}}}
      onPointerUpCapture={e=>{if(e.pointerType==="touch")endTouch(e.pointerId);}}
      onPointerCancelCapture={e=>{if(e.pointerType==="touch")endTouch(e.pointerId);}}
      onScroll={e => { setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight }); if(scrollTimer.current) clearTimeout(scrollTimer.current); scrollTimer.current=setTimeout(()=>{if(scroller.current)onViewport({left:scroller.current.scrollLeft,top:scroller.current.scrollTop});},180); }}
      onContextMenu={e=>{if((e.target as Element).closest('input,textarea'))return;const target=(e.target as Element).closest<HTMLElement>('[data-map-node-id]');if(!target&&(e.target as Element).closest('button'))return;e.preventDefault();contextAt(e.clientX,e.clientY,target?.dataset.mapNodeId);}}
      onDoubleClick={e=>{if(readOnly||(e.target as Element).closest('button,input,textarea,[data-map-link-id]'))return;e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();onCreateAt({x:Math.max(0,(e.clientX-rect.left+e.currentTarget.scrollLeft)/view.zoom),y:Math.max(0,(e.clientY-rect.top+e.currentTarget.scrollTop)/view.zoom)});}}
      onClick={e=>{if(!(e.target as Element).closest('button'))suppressClick.current=false;}}
      onKeyDown={e=>{if((e.target as Element).closest('input,textarea,select,[contenteditable="true"],.mindmap-inline-title'))return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();if(!readOnly)onDeleteSelection();return;}if(e.key==='Escape'){setMenu(null);setConnecting(null);}if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const target=(e.target as Element).closest<HTMLElement>('[data-map-node-id],[data-map-link-id]');const r=(target??e.currentTarget).getBoundingClientRect();contextAt(r.left+40,r.top+40,target?.dataset.mapNodeId,target?.dataset.mapLinkId);}}}
      onPointerDown={e => { if (e.button !== 0 || pinch.current || (e.target as Element).closest('button')) return; suppressClick.current=false;const el = scroller.current!; drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }; el.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (pinch.current || !drag.current) return;if(Math.hypot(drag.current.x-e.clientX,drag.current.y-e.clientY)>6)suppressClick.current=true; scroller.current!.scrollLeft = drag.current.left + drag.current.x - e.clientX; scroller.current!.scrollTop = drag.current.top + drag.current.y - e.clientY; }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; suppressClick.current=true; }}>
      <div style={{ width: width * view.zoom, height: height * view.zoom, position: "relative" }}>
        <div className="mindmap-plane" style={{ width, height, transform: `scale(${view.zoom})`,"--mindmap-branch":map.appearance?.lineColor } as React.CSSProperties}>
          <svg width={width} height={height} role="group" aria-label="Связи узлов" style={{"--mindmap-branch":map.appearance?.lineColor} as React.CSSProperties}>
            {rows.map(r => { const p = byId.get(r.node.parentId ?? ""); if(!p)return null;const edge=mapConnection(p,r),stroke=map.appearance?.lineColor||r.node.style?.border;return <g key={r.node.id} aria-hidden="true"><path style={{stroke}} d={edge.path}/>{[edge.start,edge.end].map((point,index)=><circle key={index} className="mindmap-joint" cx={point.x} cy={point.y} r={6} style={{stroke}}/>)}</g>; })}
            {map.links.map(l => { const a = byId.get(l.from), b = byId.get(l.to); if(!a||!b)return null;const edge=mapConnection(a,b),path=edge.path;return <g key={l.id} data-map-link-id={l.id} className="mindmap-semantic-link" role="button" tabIndex={0} aria-label={`${translateText("Выбрать связь:")} ${title(a.node)} — ${title(b.node)}`} aria-pressed={selectedLink===l.id}
              onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();event.currentTarget.focus();onSelectLink(l.id,l.from);}}
              onDoubleClick={event=>{event.preventDefault();event.stopPropagation();onEditLink(l.id);}}
              onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();event.stopPropagation();onEditLink(l.id);}else if(event.key===" "){event.preventDefault();event.stopPropagation();onSelectLink(l.id,l.from);}else if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();event.stopPropagation();if(!readOnly)onRemoveLink(l.id);}}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();contextAt(event.clientX,event.clientY,undefined,l.id);}}>
              <path className="mindmap-semantic" style={{stroke:l.color}} d={path}/><path className="mindmap-semantic-hit" d={path}/><text aria-hidden="true" x={edge.start.x+8} y={edge.start.y+20}>{l.label || "Связано с"}</text>
            </g>; })}
            {connecting?.point && byId.get(connecting.from) ? <path className="mindmap-semantic" aria-hidden="true" d={`M${byId.get(connecting.from)!.x+byId.get(connecting.from)!.width} ${byId.get(connecting.from)!.y+byId.get(connecting.from)!.height/2} L${connecting.point.x} ${connecting.point.y}`}/> : null}
          </svg>
          {paintedRows.map(r => inlineNodeId===r.node.id ? <div key={r.node.id} data-map-node-id={r.node.id} className="mindmap-graph-node mindmap-inline-node" style={{left:r.x,top:r.y,width:r.width,minHeight:r.height,...nodeColors(r.node)}}>
            <MindmapInlineTitle title={r.node.text ?? ""} onCommit={text=>onCommitTitle(r.node.id,text)} onCancel={onCancelTitle}/>
          </div> : <button key={r.node.id} type="button" className={`mindmap-graph-node${r.node.parentId===null&&r.node.presentation ? " mindmap-graph-root" : ""}`} aria-pressed={selected === r.node.id && !selectedLink}
            data-map-node-id={r.node.id} data-map-root={r.node.parentId===null?"true":undefined} style={{ left: r.x, top: r.y,width:r.width,height:r.height,zIndex:moving?.id===r.node.id ? 10 : selected===r.node.id ? 3 : 1,...nodeColors(r.node) }} onClick={() => {if(suppressClick.current){suppressClick.current=false;return;}if(connecting){if(connecting.from!==r.node.id)onLink(connecting.from,r.node.id);setConnecting(null);}else onSelect(r.node.id);}} title={title(r.node)}
            onDoubleClick={e=>{e.preventDefault();if(!connecting)onEditNode(r.node.id);}}
            onPointerDown={e=>{if(e.button!==0||pinch.current)return;e.stopPropagation();setMenu(null);suppressClick.current=false;e.currentTarget.setPointerCapture(e.pointerId);nodeDrag.current={id:r.node.id,clientX:e.clientX,clientY:e.clientY,x:r.x,y:r.y,active:e.pointerType==='mouse',moved:false};if(e.pointerType!=='mouse')holdTimer.current=setTimeout(()=>{if(nodeDrag.current)nodeDrag.current.active=true;},350);}}
            onPointerMove={e=>{if(pinch.current)return;const d=nodeDrag.current;if(!d||d.id!==r.node.id)return;const dx=e.clientX-d.clientX,dy=e.clientY-d.clientY;if(Math.hypot(dx,dy)<6&&!d.moved)return;d.moved=true;if(!d.active){if(holdTimer.current)clearTimeout(holdTimer.current);scroller.current!.scrollLeft-=dx;scroller.current!.scrollTop-=dy;d.clientX=e.clientX;d.clientY=e.clientY;return;}e.preventDefault();d.position={x:Math.max(0,Math.min(100000,d.x+dx/view.zoom)),y:Math.max(0,Math.min(100000,d.y+dy/view.zoom))};setMoving({id:d.id,...d.position});}}
            onPointerUp={()=>finishNode()} onPointerCancel={()=>finishNode(true)} onLostPointerCapture={()=>{if(nodeDrag.current)finishNode(true);}}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();onEditNode(r.node.id);return;}if(e.key==='F2'&&!readOnly&&r.node.kind==='idea'){e.preventDefault();onContextAction("rename",r.node.id);return;}if(!e.altKey)return;const delta=({ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]} as Record<string,number[]>)[e.key];if(delta&&!readOnly){e.preventDefault();onPosition(r.node.id,{x:Math.max(0,r.x+delta[0]),y:Math.max(0,r.y+delta[1])});}}}>
            <MindmapNodeContent node={r.node} title={title(r.node)}/>
            {r.node.tags?.length ? <span className="mindmap-node-tags" aria-label="Теги">{r.node.tags.slice(0,3).map(tag=><span className="mindmap-node-tag" key={tag}>#{tag}</span>)}{r.node.tags.length>3 ? <span className="mindmap-node-tag">+{r.node.tags.length-3}</span> : null}</span> : null}
            {r.node.kind !== "idea" && !r.node.tags?.length ? <small>{r.node.kind === "task" ? "Задача GENESIS" : "Проект GENESIS"}</small> : null}
            {view.collapsed.includes(r.node.id) ? <small>Ветка свёрнута</small> : null}
          </button>)}
          {paintedRows.filter(r=>r.node.id!==inlineNodeId).map(r=><button type="button" key={`link-${r.node.id}`} data-map-node-id={r.node.id} className="mindmap-connect-handle" disabled={readOnly} aria-label={`${translateText("Действия с мыслью") + ":"} ${title(r.node)}`} title="Действия с мыслью" aria-pressed={connecting?.from===r.node.id} style={{left:r.x+r.width-22,top:r.y+r.height/2-22,zIndex:moving?.id===r.node.id ? 11 : selected===r.node.id ? 4 : 2}} onClick={event=>{if(pinchGesture.current){pinchGesture.current=false;linkMoved.current=false;return;}if(linkMoved.current){linkMoved.current=false;return;}if(connecting?.from&&connecting.from!==r.node.id){onLink(connecting.from,r.node.id);setConnecting(null);}else{const rect=event.currentTarget.getBoundingClientRect();contextAt(rect.left,rect.bottom,r.node.id,undefined,true);}}}
            onPointerDown={e=>{if(e.button!==0||pinch.current)return;e.stopPropagation();linkMoved.current=false;linkStart.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
            onPointerMove={e=>{if(pinch.current||!e.currentTarget.hasPointerCapture(e.pointerId)||Math.hypot(e.clientX-linkStart.current.x,e.clientY-linkStart.current.y)<6)return;linkMoved.current=true;const rect=scroller.current!.getBoundingClientRect();setConnecting({from:r.node.id,point:{x:(e.clientX-rect.left+scroller.current!.scrollLeft)/view.zoom,y:(e.clientY-rect.top+scroller.current!.scrollTop)/view.zoom}});}}
            onPointerUp={e=>{if(pinchGesture.current||!linkMoved.current)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-map-node-id]')?.dataset.mapNodeId;if(target&&target!==r.node.id){onLink(r.node.id,target);onSelect(r.node.id);}setConnecting(null);}} onPointerCancel={()=>setConnecting(null)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2"/></svg></button>)}
        </div>
      </div>
    </div>
    <div className="mindmap-canvas-navigation">
      <button type="button" className="mindmap-canvas-action" aria-label="К началу" onClick={() => {
        pendingAnchor.current = null;
        if (scrollTimer.current) clearTimeout(scrollTimer.current);
        const next = mapHomeView(map, view);
        pendingNavigation.current = next.viewport!;
        zoomRef.current = 1;
        setMenu(null); setConnecting(null);
        onSelect(map.nodes.find(node => node.parentId === null)!.id);
        onHome(next);
      }}><ExperimentalIcon name="map-home"/></button>
      <button type="button" className="mindmap-canvas-action" aria-label="К выбранному узлу" onClick={() => {
        const row = byId.get(selected);
        if (row) scroller.current?.scrollTo({ left: Math.max(0, row.x * view.zoom - 24), top: Math.max(0, row.y * view.zoom - 24), behavior: "instant" });
      }}><ExperimentalIcon name="thought-focus"/></button>
      <button ref={fullscreenButton} type="button" className="mindmap-canvas-action mindmap-fullscreen-toggle" disabled={!fullscreenAvailable}
        aria-label={fullscreenLabel} title={fullscreenLabel} aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>
        <ExperimentalIcon name={fullscreen ? "minimize" : "maximize"}/>
      </button>
    </div>
    {fullscreenError ? <p className="mindmap-fullscreen-error" role="alert">{translateText("Не удалось изменить полноэкранный режим. Повторите попытку.")}</p> : null}
    {connecting ? <p role="status">Выберите вторую карточку для связи. Escape отменяет соединение.</p> : null}
    {menu ? <div ref={menuRef} className="mindmap-context-menu" role="menu" tabIndex={-1} aria-label="Действия на полотне" style={{left:menu.left,top:menu.top}} onKeyDown={e=>{
      if(menu.linkId&&!readOnly&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();onRemoveLink(menu.linkId);setMenu(null);scroller.current?.focus();return;}
      if(e.key==='Escape'){setMenu(null);scroller.current?.focus();}
      if(e.key==='Tab')setMenu(null);
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
    }}>{menu.linkId ? <>
      <button type="button" role="menuitem" onClick={()=>{onEditLink(menu.linkId!);setMenu(null);}}><ExperimentalIcon name="gear"/><span>Настроить связь</span></button>
      <button type="button" role="menuitem" className="danger" disabled={readOnly} onClick={()=>{onRemoveLink(menu.linkId!);setMenu(null);scroller.current?.focus();}}><ExperimentalIcon name="delete"/><span>Удалить связь</span></button>
    </> : menu.nodeId ? <>
      <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{setConnecting({from:menu.nodeId!});setMenu(null);}}><ExperimentalIcon name="thought-link"/><span>Связать с другой мыслью</span></button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{onContextAction("child",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="thought-child"/><span>Добавить дочернюю мысль</span></button>
      <button type="button" role="menuitem" disabled={readOnly||!map.nodes.find(node=>node.id===menu.nodeId)?.parentId} onClick={()=>{onContextAction("sibling",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="thought-sibling"/><span>Добавить соседнюю мысль</span></button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{onContextAction("affair",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="thought-affair"/><span>Добавить из дел</span></button>
      {!menu.handle ? <>
      {map.nodes.find(node=>node.id===menu.nodeId)?.kind==="idea" ? <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{onContextAction("rename",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="edit"/><span>Переименовать</span></button> : null}
      <button type="button" role="menuitem" onClick={()=>{onEditNode(menu.nodeId!);setMenu(null);}}><ExperimentalIcon name="edit"/><span>Редактировать</span></button>
      <hr/>
      <button type="button" role="menuitem" onClick={()=>{onHome({...view,focus:view.focus?null:menu.nodeId!});setMenu(null);}}><ExperimentalIcon name={view.focus?"map-mode":"thought-focus"}/><span>{view.focus?"Вся карта":"Фокус на ветке"}</span></button>
      <button type="button" role="menuitem" onClick={()=>{onHome({...view,collapsed:view.collapsed.includes(menu.nodeId!)?view.collapsed.filter(id=>id!==menu.nodeId):[...view.collapsed,menu.nodeId!]});setMenu(null);}}><ExperimentalIcon name="thought-fold"/><span>{view.collapsed.includes(menu.nodeId!)?"Развернуть ветку":"Свернуть ветку"}</span></button>
      <hr/>
      {map.nodes.find(node=>node.id===menu.nodeId)?.kind==="idea" ? <button type="button" role="menuitem" className="danger" disabled={readOnly||!map.nodes.find(node=>node.id===menu.nodeId)?.parentId} onClick={()=>{onContextAction("remove-thought",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="delete"/><span>Удалить мысль</span></button> : null}
      <button type="button" role="menuitem" className="danger" disabled={readOnly||!map.nodes.find(node=>node.id===menu.nodeId)?.parentId} onClick={()=>{onContextAction("remove",menu.nodeId);setMenu(null);}}><ExperimentalIcon name="thought-unlink"/><span>Убрать ветку с карты</span></button>
      </> : null}
    </> : <>
      <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{onCreateAt({x:menu.x,y:menu.y});setMenu(null);}}><ExperimentalIcon name="thought-new"/><span>Добавить мысль</span></button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={()=>{onContextAction("affair");setMenu(null);}}><ExperimentalIcon name="thought-affair"/><span>Добавить из дел</span></button>
      {view.focus?<button type="button" role="menuitem" onClick={()=>{onHome({...view,focus:null});setMenu(null);}}><ExperimentalIcon name="map-mode"/><span>Вся карта</span></button>:null}
      <button type="button" role="menuitem" onClick={()=>{onHome(mapHomeView(map,view));setMenu(null);}}><ExperimentalIcon name="map-home"/><span>К началу</span></button>
    </>}</div> : null}
  </div>;
}
