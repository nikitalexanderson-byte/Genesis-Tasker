"use client";
import { solarModelTranslator } from "./solar-model-copy";
import { localizeSolarModel } from "./solar-model-localization.js";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { MONTHS, PYATA_DETAILS, getGregorianDate, getSacredDate, getSacredDay } from "./calendar-data";
import { DialogCloseButton } from "./DialogCloseButton";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import { translateText, type Language } from "./i18n";
import { SOLAR_OVERVIEW, fitSolarElement, zoomSolarCamera, solarCameraTransform, type SolarCamera } from "./solar-calendar-camera";
import { createSolarCameraMotion } from "./solar-calendar-motion";
import "./solar-calendar-explorer.css";

type Selection = { kind: "month" | "pentad" | "day"; month: number; day: number };
type Point = { x: number; y: number };
const ASSET = "/calendar-art/genesis-sacred-calendar-v8.svg";
const readSelection = (node: Element): Selection => ({ kind: node.getAttribute("data-kind") as Selection["kind"], month: Number(node.getAttribute("data-month")) - 1,
  day: Number(node.getAttribute("data-day") || node.getAttribute("data-first") || 1) });
const selectorFor = (s: Selection) => s.kind === "pentad" ? `[data-kind="pentad"][data-month="${s.month + 1}"][data-pentad="${Math.ceil(s.day / 5)}"]`
  : `[data-kind="${s.kind}"][data-month="${s.month + 1}"]${s.kind === "day" ? `[data-day="${s.day}"]` : ""}`;

export default function SolarCalendarExplorer({ year, language, onClose, onOpenDate }: {
  year: number; language: Language; onClose: () => void; onOpenDate: (month: number, day: number) => void;
}) {

  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const viewport = useRef({ width: 0, height: 0 });
  const motion = useRef<ReturnType<typeof createSolarCameraMotion> | null>(null);
  const targets = useRef(new Map<string, SVGGraphicsElement>());
  const siblings = useRef(new Map<string, SVGGraphicsElement[]>());
  const selectedNode = useRef<SVGGraphicsElement | null>(null);
  const tabStop = useRef<SVGGraphicsElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [selection, setSelection] = useState<Selection | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ origin: Point; camera: SolarCamera; distance: number } | null>(null);
  const moved = useRef(false);
  const hovered = useRef<Element | null>(null);
  const currentCamera = useCallback(() => motion.current?.current ?? SOLAR_OVERVIEW, []);
  const moveCamera = useCallback((target: SolarCamera, animate = true) => {
    if (animate) setZoom(Math.round(500000 / target.size));
    motion.current?.move(target, animate);
  }, []);

  useEffect(() => {
    const node = host.current, plane = layer.current;
    if (!node || !plane) return;
    const transform = (camera: SolarCamera) => {
      const { scale, x, y } = solarCameraTransform(camera, viewport.current.width, viewport.current.height);
      return `matrix(${scale},0,0,${scale},${x},${y})`;
    };
    const controller = createSolarCameraMotion({ now: () => performance.now(), requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
      delay: (callback, ms) => window.setTimeout(callback, ms), clearDelay: id => window.clearTimeout(id),
      reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      render: camera => {
        const { width, height } = viewport.current;
        if (!width || !height) return;
        plane.style.transform = transform(camera);
      },
      animate: typeof plane.animate === "function" ? (from, to, finished) => {
        const animation = plane.animate([{ transform: transform(from) }, { transform: transform(to) }],
          { duration: 420, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
        animation.onfinish = finished;
        return {
          current: () => {
            const progress = Number(animation.effect?.getComputedTiming().progress ?? 0);
            // Matrix scale is reciprocal to the camera size, so interpolate in projection space.
            const inverse = (1 - progress) / from.size + progress / to.size;
            return { size: 1 / inverse, x: ((1 - progress) * from.x / from.size + progress * to.x / to.size) / inverse,
              y: ((1 - progress) * from.y / from.size + progress * to.y / to.size) / inverse };
          },
          cancel: () => { animation.onfinish = null; animation.cancel(); },
        };
      } : undefined,
      onMoving: moving => { plane.style.willChange = moving ? "transform" : ""; },
      onSettled: camera => setZoom(Math.round(500000 / camera.size)),
    });
    motion.current = controller;
    const resize = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; viewport.current = { width, height }; controller.refresh(); });
    resize.observe(node);
    const visibility = () => { if (document.hidden) controller.interrupt(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { resize.disconnect(); document.removeEventListener("visibilitychange", visibility); controller.dispose(); motion.current = null; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(ASSET, { signal: controller.signal }).then(response => { if (!response.ok) throw Error("SVG_UNAVAILABLE"); return response.text(); }).then(source => {
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      const svg = document.documentElement;
      if (svg.localName !== "svg" || document.querySelector("parsererror")) throw Error("SVG_INVALID");
      const imported = window.document.adoptNode(svg);
      localizeSolarModel(imported, solarModelTranslator(language), language);
      targets.current.clear(); siblings.current.clear();
      imported.querySelectorAll<SVGGraphicsElement>("[data-kind]").forEach((node, index) => {
        const s = readSelection(node), month = translateText(MONTHS[s.month].name, language);
        const label = s.kind === "month" ? month : s.kind === "pentad" ? `${month} · ${translateText("Пята", language)} ${Math.ceil(s.day / 5)}` : `${month} · ${translateText("День", language)} ${s.day}`;
        node.setAttribute("role", "button"); node.setAttribute("aria-label", label); node.setAttribute("tabindex", index === 0 ? "0" : "-1");
        targets.current.set(selectorFor(s), node);
        const group = siblings.current.get(s.kind) ?? []; group.push(node); siblings.current.set(s.kind, group);
        if (!index) tabStop.current = node;
      });
      layer.current?.replaceChildren(imported); setReady(true);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); };
  }, [attempt, language]);

  useEffect(() => {
    const node = host.current;
    if (!ready || !node) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); moveCamera(zoomSolarCamera(currentCamera(), Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .004)), false); };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [ready, moveCamera, currentCamera]);

  const select = (next: Selection, focus = false) => {
    const node = targets.current.get(selectorFor(next));
    if (!node) return;
    selectedNode.current?.removeAttribute("data-selected");
    tabStop.current?.setAttribute("tabindex", "-1");
    node.setAttribute("data-selected", "true"); node.setAttribute("tabindex", "0");
    selectedNode.current = node; tabStop.current = node;
    if (focus) node.focus({ preventScroll: true });
    setSelection(next);
    // getBBox is in the SVG's own coordinates, independent of the current camera.
    moveCamera(fitSolarElement(node.getBBox()));
  };
  const reset = () => { setSelection(null); selectedNode.current?.removeAttribute("data-selected"); selectedNode.current = null; moveCamera(SOLAR_OVERVIEW); };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<SVGGraphicsElement>("[data-kind]") : null;
    if (!target) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(readSelection(target)); }
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const group = siblings.current.get(target.dataset.kind!)!;
    const next = group[(group.indexOf(target) + direction + group.length) % group.length];
    select(readSelection(next), true);
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    motion.current?.interrupt();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()]; moved.current = points.length > 1;
    gesture.current = { origin: points[0], camera: currentCamera(), distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()], start = gesture.current;
    if (points.length > 1) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (distance && start.distance) moveCamera(zoomSolarCamera(start.camera, start.distance / distance), false);
      moved.current = true; return;
    }
    const dx = event.clientX - start.origin.x, dy = event.clientY - start.origin.y;
    if (Math.hypot(dx, dy) < 5 && !moved.current) return;
    moved.current = true; event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = start.camera.size / Math.min(viewport.current.width, viewport.current.height);
    moveCamera({ ...start.camera, x: start.camera.x - dx * ratio, y: start.camera.y - dy * ratio }, false);
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const remaining = [...pointers.current.values()][0];
    gesture.current = remaining ? { origin: remaining, camera: currentCamera(), distance: 0 } : null;
  };
  const month = selection?.month ?? 0, day = selection?.day ?? 1, pentad = Math.ceil(day / 5);
  const currentMonth = MONTHS[month], dayLimit = month === 12 ? getSacredDate(getGregorianDate(year,0,1)).apeironDays : 30;
  const sacredDay = getSacredDay(month, day, language);
  const exists = day <= dayLimit;
  const date = exists ? getGregorianDate(year, month, day) : null;
  const monthLabel = translateText(currentMonth.name, language);
  return <div className="modal-backdrop solar-model-backdrop">
    <section ref={dialogRef} className="solar-model-dialog" role="dialog" aria-modal="true" aria-labelledby="solar-model-title" aria-describedby="solar-model-help" tabIndex={-1}>
      <header className="solar-model-header"><div><h2 id="solar-model-title">{translateText("Круг GENESIS", language)}</h2><p>{translateText("Солнечный календарь", language)} · {year}</p></div>
        <DialogCloseButton onClick={onClose} aria-label={translateText("Закрыть модель календаря", language)} /></header>
      <div className="solar-model-layout">
        <div className="solar-model-canvas">
          <div className="solar-model-toolbar"><button type="button" onClick={reset} disabled={!ready}>{translateText("Весь круг", language)}</button>
            <div><button type="button" disabled={!ready || zoom <= 100} onClick={() => moveCamera(zoomSolarCamera(currentCamera(), 1.4))} aria-label={translateText("Отдалить", language)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
              <output aria-label={translateText("Масштаб", language)}>{zoom}%</output>
              <button type="button" disabled={!ready || zoom >= 1563} onClick={() => moveCamera(zoomSolarCamera(currentCamera(), 1 / 1.4))} aria-label={translateText("Приблизить", language)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button></div></div>
          {/* SVG buttons own keyboard focus; this group delegates their pointer and key events. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div ref={host} className="solar-svg-host" role="group" aria-label={translateText("Интерактивный круг календаря", language)} aria-describedby="solar-model-help"
            onClick={event => { if (moved.current) return; const target = event.target instanceof Element ? event.target.closest("[data-kind]") : null; if (target) select(readSelection(target)); }}
            onKeyDown={keyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
            onPointerOver={event => { const target = event.target instanceof Element ? event.target.closest("[data-kind]") : null; if (target === hovered.current) return; hovered.current?.removeAttribute("data-hovered"); target?.setAttribute("data-hovered", "true"); hovered.current = target; }}
            onPointerLeave={() => { hovered.current?.removeAttribute("data-hovered"); hovered.current = null; pointers.current.clear(); gesture.current = null; }}><div ref={layer} className="solar-svg-layer" data-no-translate /></div>
          {!ready ? <div className="solar-model-loading" role={failed ? "alert" : "status"}><p>{failed ? (translateText("Не удалось загрузить календарь.", language)) : (translateText("Открываем круг…", language))}</p>
            {failed ? <button type="button" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>{translateText("Повторить", language)}</button> : null}</div> : null}
          <p id="solar-model-help" className="solar-model-help">{translateText("Нажмите на месяц, пяту или день, чтобы приблизить. Перетаскивайте круг; меняйте масштаб колёсиком или двумя пальцами.", language)}</p>
        </div>
        <aside className="solar-model-inspector" aria-label={translateText("Навигация по кругу", language)}>
          <div className="solar-model-selectors">
            <label>{translateText("Месяц", language)}<select value={selection ? month : ""} disabled={!ready} onChange={e => select({ kind: "month", month: Number(e.target.value), day: 1 })}><option value="" disabled>{translateText("Выберите месяц", language)}</option>{MONTHS.map(item => <option key={item.index} value={item.index}>{translateText(item.name, language)}</option>)}</select></label>
            <label>{translateText("Пята", language)}<select value={selection?.kind === "month" || !selection ? "" : pentad} disabled={!ready || !selection || month === 12} onChange={e => select({ kind: "pentad", month, day: (Number(e.target.value) - 1) * 5 + 1 })}><option value="" disabled>{translateText("Выберите пяту", language)}</option>{PYATA_DETAILS.map((item,index) => <option value={index + 1} key={item.title}>{index + 1} · {translateText(item.title,language)}</option>)}</select></label>
            <label>{translateText("День", language)}<select value={selection?.kind === "day" ? day : ""} disabled={!ready || !selection} onChange={e => select({ kind: "day", month, day: Number(e.target.value) })}><option value="" disabled>{translateText("Выберите день", language)}</option>{Array.from({ length: dayLimit }, (_,index) => <option value={index+1} key={index}>{index + 1} · {translateText(getSacredDay(month,index+1,language).name.split("(")[0].trim(),language)}</option>)}</select></label>
          </div>
          <div className="solar-model-selection" aria-live="polite">
            <h3>{selection ? selection.kind === "day" ? translateText(sacredDay.name.split("(")[0].trim(),language) : monthLabel : (translateText("Год в одном круге", language))}</h3>
            <p>{selection ? selection.kind === "month" ? translateText(currentMonth.title,language) : selection.kind === "pentad" ? translateText(PYATA_DETAILS[pentad-1].description,language) : translateText(sacredDay.description,language) : (translateText("12 месяцев, 72 пяты и 360 дней. В центре — Апейрон, вне обычного счёта.", language))}</p>
            {selection && selection.kind !== "month" && date ? <time dateTime={`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}>{date.toLocaleDateString(language, { day:"numeric", month:"long", year:"numeric" })}{selection.kind === "pentad" ? ` — ${getGregorianDate(year,month,Math.min(day+4,dayLimit)).toLocaleDateString(language,{day:"numeric",month:"long"})}` : ""}</time> : null}
            {selection && !exists ? <p>{translateText("В выбранном году этот неявный день не входит в календарный счёт.", language)}</p> : null}
            {selection ? <button type="button" className="solar-model-open-day" disabled={!exists} onClick={() => onOpenDate(month,day)}>{translateText("Открыть день в календаре", language)}</button> : null}
          </div>
        </aside>
      </div>
    </section>
  </div>;
}
