import type { GenesisProject, GenesisTask } from "./cloud-sync";
import { recurrenceDatesForTask } from "./task-recurrence";
import iconLicense from "../public/mindmap-icons/LICENSE.txt?raw";
import { MINDMAP_ICON_IDS, mindmapIconVector } from "./mindmap-icons";

export const MAP_LIMITS = { nodes: 1000, depth: 32, text: 2000, note: 12000, links: 2000, bytes: 2_000_000, paste: 200 };
export type MapNodePresentation = { icon?: string; align?: "left" | "center" | "right"; width?: 240 | 320 | 400;
  layout?: "stack" | "side"; showNote?: boolean; image?: { data: string; alt: string; fit: "contain" | "cover" } };
export type MapNode = { id: string; parentId: string | null; kind: "idea" | "task" | "project";
  text?: string; refId?: string; occurrenceDate?: string; note: string; tags?: string[]; style?: {fill?:string;border?:string}; presentation?: MapNodePresentation };
export type MapLink = { id: string; from: string; to: string; label: string; color?:string };
export type Mindmap = { schemaVersion: 1; id: string; title: string; description?: string; projectId: string | null;
  pinned: boolean; archived: boolean; nodes: MapNode[]; links: MapLink[]; appearance?: {lineColor?:string} };
export type MapPoint = { x: number; y: number };
export type MapView = { mode: "map" | "structure"; collapsed: string[]; focus: string | null; zoom: number; viewport?: {left:number;top:number}; positions?: Record<string, MapPoint> };
export const mapId = () => crypto.randomUUID();
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const string = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
function invalid(): never { throw new Error("Файл карты повреждён или превышает ограничения (1000 узлов, 32 уровня, 2 МБ)."); }
const validColor = (value: unknown): value is string => typeof value === "string" && /^#[a-fA-F0-9]{6}$/.test(value);
export const MAP_IMAGE_LIMIT = 350_000;
function validMapImage(image: MapNodePresentation["image"]) {
  if (!image || typeof image !== "object" || !string(image.alt, 240) || !["contain","cover"].includes(image.fit)
    || typeof image.data !== "string" || image.data.length > MAP_IMAGE_LIMIT) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.data);
  if (!match || match[2].length % 4) return false;
  try {
    const header = atob(match[2].slice(0, 16));
    return match[1] === "png" ? header.startsWith("\x89PNG\r\n\x1a\n") : match[1] === "jpeg"
      ? header.startsWith("\xff\xd8\xff") : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  } catch { return false; }
}
function normalizePresentation(node: MapNode): MapNodePresentation | undefined {
  const p=node.presentation;
  if(p===undefined)return undefined;
  if(!p||typeof p!=="object"||Object.keys(p).some(key=>!["icon","align","width","layout","showNote","image"].includes(key))
    || p.icon!==undefined && !MINDMAP_ICON_IDS.has(p.icon)
    || p.align!==undefined && !["left","center","right"].includes(p.align)
    || p.width!==undefined && ![240,320,400].includes(p.width)
    || p.layout!==undefined && !["stack","side"].includes(p.layout)
    || p.showNote!==undefined && typeof p.showNote!=="boolean"
    || p.image!==undefined && !validMapImage(p.image)
    || node.parentId!==null && Object.keys(p).some(key=>key!=="icon"&&p[key as keyof MapNodePresentation]!==undefined)) return invalid();
  const result: MapNodePresentation={...(p.icon ? {icon:p.icon}:{}),...(p.align ? {align:p.align}:{}),...(p.width ? {width:p.width}:{}),
    ...(p.layout ? {layout:p.layout}:{}),...(p.showNote!==undefined ? {showNote:p.showNote}:{}),...(p.image ? {image:{data:p.image.data,alt:p.image.alt,fit:p.image.fit}}:{})};
  return Object.keys(result).length ? result : undefined;
}
export function mapNodeBox(node: MapNode) {
  const p=node.presentation;
  if(node.parentId!==null||!p)return {width:240,height:88};
  const width=p.width??240;
  const bodyHeight=164+(p.icon&&p.align==="center"?40:0)+(p.showNote&&node.note?60:0);
  const height=p.layout==="side"&&p.image ? Math.max(180,bodyHeight) : bodyHeight+(p.image?148:0);
  return {width,height};
}
export type MapLayoutNode = { x:number;y:number;width:number;height:number };
export function mapConnection(from: MapLayoutNode,to: MapLayoutNode) {
  const dx=to.x+to.width/2-from.x-from.width/2,dy=to.y+to.height/2-from.y-from.height/2;
  const vertical=Math.abs(dx)<Math.min(from.width,to.width)/2 && Math.abs(dy)>(from.height+to.height)/2;
  const direction=(vertical?dy:dx)>=0?1:-1;
  const start=vertical?{x:from.x+from.width/2,y:from.y+(direction>0?from.height:0)}:{x:from.x+(direction>0?from.width:0),y:from.y+from.height/2};
  const end=vertical?{x:to.x+to.width/2,y:to.y+(direction>0?0:to.height)}:{x:to.x+(direction>0?0:to.width),y:to.y+to.height/2};
  return {start,end,path:vertical?`M${start.x} ${start.y} C${start.x} ${start.y+direction*48},${end.x} ${end.y-direction*48},${end.x} ${end.y}`
    :`M${start.x} ${start.y} C${start.x+direction*48} ${start.y},${end.x-direction*48} ${end.y},${end.x} ${end.y}`};
}
export function nodeColors(node: MapNode): Record<string,string> {
  const fill=node.style?.fill;const rgb=fill ? [1,3,5].map(i=>parseInt(fill.slice(i,i+2),16)/255).map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4) : null;
  const luminance=rgb ? .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2] : 0;
  return {...(fill ? {"--mindmap-node-fill":fill,"--mindmap-node-ink":luminance>.179 ? "#000000" : "#ffffff"} : {}),...(node.style?.border ? {"--mindmap-node-border":node.style.border} : {})};
}

/** Construct a clean document: imported fields never become permissions, HTML or task data. */
export function validateMindmap(input: unknown): Mindmap {
  if (!input || typeof input !== "object") return invalid();
  const m = input as Mindmap;
  if (m.schemaVersion !== 1) throw new Error("Эта версия карты не поддерживается. Обновите приложение; файл не изменён.");
  if (!validId(m.id) || !string(m.title, MAP_LIMITS.text) || !m.title.trim()
    || m.description !== undefined && !string(m.description, MAP_LIMITS.note)
    || !(m.projectId === null || validId(m.projectId)) || typeof m.pinned !== "boolean" || typeof m.archived !== "boolean"
    || !Array.isArray(m.nodes) || !m.nodes.length || m.nodes.length > MAP_LIMITS.nodes
    || !Array.isArray(m.links) || m.links.length > MAP_LIMITS.links) return invalid();
  const ids = new Set<string>();
  const nodes = m.nodes.map(n => {
    if (!n || !validId(n.id) || ids.has(n.id) || !(n.parentId === null || validId(n.parentId))
      || !["idea", "task", "project"].includes(n.kind) || !string(n.note, MAP_LIMITS.note)) return invalid();
    ids.add(n.id);
    if (n.kind === "idea" && !string(n.text, MAP_LIMITS.text)) return invalid();
    if (n.kind !== "idea" && !validId(n.refId)) return invalid();
    if (n.tags !== undefined && (!Array.isArray(n.tags) || n.tags.length > 8
      || n.tags.some(tag => !string(tag, 32) || !tag.trim() || tag !== tag.trim()))) return invalid();
    if (n.style && (typeof n.style !== "object" || Object.entries(n.style).some(([key,value]) => !["fill","border"].includes(key) || !validColor(value)))) return invalid();
    if (n.occurrenceDate !== undefined && (n.kind !== "task" || !/^\d{4}-\d{2}-\d{2}$/.test(n.occurrenceDate)
      || new Date(n.occurrenceDate).toISOString().slice(0, 10) !== n.occurrenceDate)) return invalid();
    const presentation=normalizePresentation(n);
    return { id: n.id, parentId: n.parentId, kind: n.kind, note: n.note,
      ...(n.kind === "idea" ? { text: n.text! } : { refId: n.refId! }),
      ...(n.occurrenceDate ? { occurrenceDate: n.occurrenceDate } : {}),...(n.tags?.length ? { tags: [...n.tags] } : {}),...(n.style ? {style:{...n.style}} : {}),...(presentation ? {presentation}: {}) };
  });
  if (nodes.filter(n => n.parentId === null).length !== 1) return invalid();
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let parent = node.parentId;
    while (parent !== null) {
      if (!byId.has(parent) || seen.has(parent) || seen.size >= MAP_LIMITS.depth) return invalid();
      seen.add(parent); parent = byId.get(parent)!.parentId;
    }
  }
  const linkIds = new Set<string>();
  const links = m.links.map(l => {
    if (!l || !validId(l.id) || linkIds.has(l.id) || !ids.has(l.from) || !ids.has(l.to) || l.from === l.to || !string(l.label, 240)) return invalid();
    if(l.color!==undefined && !validColor(l.color)) return invalid();
    linkIds.add(l.id); return { id: l.id, from: l.from, to: l.to, label: l.label,...(l.color ? {color:l.color} : {}) };
  });
  const result: Mindmap = { schemaVersion: 1, id: m.id, title: m.title, projectId: m.projectId, pinned: m.pinned, archived: m.archived, nodes, links, ...(m.description !== undefined ? {description:m.description} : {}) };
  if(m.appearance) { if(Object.entries(m.appearance).some(([key,value])=>key!=="lineColor" || !validColor(value)))return invalid();result.appearance={...m.appearance}; }
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAP_LIMITS.bytes) return invalid();
  return result;
}

export function newMindmap(title: string, projectId: string | null = null, template = "empty", label: (source: string) => string = source => source): Mindmap {
  const root: MapNode = { id: mapId(), parentId: null, kind: "idea", text: title.trim(), note: "" };
  const templates: Record<string, string[]> = { idea: ["Замысел", "Что уже известно", "Вопросы", "Следующий шаг"],
    project: ["Результат", "Этапы", "Ресурсы", "Риски"], decision: ["Критерии", "Варианты", "За и против", "Решение"] };
  return validateMindmap({ schemaVersion: 1, id: mapId(), title: title.trim(), projectId, pinned: false, archived: false,
    nodes: [root, ...(templates[template] ?? []).map(text => ({ id: mapId(), parentId: root.id, kind: "idea", text: label(text), note: "" }))], links: [] });
}

export function descendants(map: Mindmap, id: string): Set<string> {
  const children = new Map<string | null, MapNode[]>();
  for (const n of map.nodes) { const list = children.get(n.parentId) ?? []; list.push(n); children.set(n.parentId, list); }
  const result = new Set<string>(); const pending = [id];
  while (pending.length) { const next = pending.pop()!; if (result.has(next)) continue; result.add(next); pending.push(...(children.get(next) ?? []).map(n => n.id)); }
  return result;
}
export function removeBranch(map: Mindmap, id: string): Mindmap {
  if (map.nodes.find(n => n.id === id)?.parentId === null) throw new Error("Корень нельзя убрать. Архивируйте карту из каталога.");
  const removed = descendants(map, id);
  return validateMindmap({ ...map, nodes: map.nodes.filter(n => !removed.has(n.id)), links: map.links.filter(l => !removed.has(l.from) && !removed.has(l.to)) });
}
export function removeThought(map: Mindmap, id: string): Mindmap {
  const thought = map.nodes.find(node => node.id === id);
  if (!thought || thought.kind !== "idea" || thought.parentId === null) throw new Error("Корень нельзя убрать. Архивируйте карту из каталога.");
  const children = map.nodes.filter(node => node.parentId === id).map(node => ({ ...node, parentId: thought.parentId }));
  const nodes = map.nodes.flatMap(node => node.id === id ? children : node.parentId === id ? [] : [node]);
  return validateMindmap({ ...map, nodes, links: map.links.filter(link => link.from !== id && link.to !== id) });
}
export function moveNode(map: Mindmap, id: string, parentId: string, before?: string): Mindmap {
  const node = map.nodes.find(n => n.id === id);
  if (!node || node.parentId === null || descendants(map, id).has(parentId)) throw new Error("Нельзя перенести корень или создать цикл.");
  const nodes = map.nodes.filter(n => n.id !== id);
  const index = before ? nodes.findIndex(n => n.id === before) : -1;
  nodes.splice(index < 0 ? nodes.length : index, 0, { ...node, parentId });
  return validateMindmap({ ...map, nodes });
}
export function attachTask(map: Mindmap, nodeId: string, task: GenesisTask): Mindmap {
  return validateMindmap({ ...map, nodes: map.nodes.map(n => n.id === nodeId
    ? { id: n.id, parentId: n.parentId, kind: "task", refId: task.id, note: n.note, ...(n.tags?.length ? { tags: n.tags } : {}),...(n.style ? {style:n.style}:{}),...(n.presentation ? {presentation:n.presentation}:{}),
      ...(task.recurrenceMode !== "none" && task.dueDate ? { occurrenceDate: task.dueDate } : {}) } : n) });
}
export function nodeTitle(node: MapNode, tasks: GenesisTask[], projects: GenesisProject[]) {
  return node.kind === "idea" ? node.text! : node.kind === "task"
    ? resolveMapTask(node, tasks)?.title ?? "Задача недоступна"
    : projects.find(p => p.id === node.refId)?.title ?? "Проект недоступен";
}
/** An exception replaces this occurrence, while the link keeps its original series identity. */
export function resolveMapTask(node: MapNode, tasks: GenesisTask[]) {
  if (node.kind !== "task") return undefined;
  const exception = node.occurrenceDate ? tasks.find(t => t.recurrenceSeriesId === node.refId && (t.recurrenceOriginalDate || t.dueDate) === node.occurrenceDate) : undefined;
  if (exception) return exception;
  const original = tasks.find(t => t.id === node.refId);
  if (original && original.recurrenceMode !== "none" && (!node.occurrenceDate || !recurrenceDatesForTask(original).includes(node.occurrenceDate))) return undefined;
  if (node.occurrenceDate && original?.recurrenceExcludedDates.includes(node.occurrenceDate)) return undefined;
  return original;
}
function linkedMapTasks(nodes: MapNode[], tasks: GenesisTask[]) {
  return [...new Map(nodes.flatMap(n => {
    const task = resolveMapTask(n, tasks);
    return task ? [[task.recurrenceMode !== "none" ? `${task.id}@${n.occurrenceDate}` : task.id, task] as const] : [];
  })).values()];
}
export function mapProgress(map: Mindmap, tasks: GenesisTask[]) {
  const linked = linkedMapTasks(map.nodes, tasks);
  return { total: linked.length, done: linked.filter(t => t.done).length };
}
export function mapCatalogStats(maps: Mindmap[], tasks: GenesisTask[], archived = false) {
  // Device drafts precede confirmed documents. Count each map and task once.
  const unique = new Map<string, Mindmap>();
  for (const map of maps) if (!unique.has(map.id)) unique.set(map.id, map);
  const documents = [...unique.values()].filter(map => map.archived === archived);
  const nodes = documents.flatMap(map => map.nodes);
  const linked = linkedMapTasks(nodes, tasks);
  return { maps: documents.length, ideas: nodes.filter(node => node.kind === "idea").length,
    total: linked.length, done: linked.filter(task => task.done).length };
}
/** dueDate is the existing domain's start; endDate is its deadline. */
export function nodeDateLabel(node: MapNode, tasks: GenesisTask[]) {
  const task = resolveMapTask(node, tasks);
  if (!task) return "Без срока";
  const start = task.recurrenceMode !== "none" ? node.occurrenceDate : task.dueDate;
  let end = task.endDate;
  if (start && end && task.recurrenceMode !== "none") {
    const shifted = Date.parse(end + "T12:00:00Z") + Date.parse(start + "T12:00:00Z") - Date.parse(task.dueDate + "T12:00:00Z");
    end = Number.isFinite(shifted) ? new Date(shifted).toISOString().slice(0,10) : start;
  }
  return start ? end && end !== start ? `${start} — ${end}` : start : "Без срока";
}
export function visibleNodes(map: Mindmap, view: MapView) {
  const root = view.focus && map.nodes.some(n => n.id === view.focus) ? view.focus : map.nodes.find(n => n.parentId === null)!.id;
  const children = new Map<string | null, MapNode[]>();
  for (const n of map.nodes) { const list = children.get(n.parentId) ?? []; list.push(n); children.set(n.parentId, list); }
  const rows: { node: MapNode; depth: number; children: number }[] = [];
  const byId = new Map(map.nodes.map(n => [n.id, n]));
  const collapsed = new Set(view.collapsed);
  const walk = (id: string, depth: number) => {
    const node = byId.get(id)!; const list = children.get(id) ?? [];
    rows.push({ node, depth, children: list.length });
    if (!collapsed.has(id)) list.forEach(n => walk(n.id, depth + 1));
  };
  walk(root, 0); return rows;
}
/** Stable preorder layout; cross-links never affect geometry or task hierarchy. */
export function layoutMap(map: Mindmap, view: MapView) {
  const rows=visibleNodes(map,view),rootWidth=mapNodeBox(rows[0].node).width;
  let top=24;
  return rows.map(row => {
    const box=mapNodeBox(row.node),defaultTop=top;
    top+=box.height+28;
    const point = view.positions?.[row.node.id];
    const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x <= 100_000 && point.y <= 100_000;
    return { ...row,...box, x: valid ? point.x : 24 + row.depth * 285+(row.depth>0?rootWidth-240:0), y: valid ? point.y : defaultTop };
  });
}
export function mapHomeView(map: Mindmap, view: MapView): MapView {
  const root = layoutMap(map, { ...view, focus: null }).find(row => row.node.parentId === null)!;
  return { ...view, focus: null, zoom: 1,
    viewport: { left: Math.max(0, root.x - 24), top: Math.max(0, root.y - 24) } };
}
export function parseOutline(text: string, parentId: string): MapNode[] {
  if (new TextEncoder().encode(text).length > 100_000) throw new Error("Вставьте не более 100 КБ текста.");
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > MAP_LIMITS.paste) throw new Error("За одну вставку — не более 200 мыслей.");
  const nodes: MapNode[] = []; const stack = [parentId];
  lines.forEach(line => {
    const indent = line.match(/^[ \t]*/)![0].replaceAll("\t", "  ");
    if (indent.length % 2) throw new Error("Используйте по два пробела или одну табуляцию на уровень.");
    const depth = indent.length / 2;
    if (depth >= stack.length || depth >= MAP_LIMITS.depth - 1) throw new Error("Отступ не может пропускать уровень. Первая строка — без отступа.");
    const node: MapNode = { id: mapId(), parentId: stack[depth], kind: "idea", text: line.trim(), note: "" };
    if (node.text!.length > MAP_LIMITS.text) throw new Error("Название мысли — не более 2000 символов.");
    nodes.push(node); stack.length = depth + 1; stack.push(node.id);
  }); return nodes;
}
export function importMindmap(text: string): Mindmap {
  if (new TextEncoder().encode(text).length > MAP_LIMITS.bytes) return invalid();
  const parsed = JSON.parse(text);
  if (parsed?.format !== "genesis-mindmap" || parsed?.version !== 1) throw new Error("Ожидается JSON GENESIS Mindmap версии 1.");
  return validateMindmap(parsed.document);
}
export function exportMindmap(map: Mindmap) { return JSON.stringify({ format: "genesis-mindmap", version: 1, document: validateMindmap(map) }, null, 2); }
export function mapMarkdown(map: Mindmap, title: (n: MapNode) => string) {
  return visibleNodes(map, { mode: "structure", collapsed: [], focus: null, zoom: 1 })
    .map(({ node, depth }) => `${"  ".repeat(depth)}- ${title(node).replaceAll("\n", " ")}${node.kind !== "idea" ? ` [${node.kind}: ${node.refId}]` : ""}${node.note ? `\n${"  ".repeat(depth + 1)}${node.note.replaceAll("\n", "\n" + "  ".repeat(depth + 1))}` : ""}`).join("\n");
}
export function mapSvg(map: Mindmap, title: (n: MapNode) => string, view?: MapView) {
  map=validateMindmap(map);
  const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
  const rows = layoutMap(map, { mode: "map", collapsed: [], focus: null, zoom: 1, positions: view?.positions });
  const byId = new Map(rows.map(n => [n.node.id, n]));
  const paths = rows.map(r => { const p = byId.get(r.node.parentId ?? ""); if(!p)return "";const edge=mapConnection(p,r),color=map.appearance?.lineColor||r.node.style?.border||"#8c672b";
    return `<g stroke="${color}"><path d="${edge.path}"/>${[edge.start,edge.end].map(point=>`<circle cx="${point.x}" cy="${point.y}" r="6" fill="#fffdf8" stroke-width="2"/>`).join("")}</g>`; }).join("");
  const links = map.links.map(l => { const a = byId.get(l.from)!; const b = byId.get(l.to)!,edge=mapConnection(a,b); return `<path stroke="${l.color || map.appearance?.lineColor || "#8c672b"}" stroke-dasharray="5 5" d="${edge.path}"/><text x="${edge.start.x+8}" y="${edge.start.y+20}" fill="#132426">${esc(l.label)}</text>`; }).join("");
  const lines=(text:string,length:number,count:number)=>{const result:string[]=[];for(const line of text.split(/\r?\n/)){const chars=[...line];while(chars.length&&result.length<count)result.push(chars.splice(0,length).join(""));if(result.length>=count)break;}return result;};
  const cards=rows.map(r=>{
    const p=r.node.presentation,root=r.node.parentId===null,ink=nodeColors(r.node)["--mindmap-node-ink"]||"#132426",align=root?p?.align||"left":"left";
    const side=root&&p?.layout==="side"&&p.image,imageWidth=side?Math.round(r.width*.32):r.width-24;
    const bodyX=r.x+12+(side?imageWidth+12:0),bodyWidth=r.width-24-(side?imageWidth+12:0),iconSize=root?32:24;
    const centeredIcon=p?.icon&&align==="center";
    const above=p?.image&&!side?148:0;
    const iconX=centeredIcon?bodyX+(bodyWidth-iconSize)/2:align==="right"?bodyX+bodyWidth-iconSize:bodyX;
    const icon=p?.icon?`<g transform="translate(${iconX} ${r.y+12+above}) scale(${iconSize/24})" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${mindmapIconVector(p.icon)}</g>`:"";
    const textLeft=bodyX+(p?.icon&&!centeredIcon&&align==="left"?iconSize+8:0),textRight=bodyX+bodyWidth-(p?.icon&&!centeredIcon&&align==="right"?iconSize+8:0);
    const textX=align==="center"?bodyX+bodyWidth/2:align==="right"?textRight:textLeft,anchor=align==="center"?"middle":align==="right"?"end":"start";
    const fontSize=root&&p?16:14,titleLines=lines(title(r.node),Math.max(10,Math.floor((textRight-textLeft)/(fontSize*.56))),root&&p?4:2),textY=r.y+26+above+(centeredIcon?40:0);
    const heading=titleLines.map((line,index)=>`<text x="${textX}" y="${textY+index*21}" text-anchor="${anchor}" fill="${ink}" font-family="sans-serif" font-size="${fontSize}">${esc(line)}</text>`).join("");
    const headingEnd=Math.max(r.y+48+above,textY+Math.max(0,titleLines.length-1)*21+12),imageY=side?r.y+16:r.y+12;
    const image=p?.image?`<defs><clipPath id="image-${r.node.id}"><rect x="${r.x+12}" y="${imageY}" width="${imageWidth}" height="128" rx="8"/></clipPath></defs><image href="${p.image.data}" x="${r.x+12}" y="${imageY}" width="${imageWidth}" height="128" preserveAspectRatio="xMidYMid ${p.image.fit==="cover"?"slice":"meet"}" clip-path="url(#image-${r.node.id})"><title>${esc(p.image.alt||title(r.node))}</title></image>`:"";
    const noteY=headingEnd+16;
    const note=p?.showNote?lines(r.node.note,Math.max(12,Math.floor(bodyWidth/6)),3).map((line,index)=>`<text x="${align==="left"?bodyX:textX}" y="${noteY+index*15}" text-anchor="${anchor}" fill="${ink}" font-family="sans-serif" font-size="11">${esc(line)}</text>`).join(""):"";
    return `<g><title>${esc(title(r.node))}</title><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${root&&p?16:12}" fill="${r.node.style?.fill||"#fffdf8"}" stroke="${r.node.style?.border||"#255b59"}"/>${icon}${heading}${image}${note}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(...rows.map(r=>r.x+r.width))+40}" height="${Math.max(...rows.map(r=>r.y+r.height))+52}" role="img"><title>${esc(map.title)}</title>${map.nodes.some(node=>node.presentation?.icon)?`<metadata>${esc(iconLicense)}</metadata>`:""}<rect width="100%" height="100%" fill="#eee9dc"/><g fill="none" stroke="${map.appearance?.lineColor||"#8c672b"}">${paths}${links}</g>${cards}</svg>`;
}
