"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { GenesisProject, GenesisTask } from "./cloud-sync";
import { GenesisApiError, LOCAL_SESSION_ENDED_EVENT } from "./cloud-sync";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { IconActionButton } from "./IconActionButton";
import { mindmapCopy } from "./mindmap-copy";
import { translateText } from "./i18n";
import { attachTask, descendants, exportMindmap, importMindmap, mapId, mapMarkdown, mapProgress, mapCatalogStats, mapSvg,
  moveNode, newMindmap, nodeColors, nodeTitle, nodeDateLabel, parseOutline, removeBranch, removeThought, resolveMapTask, validateMindmap, visibleNodes, type MapNode, type Mindmap, type MapView } from "./mindmaps-model";
import { MindmapRepository, type Conversion, type MapRecord, type SaveState } from "./mindmaps-storage";
import "./mindmaps.css";
import { printMindmap } from "./mindmaps-pdf";
import { recurrenceDatesForTask } from "./task-recurrence";
import { MindmapPresentationFields } from "./MindmapPresentationFields";
import { MindmapNodeContent } from "./MindmapNodeContent";
import { MindmapLinkEditor } from "./MindmapLinkEditor";
import { MindmapEditHistory } from "./mindmap-edit-history";
import {useDataTransferGuard} from './FeatureAccessContext';

const Canvas = lazy(() => import("./MindmapCanvas"));
const mobileQuery = () => window.matchMedia("(max-width: 1099px)");
const subscribeMobile = (fn: () => void) => { const q = mobileQuery(); q.addEventListener("change", fn); return () => q.removeEventListener("change", fn); };
const mobileSnapshot = () => mobileQuery().matches;
const serverSnapshot = () => false;
export type MindmapTaskRequest = Conversion & { title: string; projectId: string | null; repository: MindmapRepository };
type Props = { spaceId?: string; readOnly?: boolean; userId: string; tasks: GenesisTask[]; projects: GenesisProject[]; projectId: string | null;
  afterWorkspace?: ReactNode;
  taskCanEdit?: (task: GenesisTask) => boolean;
  onResolveTaskIds?: (ids: string[]) => void;
  onTaskSearch?: (query: string, inboxOnly: boolean, open: boolean, completed: boolean) => void;
  taskSearch?: {tasks: GenesisTask[]; footer: ReactNode; completedTasks?: GenesisTask[]; completedFooter?: ReactNode};
  projectForTask: (task: GenesisTask) => string | null;
  onClose: () => void; onCreateTask: (request: MindmapTaskRequest) => void; onEditTask: (task: GenesisTask, date?: string) => void;
  onToggleTask: (task: GenesisTask, date?: string) => void; onCalendar: (task: GenesisTask, date?: string) => void; onProject: (id: string) => void };

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogAccessibility<HTMLDivElement>(onClose);
  return <div className="modal-backdrop mindmap-dialog-backdrop"><div className="editor-modal mindmap-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
    <header><h2>{title}</h2><DialogCloseButton type="button" aria-label="Закрыть окно карты" onClick={onClose} /></header>{children}
  </div></div>;
}
const statuses: Record<SaveState, string> = { saving: "Сохраняем защищённый черновик…", device: "Сохранено на устройстве", pending: "Ожидает синхронизации", synced: "Синхронизировано с сервером", conflict: "Конфликт: оба варианта сохранены", error: "Сохранение требует внимания" };
function MapAction({label,shortLabel,icon,onClick,pressed,disabled,danger}:{label:string;shortLabel?:string;icon:string;onClick:()=>void;pressed?:boolean;disabled?:boolean;danger?:boolean}) {
  return <button type="button" className={`mindmap-icon-action${danger ? " danger-button" : ""}`} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><ExperimentalIcon name={icon}/><span className="mindmap-action-label" aria-hidden="true">{shortLabel ? <><span className="mindmap-label-full">{label}</span><span className="mindmap-label-short" data-no-translate>{shortLabel}</span></> : label}</span></button>;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a");
  a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Mindmaps(props: Props) {
  const transfer = useDataTransferGuard();
  const [repository] = useState(() => new MindmapRepository(props.userId, props.spaceId));
  const [records, setRecords] = useState<MapRecord[]>([]);
  const [record, setRecord] = useState<MapRecord | null>(null);
  const [map, setMap] = useState<Mindmap | null>(null);
  const current = useRef<Mindmap | null>(null);
  type IdeaDraft = { previous: Mindmap; selected: string; view: MapView };
  const [ideaDraft, setIdeaDraft] = useState<IdeaDraft | null>(null);
  const [inlineNodeId, setInlineNodeId] = useState<string | null>(null);
  const ideaDraftRef = useRef<IdeaDraft | null>(null);
  const cancelIdeaDraft = () => {
    const draft = ideaDraftRef.current; if (!draft) return;
    current.current = draft.previous; setMap(draft.previous); setSelected(draft.selected); setView(draft.view);
    ideaDraftRef.current = null; setIdeaDraft(null); setInlineNodeId(null); setError("");
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SaveState>("synced");
  const [selected, setSelected] = useState("");
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [view, setView] = useState<MapView>({ mode: "structure", collapsed: [], focus: null, zoom: 1 });
  const latestView = useRef(view);
  useEffect(() => { latestView.current = view; }, [view]);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [context, setContext] = useState(props.projectId ?? "");
  type DialogKind = "create" | "node" | "link" | "add" | "paste" | "import" | "export" | "history" | "delete" | "remove-thought" | "delete-map" | "settings" | null;
  const [dialog, setDialogState] = useState<DialogKind>(null);
  const nodeDialogBaseline = useRef<Mindmap | null>(null);
  const setDialog = (next: DialogKind) => {
    if ((next === 'import' || next === 'export') && !transfer.check()) return;
    if (next !== "node" && nodeDialogBaseline.current) {
      current.current = nodeDialogBaseline.current; setMap(nodeDialogBaseline.current); nodeDialogBaseline.current = null;
    }
    setDialogState(next);
  };
  const [deleteRecord, setDeleteRecord] = useState<MapRecord | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("empty");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Mindmap | null>(null);
  const [versions, setVersions] = useState<MapRecord[]>([]);
  const [editHistory] = useState(() => new MindmapEditHistory());
  const [parent, setParent] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [chaosOnly, setChaosOnly] = useState(false);
  const [completedPickerOpen, setCompletedPickerOpen] = useState(false);
  const {onResolveTaskIds,onTaskSearch} = props;
  const taskReferenceKey = JSON.stringify([...new Set([...records.flatMap(record=>record.document.nodes),...map?.nodes ?? [],...preview?.nodes ?? []].filter(node=>node.kind==="task").map(node=>node.refId).filter((id):id is string=>Boolean(id)))]);
  useEffect(()=>{ onResolveTaskIds?.(JSON.parse(taskReferenceKey)); },[taskReferenceKey,onResolveTaskIds]);
  useEffect(()=>{ onTaskSearch?.(pickerQuery,chaosOnly,dialog==="add",completedPickerOpen); },[pickerQuery,chaosOnly,dialog,completedPickerOpen,onTaskSearch]);
  const [pickerTask, setPickerTask] = useState<GenesisTask | null>(null);
  const [pickerDate, setPickerDate] = useState("");
  const [importAsIdeas, setImportAsIdeas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [journal, setJournal] = useState<Conversion[]>([]);
  const alive = useRef(true);
  const panelHistory = useRef(false);
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const onStatus = (state: SaveState, message?: string) => { if (alive.current) { setStatus(state); if (message) setError(message === "MAP_REVISION_CONFLICT" ? "Другая вкладка изменила карту. Ваш текст сохранён отдельно. Откройте историю или сохраните этот вариант отдельной картой." : message); } };
  const fail = (e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : "Не удалось выполнить действие."); };
  const refresh = async () => { setLoading(true); try { const list = await repository.list(); if (alive.current) setRecords(list); } catch (e) { fail(e); } finally { if (alive.current) setLoading(false); } };
  const open = async (r: MapRecord) => {
    repository.adopt(r); current.current = r.document; setRecord(r); setMap(r.document); setSearch(""); editHistory.clear(); setError("");
    setSelected(r.document.nodes.find(n => n.parentId === null)!.id); setTagDraft(""); setSelectedLink(null); setLinksOpen(false); setStatus(r.pending ? "device" : "synced");
    const url = new URL(location.href); url.searchParams.set("mindmap", r.document.id);
    if (panelHistory.current) { panelHistory.current=false; history.replaceState({}, "", url); } else history.pushState({}, "", url);
    try {
      const savedView = await repository.view(r.document.id);
      if (!alive.current || current.current?.id !== r.document.id) return;
      setView(savedView ?? { mode: isMobile ? "structure" : "map", collapsed: r.document.nodes.length > 200 ? r.document.nodes.filter(n => n.parentId !== null).map(n => n.id) : [], focus: null, zoom: 1 });
      setJournal(await repository.conversions(r.document));
    } catch (e) { fail(e); }
  };
  useEffect(() => {
    alive.current = true;
    const initialMapId = new URL(location.href).searchParams.get("mindmap");
    // A direct map URL may mount from a cached session just before bootstrap restores the workspace key.
    void (async () => {
      for (const delay of [0, 200, 500, 1000, 2000]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!alive.current) return;
        try {
          const list = await repository.list();
          if (!alive.current) return;
          setRecords(list); setLoading(false);
          const item = list.find(r => r.document.id === initialMapId);
          if (item && !current.current) void open(item);
          return;
        } catch (e) {
          if (delay !== 2000 && e instanceof Error && e.message === "Разблокируйте зашифрованное пространство GENESIS.") continue;
          fail(e); if (alive.current) setLoading(false); return;
        }
      }
    })();
    const exit = () => { alive.current = false; repository.dispose(); current.current = null; setMap(null); setRecords([]); };
    const back = () => {
      if (panelHistory.current) { panelHistory.current=false; cancelIdeaDraft(); setDialog(null); return; }
      if (document.querySelector('.task-composer-modal') || new URL(location.href).searchParams.get('mindmap') === current.current?.id) return;
      current.current = null; setMap(null); setRecord(null); setSearch(""); void refresh();
    };
    window.addEventListener(LOCAL_SESSION_ENDED_EVENT, exit); window.addEventListener("popstate", back);
    return () => { alive.current = false; window.removeEventListener(LOCAL_SESSION_ENDED_EVENT, exit); window.removeEventListener("popstate", back); };
    // One repository is scoped to the keyed account component, never reused by another login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);
  useEffect(() => {
    if (dialog && !panelHistory.current) { history.pushState({ ...history.state, mindmapPanel:true },"",location.href); panelHistory.current=true; }
    if (!dialog && panelHistory.current && history.state?.mindmapPanel) history.back();
  }, [dialog]);
  useEffect(() => {
    if (status !== "saving") return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [status]);
  // Task creation can finish with the map request still offline. Recover only the reference.
  useEffect(() => {
    if (!map) return;
    let recovered = map;
    for (const op of journal) {
      const task = props.tasks.find(t => t.id === op.taskId);
      if (task && !op.applied && recovered.nodes.some(n => n.id === op.nodeId && n.kind === "idea")) recovered = attachTask(recovered, op.nodeId, task);
    }
    if (recovered !== map) queueMicrotask(() => {
      if (!alive.current || current.current !== map) return;
      current.current = recovered; setMap(recovered);
      void repository.save(recovered, onStatus).then(async () => {
        for (const op of journal) if (recovered.nodes.some(n => n.id === op.nodeId && n.refId === op.taskId)) await repository.journal({ ...op, applied: true });
        if (alive.current) setJournal(ops => ops.map(op => recovered.nodes.some(n => n.id === op.nodeId && n.refId === op.taskId) ? { ...op, applied: true } : op));
      }).catch(fail);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tasks, journal, repository]);
  useEffect(() => repository.subscribeJournal(() => {
    if (current.current) void repository.conversions(current.current).then(ops => { if (alive.current) setJournal(ops); }).catch(fail);
  }), [repository]);
  const change = (next: Mindmap, history = true, group = "", commitDialog = false) => {
    if (props.readOnly) return;
    try {
      const checked = validateMindmap(next);
      const previous = current.current;
      if (ideaDraftRef.current) { current.current = checked; setMap(checked); setError(""); return; }
      if (dialog === "node" && !commitDialog) {
        nodeDialogBaseline.current ??= previous;
        current.current = checked; setMap(checked); setError(""); return;
      }
      if (history && previous) editHistory.record({ document: previous, positions: latestView.current.positions, selected },
        { document: checked, positions: latestView.current.positions, selected }, group);
      current.current = checked; setMap(checked); setError(""); setStatus("pending");
      void repository.save(checked, onStatus).catch(fail);
    } catch (e) { fail(e); }
  };
  const changeView = (next: MapView, recordPosition = false) => {
    if (recordPosition && current.current) editHistory.record(
      { document: current.current, positions: latestView.current.positions, selected },
      { document: current.current, positions: next.positions, selected });
    latestView.current = next; setView(next); if (map) void repository.saveView(map.id, next).catch(fail);
  };
  const applyHistory = (direction: "undo" | "redo") => {
    if (!current.current || props.readOnly || ideaDraftRef.current || nodeDialogBaseline.current || status === "conflict") return;
    const snapshot = editHistory.take(direction, { document: current.current, positions: latestView.current.positions, selected });
    if (!snapshot) return;
    change(snapshot.document, false);
    const ids = new Set(snapshot.document.nodes.map(node => node.id));
    setSelected(ids.has(snapshot.selected) ? snapshot.selected : snapshot.document.nodes[0].id); setSelectedLink(null);
    changeView({ ...latestView.current, positions: snapshot.positions,
      collapsed: latestView.current.collapsed.filter(id => ids.has(id)),
      focus: latestView.current.focus && ids.has(latestView.current.focus) ? latestView.current.focus : null });
  };
  const historyControl = useRef(applyHistory);
  useEffect(() => { historyControl.current = applyHistory; });
  useEffect(() => {
    if (!map?.id || dialog || inlineNodeId || props.readOnly) return;
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey
        || document.querySelector('dialog[open],[aria-modal="true"]')
        || event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
      const code = event.code || event.key.toLowerCase();
      if (!["KeyZ","KeyY","z","y"].includes(code)) return;
      event.preventDefault();
      historyControl.current(code === "KeyY" || code === "y" || event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [map?.id, dialog, inlineNodeId, props.readOnly]);
  const titleFor = (n: MapNode) => nodeTitle(n, props.tasks, props.projects);
  const node = map?.nodes.find(n => n.id === selected) ?? map?.nodes[0];
  const selectNode = (id: string) => { setSelected(id); setTagDraft(""); setSelectedLink(null); };
  const selectLink = (id: string, from: string) => { setSelected(from); setTagDraft(""); setSelectedLink(id); };
  const editLink = (id: string) => { const link = map?.links.find(item => item.id === id); if (link) { selectLink(id, link.from); setDialog("link"); } };
  const removeLink = (id: string) => { if (!map || props.readOnly) return; change({ ...map, links: map.links.filter(link => link.id !== id) }); setSelectedLink(null); setDialog(null); };
  const addTag = () => {
    if (!map || !node) return;
    const tag = tagDraft.trim().replace(/^#+/, "").trim();
    if (!tag) return;
    if (tag.length > 32) { fail(new Error("Тег — не более 32 символов.")); return; }
    if ((node.tags?.length ?? 0) >= 8) { fail(new Error("У узла может быть до 8 тегов.")); return; }
    if (node.tags?.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) { setTagDraft(""); return; }
    change({ ...map, nodes: map.nodes.map(value => value.id === node.id ? { ...value, tags: [...(value.tags ?? []), tag] } : value) });
    setTagDraft("");
  };
  const deleteSelection = () => {
    if (!map || !node) return;
    if (selectedLink) { removeLink(selectedLink); return; }
    if (node.parentId === null) { fail(new Error("Корень карты нельзя удалить. Архивируйте карту из каталога.")); return; }
    const parentId = node.parentId;
    const removed = descendants(map, node.id);
    change(removeBranch(map, node.id)); setSelected(parentId);
    if (view.focus && removed.has(view.focus)) changeView({ ...view, focus: parentId });
  };
  const task = node ? resolveMapTask(node,props.tasks) : undefined;
  const branchIds = useMemo(() => map && node ? descendants(map, node.id) : new Set<string>(), [map, node]);
  const taskDate = task?.recurrenceMode === "none" ? task.dueDate : node?.occurrenceDate;
  const rows = useMemo(() => map ? visibleNodes(ideaDraft?.previous ?? map, view) : [], [map, ideaDraft, view]);
  const progress = map ? mapProgress(map, props.tasks) : null;
  const catalogStats = mapCatalogStats(records.map(record => record.document), props.tasks, archived);
  const saveDialog = () => {
    if (dialog === "delete-map" && busy) return;
    const returnToCanvas = (dialog === "node" || dialog === "link") && view.mode === "map";
    cancelIdeaDraft();
    setDialog(null);
    setDeleteRecord(null);
    if (returnToCanvas) requestAnimationFrame(() => document.querySelector<HTMLElement>(".mindmap-canvas")?.focus({ preventScroll: true }));
  };
  const addIdea = (sibling = false, position?: {x:number;y:number}, anchorId?: string) => {
    const anchor = anchorId ? map?.nodes.find(item=>item.id===anchorId) : node;
    if (props.readOnly || !map || !anchor) return;
    const added: MapNode = { id: mapId(), parentId: sibling ? anchor.parentId ?? anchor.id : anchor.id, kind: "idea", text: "", note: "" };
    try { validateMindmap({ ...map, nodes: [...map.nodes, added] }); } catch (e) { fail(e); return; }
    const draft = {previous: map, selected: anchor.id, view};
    ideaDraftRef.current = draft; setIdeaDraft(draft);
    change({ ...map, nodes: [...map.nodes, added] }); setSelected(added.id); setSelectedLink(null); setTagDraft("");
    setView({ ...view, collapsed: view.collapsed.filter(id => id !== added.parentId), ...(position ? {positions:{...view.positions,[added.id]:position}} : {}) });
    if (view.mode === "map") { setInlineNodeId(added.id); setDialog(null); } else setDialog("node");
  };
  const finishInlineTitle = (id: string, value: string) => {
    const document = current.current; if (!document || props.readOnly) return;
    const text = value.trim();
    if (!text) { cancelIdeaDraft(); setInlineNodeId(null); return; }
    const next = { ...document, nodes: document.nodes.map(item => item.id === id ? { ...item, text } : item) };
    const draft = ideaDraftRef.current;
    if (draft) { current.current = draft.previous; ideaDraftRef.current = null; setIdeaDraft(null); }
    setInlineNodeId(null); change(next); if (draft) changeView(view);
  };
  const finishIdea = () => {
    const document = current.current; if (!document || !node || node.kind === "idea" && !node.text?.trim()) return;
    const draft = ideaDraftRef.current;
    const previous = nodeDialogBaseline.current ?? draft?.previous;
    if (previous) {
      current.current = previous; nodeDialogBaseline.current = null; ideaDraftRef.current = null; setIdeaDraft(null);
      change(document, true, "", true); if (draft) changeView(view);
    }
    saveDialog();
  };
  const goCatalog = () => { cancelIdeaDraft(); setInlineNodeId(null); const url = new URL(location.href); url.searchParams.delete("mindmap"); history.pushState({}, "", url); current.current = null; setMap(null); setRecord(null); setSearch(""); setError(""); void refresh(); };
  const handOffTaskPanel = () => {
    if (panelHistory.current) {
      panelHistory.current = false;
      history.replaceState({ genesisMindmapTaskPanel: true }, "", location.href);
    }
    setDialog(null);
  };
  const createTask = async () => {
    if (props.readOnly || !map || !node || node.kind !== "idea" || busy) return;
    setBusy(true);
    try {
      const old = journal.find(j => j.nodeId === node.id);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${map.id}:${node.id}`));
      const taskId = `maptask-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
      const request: Conversion = old ?? { mapId: map.id, nodeId: node.id, taskId };
      await repository.journal(request); if (!alive.current) return; setJournal(j => [...j.filter(i => i.nodeId !== node.id), request]);
      handOffTaskPanel(); props.onCreateTask({ ...request, title: node.text!, projectId: map.projectId, repository });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const addTaskReference = (linked: GenesisTask, occurrenceDate?: string) => {
    if (!map || !node) return;
    const ref: MapNode = { id: mapId(), parentId: node.id, kind: "task", refId: linked.id, note: "", ...(occurrenceDate ? { occurrenceDate } : {}) };
    change({ ...map, nodes: [...map.nodes, ref] }); setSelected(ref.id); setPickerTask(null); setDialog(null);
  };
  const inspector = map && node ? <div className="mindmap-inspector-content">
    <h3>{node.parentId===null ? <span data-no-translate>{mindmapCopy("root")}</span> : node.kind === "idea" ? "Мысль" : node.kind === "task" ? "Задача GENESIS" : "Проект GENESIS"}</h3>
    <fieldset disabled={props.readOnly} className="mindmap-edit-fields">
    <details className="mindmap-colors"><summary>Цвета карточки и линий</summary><div>
      <label><span>Заливка карточки</span><input type="color" value={node.style?.fill || "#fffdf8"} onChange={e=>change({...map,nodes:map.nodes.map(n=>n.id===node.id ? {...n,style:{...n.style,fill:e.target.value}} : n)})}/></label>
      <label><span>Обводка карточки</span><input type="color" value={node.style?.border || "#255b59"} onChange={e=>change({...map,nodes:map.nodes.map(n=>n.id===node.id ? {...n,style:{...n.style,border:e.target.value}} : n)})}/></label>
      <label><span>Цвет линий карты</span><input type="color" value={map.appearance?.lineColor || "#8c672b"} onChange={e=>change({...map,appearance:{...map.appearance,lineColor:e.target.value}})}/></label>
      <button type="button" onClick={()=>change({...map,appearance:undefined,nodes:map.nodes.map(n=>n.id===node.id ? {...n,style:undefined} : n)})}>Вернуть цвета темы</button>
    </div></details>
    {node.kind === "idea" ? <label>Название мысли<textarea aria-label="Название мысли" rows={3} maxLength={2000} value={node.text} onChange={e => change({ ...map, title: node.parentId === null ? e.target.value || "Без названия" : map.title, nodes: map.nodes.map(n => n.id === node.id ? { ...n, text: e.target.value } : n) }, true, `node-text:${node.id}`)} /></label>
      : <h4 data-no-translate>{titleFor(node)}</h4>}
    <MindmapPresentationFields key={node.id} node={node} onChange={patch=>{
      const document=current.current;if(!document||document.id!==map.id)return;
      change({...document,nodes:document.nodes.map(value=>value.id===node.id?{...value,presentation:{...value.presentation,...patch}}:value)});
    }}/>
    <div className="mindmap-tags-editor"><label>Теги узла · только в карте<input value={tagDraft} maxLength={33} placeholder="Например, решение" onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} /></label><button type="button" disabled={!tagDraft.trim() || (node.tags?.length ?? 0) >= 8} onClick={addTag}>Добавить тег</button>
      {node.tags?.length ? <div className="mindmap-tag-list" aria-label="Теги узла">{node.tags.map(tag => <span className="mindmap-tag" key={tag}>#{tag}<button type="button" aria-label={`Убрать тег ${tag}`} onClick={() => change({ ...map, nodes: map.nodes.map(value => value.id === node.id ? { ...value, tags: value.tags?.filter(item => item !== tag) } : value) })}><ExperimentalIcon name="close" /></button></span>)}</div> : null}</div>
    <label>Пояснение · только в карте<textarea aria-label="Пояснение · только в карте" rows={3} value={node.note} maxLength={12000} onChange={e => change({ ...map, nodes: map.nodes.map(n => n.id === node.id ? { ...n, note: e.target.value } : n) }, true, `node-note:${node.id}`)} /></label>
    {!ideaDraft && node.kind === "idea" ? <p>Мысль не имеет срока. Создание откроет обычную форму одной задачи; пояснение останется в карте.</p> : null}
    </fieldset>
    {task ? <><p>{task.done ? "Выполнено" : "В работе"} · {nodeDateLabel(node,props.tasks)}</p><p>Проект: {props.projects.find(p => p.id === props.projectForTask(task))?.title || "Хаос"}</p>
      {task.googleReadOnly ? <p>Источник Google разрешает только просмотр.</p> : <><button type="button" onClick={() => { handOffTaskPanel(); props.onEditTask(task, taskDate); }}>Открыть карточку задачи</button><button type="button" disabled={props.taskCanEdit?.(task) === false} onClick={() => props.onToggleTask(task, taskDate)}>{task.done ? "Вернуть в работу" : "Выполнить задачу"}</button></>}
      {props.spaceId && props.taskCanEdit?.(task) === false ? <p><span>Общий проект</span> · <span>Доступно только для просмотра.</span></p> : null}
      <button type="button" disabled={!task.dueDate && !node.occurrenceDate} onClick={() => props.onCalendar(task, taskDate)}>Открыть в календаре</button>
      {node.occurrenceDate ? <p>Ссылка на экземпляр {node.occurrenceDate}. Действия не применяются ко всей серии.</p> : null}</> : null}
    {node.kind === "task" && !task ? <p>Задача удалена или недоступна. Старое название не хранится в карте.</p> : null}
    {node.kind === "project" ? <button type="button" disabled={!props.projects.some(p => p.id === node.refId)} onClick={() => props.onProject(node.refId!)}>{props.spaceId ? "Открыть общий проект" : "Открыть личный проект"}</button> : null}
    {!ideaDraft ? <div className="mindmap-actions mindmap-node-actions" data-action-count={node.kind === "idea" ? "6" : "5"}>
      {node.kind === "idea" ? <IconActionButton label={translateText("Создать задачу из мысли")} icon="thought-task" disabled={props.readOnly || busy || !node.text?.trim()} onClick={() => void createTask()} /> : null}
      <IconActionButton label={translateText("Добавить дочернюю мысль")} icon="thought-child" disabled={props.readOnly} onClick={() => addIdea()} />
      <IconActionButton label={translateText("Добавить соседнюю мысль")} icon="thought-sibling" disabled={props.readOnly} onClick={() => addIdea(true)} />
      <IconActionButton label={translateText("Добавить из дел")} icon="thought-affair" disabled={props.readOnly} onClick={() => { setPickerQuery(""); setPickerTask(null); setCompletedPickerOpen(false); setDialog("add"); }} />
      <IconActionButton label={translateText(view.focus ? "Вся карта" : "Фокус на ветке")} icon={view.focus ? "map-mode" : "thought-focus"} onClick={() => { changeView({ ...view, focus: view.focus ? null : node.id }); setDialog(null); }} />
      <IconActionButton label={translateText(view.collapsed.includes(node.id) ? "Развернуть ветку" : "Свернуть ветку")} icon="thought-fold" aria-pressed={view.collapsed.includes(node.id)} onClick={() => changeView({ ...view, collapsed: view.collapsed.includes(node.id) ? view.collapsed.filter(id => id !== node.id) : [...view.collapsed, node.id] })} />
    </div> : null}
    <fieldset disabled={props.readOnly} className="mindmap-edit-fields">
    {!ideaDraft && node.parentId ? <><label>Переместить в ветку<select value={parent} onChange={e => setParent(e.target.value)}><option value="">Выберите родителя</option>{map.nodes.filter(n => !branchIds.has(n.id)).map(n => <option key={n.id} value={n.id}>{titleFor(n)}</option>)}</select></label>
      <button type="button" disabled={!parent} onClick={() => { try { change(moveNode(map, node.id, parent)); setParent(""); } catch(e) { fail(e); } }}>Переместить узел</button>
      <div className="mindmap-actions mindmap-order-actions">{[-1,1].map(direction => <MapAction key={direction} label={direction < 0 ? "Выше" : "Ниже"} icon={direction < 0 ? "map-up" : "map-down"} onClick={() => { const siblings = map.nodes.filter(n => n.parentId === node.parentId); const i = siblings.findIndex(n => n.id === node.id); const target = direction < 0 ? siblings[i-1] : siblings[i+2]; if ((direction < 0 && i > 0) || (direction > 0 && i < siblings.length-1)) change(moveNode(map,node.id,node.parentId!,target?.id)); }}/>)}<MapAction label="Убрать ветку с карты" shortLabel={translateText("Убрать")} icon="thought-unlink" danger onClick={() => setDialog("delete")}/></div></> : null}
    {!ideaDraft ? <details className="mindmap-links" open={linksOpen} onToggle={event => setLinksOpen(event.currentTarget.open)}><summary>Смысловые связи</summary><p>«Связано с» не меняет зависимости задач.</p>
      <label>Связать с<select value={linkTo} onChange={e => setLinkTo(e.target.value)}><option value="">Выберите узел</option>{map.nodes.filter(n => n.id !== node.id).map(n => <option key={n.id} value={n.id}>{titleFor(n)}</option>)}</select></label>
      <label>Подпись связи<input value={linkLabel} maxLength={240} onChange={e => setLinkLabel(e.target.value)} /></label>
      <button type="button" disabled={!linkTo} onClick={() => { change({ ...map, links: [...map.links, { id: mapId(), from: node.id, to: linkTo, label: linkLabel }] }); setLinkTo(""); setLinkLabel(""); }}>Добавить связь</button>
      {map.links.filter(l => l.from === node.id || l.to === node.id).map(l => <div key={l.id} className="mindmap-link-row" data-selected={selectedLink === l.id ? "true" : undefined}><span>{l.label || "Связано с"}: {titleFor(map.nodes.find(n => n.id === (l.from === node.id ? l.to : l.from))!)}</span><input type="color" aria-label="Цвет смысловой связи" value={l.color || "#8c672b"} onChange={e=>change({...map,links:map.links.map(link=>link.id===l.id ? {...link,color:e.target.value} : link)})}/><button type="button" aria-label="Убрать смысловую связь" onClick={() => { change({ ...map, links: map.links.filter(x => x.id !== l.id) }); if (selectedLink === l.id) setSelectedLink(null); }}>Убрать связь</button></div>)}
    </details> : null}
    </fieldset>
    {node.kind === "idea" || dialog === "node" ? <div className="mindmap-thought-completion">{ideaDraft || dialog !== "node" ? <p data-no-translate>{mindmapCopy(ideaDraft ? "draftHelp" : "editHelp")}</p> : null}<div className="mindmap-actions"><button type="button" className="primary-button" disabled={props.readOnly || node.kind === "idea" && !node.text?.trim()} onClick={finishIdea} data-no-translate>{ideaDraft ? mindmapCopy("createThought") : dialog === "node" ? translateText("Сохранить") : mindmapCopy("done")}</button>{ideaDraft || dialog === "node" ? <button type="button" onClick={saveDialog} data-no-translate>{mindmapCopy("cancel")}</button> : null}</div></div> : null}
  </div> : null;

  const nodeSearch = <label className="mindmap-search mindmap-node-search"><input aria-label="Найти узел" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти узел" /><ExperimentalIcon name="search" /></label>;
  const mapBackAction = <IconActionButton label={translateText("Все майндмепы")} icon="map-back" onClick={goCatalog}/>;
  return <section className="mindmaps" aria-label={props.spaceId ? "Общие майндмепы" : "Личные майндмепы"}>
    <header className="workspace-header mindmap-header" data-exp-ui="panel" data-mobile-overview={overviewOpen} data-map-open={Boolean(map)}><div className="workspace-header-main mindmap-header-main"><span className="projects-hero-mark mindmap-hero-mark" aria-hidden="true"><ExperimentalIcon name="map-mode" /></span><div className="workspace-header-copy"><h1>{map ? <>Майндмеп<span className="workspace-title-secondary"> · <em className="mindmap-map-title" data-no-translate>{map.title}</em></span></> : "Майндмепы"}</h1><p data-no-translate={Boolean(map?.description)}>{map ? map.description || (progress!.total ? `Связанные задачи: ${progress!.done} ${translateText("из")} ${progress!.total}` : translateText("Пока только идеи")) : "Связывайте идеи, проекты и задачи."}</p></div></div>
      {map ? <span role="status" className="mindmap-save-state" data-save-state={status}>{status === "synced" ? null : statuses[status]}</span> : null}
      {map ? <div className="mindmap-view-modes mindmap-header-modes" role="group" aria-label={translateText("Представление карты")}>
        {isMobile ? mapBackAction : null}
        <IconActionButton className="mindmap-view-toggle" label={translateText(view.mode === "map" ? "Структура" : "Карта")} icon={view.mode === "map" ? "map-mode" : "outline-mode"} onClick={() => changeView({ ...view, mode: view.mode === "map" ? "structure" : "map" })}/>
        {!isMobile ? mapBackAction : null}
        <IconActionButton label={translateText("Настройка карты")} icon="gear" aria-haspopup="dialog" onClick={() => setDialog("settings")}/>
      </div> : null}
      {!map ? <div id="mindmap-catalog-summary" className="projects-summary mindmap-catalog-statistics" aria-live="polite">
        <span><strong>{loading ? "—" : catalogStats.maps}</strong>Майндмепы</span>
        <span><strong>{loading ? "—" : catalogStats.ideas}</strong>Мысли</span>
        <span><strong>{loading ? "—" : <>{catalogStats.done} {translateText("из")} {catalogStats.total}</>}</strong>Связанные задачи:</span>
      </div> : null}
      {!map ? <button type="button" className="mindmap-overview-toggle" aria-expanded={overviewOpen} aria-controls="mindmap-catalog-summary" onClick={()=>setOverviewOpen(value=>!value)}><ExperimentalIcon name="chevron"/>Обзор</button> : null}
      {!map ? <button type="button" className="mindmap-back-link" aria-label={translateText(props.spaceId ? "К общим делам" : "К личным делам")} title={translateText(props.spaceId ? "К общим делам" : "К личным делам")} onClick={props.onClose}><ExperimentalIcon name="map-back"/><span>{props.spaceId ? "К общим делам" : "К личным делам"}</span></button> : null}
    </header>
    {error && !dialog ? <div role="alert" className="mindmap-error"><p>{error}</p>{map ? <div className="mindmap-actions"><button type="button" disabled={props.readOnly} onClick={() => { setError(""); void (record?.pending && record.draftKey ? repository.retry(record, onStatus) : repository.save(map, onStatus)).catch(fail); }}>Повторить сохранение</button><button type="button" disabled={props.readOnly} onClick={() => { void repository.forkDraft(map, onStatus).then(copy => { setError(""); return open({ document: copy, revision: 1, updatedAt: "" }); }).catch(fail); }}>Сохранить отдельный вариант</button><button type="button" onClick={goCatalog}>Показать серверную версию</button></div> : <button type="button" onClick={() => void refresh()}>Повторить загрузку</button>}</div> : null}
    {map && record?.pending && !error ? <div className="mindmap-recovery"><p>Открыт защищённый черновик с устройства.</p><button type="button" disabled={props.readOnly} onClick={() => { void repository.retry(record, onStatus).then(() => setRecord(r => r ? { ...r, pending: false } : r)).catch(fail); }}>Отправить сохранённый черновик</button></div> : null}
    {props.readOnly ? <p role="status">Доступно только для просмотра.</p> : null}
    {!map ? <>
      <div className="mindmap-toolbar mindmap-catalog-controls"><button type="button" className="primary-button mindmap-create-map" disabled={props.readOnly} onClick={() => { setTitle(""); setDialog("create"); }}>Создать карту</button><label className="mindmap-search">Поиск карт<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Название карты" /><ExperimentalIcon name="search" /></label>
        <label>Контекст проекта<select value={context} onChange={e => setContext(e.target.value)}><option value="">{props.spaceId ? "Все карты пространства" : "Все личные карты"}</option>{props.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
        <div className="mindmap-actions"><MapAction label={archived ? "Показать текущие" : "Архив"} icon="map-archive" pressed={archived} onClick={() => setArchived(!archived)}/><MapAction label="Импорт JSON" icon="map-import" disabled={props.readOnly} onClick={() => { setPreview(null); setImportAsIdeas(false); setDialog("import"); }}/><MapAction label="Обновить" icon="map-refresh" onClick={() => void refresh()}/></div>
      </div>
      {loading ? <p role="status">Открываем зашифрованные карты…</p> : null}
      <div className="mindmap-catalog">{records.filter(r => r.document.archived === archived && (!context || r.document.projectId === context) && r.document.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b) => Number(b.document.pinned)-Number(a.document.pinned)).map(r => <article key={r.draftKey || r.document.id}>
        <button type="button" className="mindmap-catalog-open" onClick={() => void open(r)}><strong data-no-translate>{r.document.title}</strong><span>{r.pending ? "Черновик на устройстве" : `Версия ${r.revision}`} · {r.document.nodes.length} узлов{r.document.pinned ? " · Закреплена" : ""}</span><span>{props.projects.find(p => p.id === r.document.projectId)?.title || "Без проекта"}</span></button>
        <div className="mindmap-actions"><MapAction label={r.document.pinned ? "Открепить" : "Закрепить"} icon="map-pin" pressed={r.document.pinned} disabled={busy || props.readOnly} onClick={() => { repository.adopt(r); void repository.save({ ...r.document, pinned: !r.document.pinned }, onStatus).then(refresh).catch(fail); }}/><MapAction label={archived ? "Восстановить" : "Архивировать"} icon="map-archive" disabled={busy || props.readOnly} onClick={() => { repository.adopt(r); void repository.save({ ...r.document, archived: !r.document.archived }, onStatus).then(refresh).catch(fail); }}/><MapAction label="Удалить карту" icon="delete" danger disabled={busy || props.readOnly} onClick={() => { setError(""); setDeleteRecord(r); setDialog("delete-map"); }}/></div>
      </article>)}</div>
      {!loading && search && !records.some(r => r.document.archived === archived && (!context || r.document.projectId === context) && r.document.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ? <p>Ничего не найдено. Измените запрос.</p> : null}
      {!loading && !records.some(r => r.document.archived === archived && (!context || r.document.projectId === context)) ? <div className="mindmap-empty"><h3>{archived ? "Архив пуст" : "Начните с одной мысли"}</h3><p>Карта помогает разобрать замысел. Задачи появятся в делах только после вашего подтверждения.</p></div> : null}
    </> : <>
      <div className="mindmap-toolbar mindmap-primary-toolbar">
        <button type="button" className="primary-button mindmap-add-thought" disabled={props.readOnly} aria-label="Добавить мысль" title="Добавить мысль" onClick={() => addIdea()}><ExperimentalIcon name="thought-new"/><span>Добавить мысль</span></button><button type="button" className="mindmap-add-affair" disabled={props.readOnly} aria-label="Добавить из дел" title="Добавить из дел" onClick={() => { setPickerQuery(""); setPickerTask(null); setDialog("add"); }}><ExperimentalIcon name="thought-affair"/><span>Добавить из дел</span></button>
      <div className="mindmap-history-actions" role="group" aria-label={mindmapCopy("edits")}>
        <button type="button" disabled={props.readOnly || Boolean(ideaDraft) || status === "conflict" || !editHistory.canUndo}
          aria-label={translateText("Отменить изменение карты")} aria-keyshortcuts="Control+Z Meta+Z" data-tooltip={`${translateText("Отменить изменение карты")} · Ctrl+Z`} onClick={() => applyHistory("undo")}>
          <ExperimentalIcon name="undo"/>
        </button>
        <button type="button" disabled={props.readOnly || Boolean(ideaDraft) || status === "conflict" || !editHistory.canRedo}
          aria-label={translateText("Повторить изменение карты")} aria-keyshortcuts="Control+Y Meta+Shift+Z" data-tooltip={`${translateText("Повторить изменение карты")} · Ctrl+Y`} onClick={() => applyHistory("redo")}>
          <ExperimentalIcon name="redo"/>
        </button>
      </div>
        {!isMobile ? nodeSearch : null}
        {view.focus ? <button type="button" className="mindmap-all-map" onClick={() => changeView({ ...view, focus: null })}>Вся карта</button> : null}
      </div>
      {isMobile ? <div className="mindmap-canvas-search">{nodeSearch}</div> : null}
      {search ? <div className="mindmap-search-results" aria-label="Найденные узлы">{!map.nodes.some(n => `${titleFor(n)} ${n.note} ${(n.tags ?? []).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ? <p>Ничего не найдено. Измените запрос.</p> : null}{map.nodes.filter(n => `${titleFor(n)} ${n.note} ${(n.tags ?? []).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(n => <button type="button" key={n.id} onClick={() => { setSelected(n.id); changeView({ ...view, focus: n.id, collapsed: view.collapsed.filter(id => id !== n.id) }); setSearch(""); if (isMobile) setDialog("node"); }}>{titleFor(n)} · Показать ветку</button>)}</div> : null}
      <div className="mindmap-workspace"><div className="mindmap-editor">
        {view.mode === "map" ? <Suspense fallback={<p>Открываем полотно…</p>}><Canvas inlineNodeId={inlineNodeId} onCommitTitle={finishInlineTitle} onCancelTitle={() => { cancelIdeaDraft(); setInlineNodeId(null); }} onEditLink={editLink} onRemoveLink={removeLink} onLink={(from,to) => { if (!map.links.some(l => l.from===from && l.to===to || l.from===to && l.to===from)) change({...map,links:[...map.links,{id:mapId(),from,to,label:"Связано с"}]}); }} onSelectLink={selectLink} onEditNode={id => { selectNode(id); setDialog("node"); }} onDeleteSelection={deleteSelection} onPosition={(id,position) => changeView({ ...view, positions: {...view.positions,[id]:position} }, true)} readOnly={props.readOnly} onContextAction={(action,id) => {
          const target=id??map.nodes.find(item=>item.parentId===null)!.id;
          if(action==="child"||action==="sibling")addIdea(action==="sibling",undefined,target);
          else { selectNode(target); if(action==="affair"){setPickerQuery("");setPickerTask(null);setDialog("add");}else if(action==="rename")setInlineNodeId(target);else setDialog(action==="remove-thought"?"remove-thought":"delete"); }
        }} onCreateAt={position => addIdea(false,position,selected ?? view.focus ?? map.nodes.find(item=>item.parentId===null)!.id)} map={inlineNodeId ? map : ideaDraft?.previous ?? map} view={view} selected={selected} selectedLink={selectedLink} title={titleFor} onSelect={selectNode} onHome={changeView} onZoom={zoom => changeView({ ...view, zoom })} onViewport={viewport => changeView({ ...latestView.current, viewport })} /></Suspense>
          : <ol className="mindmap-structure" aria-label="Структура карты">{rows.map(r => <li key={r.node.id} style={{ paddingInlineStart: Math.min(r.depth,3)*16 }}>
            <button type="button" className="mindmap-collapse" aria-expanded={r.children ? !view.collapsed.includes(r.node.id) : undefined} aria-label={`${translateText(view.collapsed.includes(r.node.id) ? "Развернуть" : "Свернуть")}: ${titleFor(r.node)}`} disabled={!r.children} onClick={() => changeView({ ...view, collapsed: view.collapsed.includes(r.node.id) ? view.collapsed.filter(id => id !== r.node.id) : [...view.collapsed,r.node.id] })}><ExperimentalIcon name="chevron" /></button>
            <button type="button" className="mindmap-row" style={nodeColors(r.node)} aria-pressed={selected === r.node.id} onClick={() => selectNode(r.node.id)} onDoubleClick={() => { selectNode(r.node.id); setDialog("node"); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); selectNode(r.node.id); setDialog("node"); } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); selectNode(r.node.id); if (r.node.parentId) { change(removeBranch(map, r.node.id)); setSelected(r.node.parentId); } else fail(new Error("Корень карты нельзя удалить. Архивируйте карту из каталога.")); } }}><MindmapNodeContent node={r.node} title={titleFor(r.node)} compact/>{r.node.tags?.length ? <span className="mindmap-row-tags">{r.node.tags.map(tag => `#${tag}`).join(" · ")}</span> : null}<span>{r.node.kind === "idea" ? "Мысль" : r.node.kind === "project" ? "Проект" : `${resolveMapTask(r.node, props.tasks)?.done ? "Выполнено" : "Задача"} · ${nodeDateLabel(r.node, props.tasks)}`}{r.depth > 3 ? ` · уровень ${r.depth+1}` : ""}</span></button>
            <button type="button" aria-label={`${translateText("Изменить узел:")} ${titleFor(r.node)}`} onClick={() => { setSelected(r.node.id); setDialog("node"); }}><ExperimentalIcon name="edit" /></button>
          </li>)}</ol>}
        {isMobile && node ? <button type="button" className="mindmap-mobile-inspector primary-button" onClick={() => setDialog("node")}>Действия с выбранным узлом</button> : null}
      </div></div>
    </>}
    {props.afterWorkspace}
    {dialog ? <Dialog title={dialog === "node" && ideaDraft ? mindmapCopy("createTitle") : ({ create:"Новая карта", node:"Редактор узла", link:"Настроить связь", add:props.spaceId ? "Добавить из общих дел" : "Добавить из личных дел", paste:"Мысли из текста", import:"Импорт карты GENESIS", export:"Экспорт карты", history:"История карты", delete:"Убрать ветку", "remove-thought":"Удалить мысль", "delete-map":"Удалить карту", settings:"Настройка карты" })[dialog]} onClose={saveDialog}>
      {error ? <p role="alert">{error}</p> : null}
      {dialog === "settings" && map ? <div className="mindmap-settings-panel"><div className="mindmap-title-row">
        <label>Название карты<input disabled={props.readOnly} value={map.title} maxLength={2000} data-dialog-initial-focus onChange={e => change({ ...map, title: e.target.value || "Без названия", nodes: map.nodes.map(n => n.parentId === null && n.kind === "idea" ? { ...n, text: e.target.value } : n) })}/></label>
        <div className="mindmap-actions mindmap-settings-actions" role="group" aria-label={translateText("Настройка карты")}>
          <IconActionButton icon="paste" label={translateText("Вставить текст")} disabled={props.readOnly} onClick={() => { setText(""); setPreview(null); setDialog("paste"); }}/>
          <IconActionButton icon="export" label={translateText("Экспорт")} onClick={() => setDialog("export")}/>
          <IconActionButton icon="history" label={translateText("История")} onClick={() => { setVersions([]); setDialog("history"); void repository.history(map.id).then(setVersions).catch(fail); }}/>
        </div></div>
        <label>Описание<textarea disabled={props.readOnly} rows={3} value={map.description ?? ""} maxLength={12000} onChange={e => change({ ...map, description: e.target.value })}/></label>
        <label>Контекстный проект<select disabled={props.readOnly} value={map.projectId || ""} onChange={e => change({ ...map, projectId: e.target.value || null })}><option value="">Без проекта</option>{props.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      </div> : null}
      {dialog === "create" ? <form onSubmit={e => { e.preventDefault(); try { const created = newMindmap(title,context || null,template,source => translateText(source)); setDialog(null); void open({document:created,revision:0,updatedAt:""}); change(created,false); } catch(e) { fail(e); } }}><label>Название карты<input required value={title} maxLength={2000} onChange={e => setTitle(e.target.value)} data-dialog-initial-focus /></label><label>Начать с<select value={template} onChange={e => setTemplate(e.target.value)}><option value="empty">Одна мысль</option><option value="idea">Разобрать идею</option><option value="project">План проекта</option><option value="decision">Выбрать решение</option></select></label><p>Шаблон создаёт только мысли.</p><button type="submit" className="primary-button">Создать карту</button></form> : null}
      {dialog === "node" ? inspector : null}
      {dialog === "link" && map?.links.find(link=>link.id===selectedLink) ? <MindmapLinkEditor key={selectedLink}
        link={map.links.find(link=>link.id===selectedLink)!} readOnly={props.readOnly}
        from={titleFor(map.nodes.find(item=>item.id===map.links.find(link=>link.id===selectedLink)!.from)!)}
        to={titleFor(map.nodes.find(item=>item.id===map.links.find(link=>link.id===selectedLink)!.to)!)}
        onSave={link=>{change({...map,links:map.links.map(item=>item.id===link.id?link:item)});saveDialog();}} onRemove={()=>removeLink(selectedLink!)}/> : null}
      {dialog === "delete-map" && deleteRecord ? <><h3 data-no-translate>{deleteRecord.document.title}</h3><p>Карта и история её версий будут удалены. Связанные задачи и проекты сохранятся.</p><div className="mindmap-actions"><button type="button" disabled={busy || props.readOnly} onClick={saveDialog}>Отмена</button><button type="button" className="danger-button" disabled={busy || props.readOnly} onClick={async () => {
        setBusy(true); setError("");
        try { await repository.remove(deleteRecord); setDialog(null); setDeleteRecord(null); await refresh(); }
        catch (error) { fail(new Error(error instanceof GenesisApiError && error.status === 409
          ? "Карта изменилась. Закройте окно, обновите каталог и повторите удаление."
          : "Не удалось удалить карту. Проверьте подключение и повторите попытку.")); }
        finally { setBusy(false); }
      }}>Удалить карту</button></div></> : null}
      {dialog === "delete" && map && node ? <><p>Убрать {descendants(map,node.id).size} узлов? Настоящие задачи и проекты останутся. Изменение карты можно отменить.</p><button type="button" className="danger-button" onClick={() => { change(removeBranch(map,node.id)); setSelected(map.nodes.find(n => n.parentId === null)!.id); setDialog(null); }}>Убрать только с карты</button></> : null}
      {dialog === "remove-thought" && map && node ? <><strong data-no-translate>{titleFor(node)}</strong><p>Дочерние мысли перейдут к родителю. Остальные мысли, задачи и проекты сохранятся. Изменение карты можно отменить.</p><div className="mindmap-actions"><button type="button" className="secondary-button" onClick={saveDialog}>Отмена</button><button type="button" className="danger-button" disabled={props.readOnly || !node.parentId} onClick={() => {
        if (props.readOnly || !node.parentId) return;
        const parentId = node.parentId; change(removeThought(map,node.id)); setSelected(parentId); setDialog(null);
        if (view.focus === node.id) changeView({ ...view, focus: parentId });
        requestAnimationFrame(() => document.querySelector<HTMLElement>(".mindmap-canvas")?.focus({ preventScroll: true }));
      }}>Удалить мысль</button></div></> : null}
      {dialog === "add" && map && node ? <><label>{props.spaceId ? "Поиск общих дел" : "Поиск личных дел"}<input value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} /></label><label><input type="checkbox" checked={chaosOnly} onChange={e => setChaosOnly(e.target.checked)} />Только «Хаос»</label><p>Добавляется ссылка. Проект задачи и её зависимости сохраняются. Для повторяющейся задачи выберите конкретный день перед привязкой.</p>
        {pickerTask ? <div className="mindmap-occurrence-picker"><h3>{pickerTask.title}</h3><label>День повторения<select value={pickerDate} onChange={e => setPickerDate(e.target.value)}>{recurrenceDatesForTask(pickerTask).map(date => <option key={date} value={date}>{date}</option>)}</select></label><p>На карте будет только выбранный экземпляр.</p><button type="button" className="primary-button" disabled={!pickerDate} onClick={() => addTaskReference(pickerTask, pickerDate)}>Привязать этот день</button></div> : null}
        <div className="mindmap-picker">{(props.taskSearch?.tasks ?? props.tasks).filter(t => !t.done && (!chaosOnly || !props.projectForTask(t)) && t.title.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map(t => <button type="button" key={t.id} onClick={() => { if (t.recurrenceMode !== "none") { setPickerTask(t); setPickerDate(recurrenceDatesForTask(t)[0] || ""); } else addTaskReference(t); }}><strong>{t.title}</strong><span>{t.done ? "Выполнено" : "В работе"} · {t.dueDate || "Без срока"} · {props.projects.find(p=>p.id===props.projectForTask(t))?.title || "Хаос"}</span></button>)}{props.projects.filter(p=>p.status!=="completed" && !chaosOnly && p.title.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map(p=><button type="button" key={p.id} onClick={()=>{const ref:MapNode={id:mapId(),parentId:node.id,kind:"project",refId:p.id,note:""};change({...map,nodes:[...map.nodes,ref]});setSelected(ref.id);setDialog(null);}}><strong>{p.title}</strong><span>{props.spaceId ? "Общий проект" : "Личный проект"}</span></button>)}</div>{props.taskSearch?.footer}
        <details className="mindmap-picker-completed" open={completedPickerOpen} onToggle={event=>{if(event.target===event.currentTarget)setCompletedPickerOpen(event.currentTarget.open);}}><summary>{translateText("Завершённые")}</summary>{completedPickerOpen?<><div className="mindmap-picker">{(props.taskSearch?.completedTasks ?? props.tasks).filter(t=>t.done && (!chaosOnly || !props.projectForTask(t)) && t.title.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map(t=><button type="button" key={t.id} onClick={() => { if (t.recurrenceMode !== "none") { setPickerTask(t); setPickerDate(recurrenceDatesForTask(t)[0] || ""); } else addTaskReference(t); }}><strong>{t.title}</strong><span>{t.done ? "Выполнено" : "В работе"} · {t.dueDate || "Без срока"} · {props.projects.find(p=>p.id===props.projectForTask(t))?.title || "Хаос"}</span></button>)}{props.projects.filter(p=>p.status==="completed" && !chaosOnly && p.title.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map(p=><button type="button" key={p.id} onClick={()=>{const ref:MapNode={id:mapId(),parentId:node.id,kind:"project",refId:p.id,note:""};change({...map,nodes:[...map.nodes,ref]});setSelected(ref.id);setDialog(null);}}><strong>{p.title}</strong><span>{props.spaceId ? "Общий проект" : "Личный проект"}</span></button>)}</div>{props.taskSearch?.completedFooter}</>:null}</details>{!props.tasks.length && !props.projects.length ? <p>Пока нечего добавить. Создайте мысль, а затем задачу.</p> : null}</> : null}
      {dialog === "paste" && map && node ? <><p>Одна строка — одна мысль; два пробела или табуляция — один уровень. Пустые строки пропускаются. До 200 мыслей за вставку.</p><textarea aria-label="Текст для вставки" rows={8} value={text} maxLength={100000} onChange={e=>{setText(e.target.value);setPreview(null);}} /><button type="button" onClick={()=>{try {const nodes=parseOutline(text,node.id);setPreview(validateMindmap({...map,nodes:[...map.nodes,...nodes]}));}catch(e){fail(e);}}}>Предпросмотр вставки</button>{preview?.id===map.id ? <><pre>{mapMarkdown(preview,titleFor)}</pre><button type="button" className="primary-button" onClick={()=>{change(preview);setPreview(null);setDialog(null);}}>Добавить мысли</button></> : null}</> : null}
      {dialog === "import" ? <><p>Собственный JSON GENESIS v1, до 2 МБ. Импорт не создаёт задач и не предоставляет доступ.</p><input type="file" accept=".json,application/json" aria-label="Выберите JSON карты" onChange={async e=>{const file=e.target.files?.[0];if(!file||!transfer.check())return;setPreview(null);try{if(file.size>2_000_000)throw new Error("Файл больше 2 МБ.");const text=await file.text();if(!transfer.check())return;setPreview(importMindmap(text));}catch(e){fail(e);}}}/>{preview ? <><h3>{preview.title}</h3><p>{preview.nodes.length} узлов · {preview.links.length} связей. Недоступные ссылки останутся помеченными; прав они не дают.</p><pre>{mapMarkdown(preview,titleFor)}</pre><label><input type="checkbox" checked={importAsIdeas} onChange={e=>setImportAsIdeas(e.target.checked)}/>Превратить недоступные ссылки в мысли</label><button type="button" className="primary-button" onClick={()=>{if(!transfer.check())return;const copy=validateMindmap({...preview,id:mapId(),nodes:preview.nodes.map(n=>importAsIdeas && ((n.kind==="task" && !resolveMapTask(n,props.tasks)) || (n.kind==="project" && !props.projects.some(p=>p.id===n.refId))) ? {id:n.id,parentId:n.parentId,kind:"idea",text:"Недоступная ссылка",note:n.note}:n),projectId:props.projects.some(p=>p.id===preview.projectId)?preview.projectId:null});setDialog(null);void open({document:copy,revision:0,updatedAt:""});change(copy,false);}}>Импортировать отдельную карту</button></> : null}</> : null}
      {dialog === "export" && map ? <><p>Файл будет незашифрованным. JSON содержит мысли, пояснения и ID ссылок; Markdown и SVG также содержат доступные названия задач и проектов. Храните файл в безопасном месте.</p><p>Для PDF выберите «Сохранить как PDF» в окне печати. Обзор сохраняет цвета и связи; структура содержит полные названия и пояснения.</p><div className="mindmap-export-group" role="group" aria-label={translateText("Экспортировать")}><strong>{translateText("Экспортировать")}</strong><div className="mindmap-export-formats">{["JSON","Markdown","SVG","PDF"].map(format=><button type="button" key={format} onClick={()=>{ if(!transfer.check())return;if(format==="PDF"){try {printMindmap(map,titleFor,view);}catch(e){fail(e);}return;}download(`GENESIS-map.${format==='JSON'?'json':format==='SVG'?'svg':'md'}`,format==='JSON'?exportMindmap(map):format==='SVG'?mapSvg(map,titleFor,view):mapMarkdown(map,titleFor),format==='SVG'?'image/svg+xml':'text/plain;charset=utf-8');}} data-no-translate>{format}</button>)}</div></div></> : null}
      {dialog === "history" && map ? <><p>Последние 20 подтверждённых версий. Восстановление меняет только карту; задачи не откатываются.</p>{versions.map(v=><article key={v.revision}><h3>Версия {v.revision}</h3><p>{v.updatedAt} · {v.document.title} · {v.document.nodes.length} узлов</p><details><summary>Посмотреть содержимое</summary><pre>{mapMarkdown(v.document,titleFor)}</pre></details><button type="button" disabled={props.readOnly} onClick={()=>{change(v.document);setDialog(null);}}>Восстановить эту версию карты</button></article>)}</> : null}
    </Dialog> : null}
  </section>;
}
