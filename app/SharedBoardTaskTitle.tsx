import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";

export function SharedBoardTaskTitle({ title, lines, english, selected, onOpen, children }: {
  title: string; lines: number; english: boolean; selected: boolean; onOpen: () => void; children: ReactNode;
}) {
  const id = useId();
  const element = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const text = element.current;
    if (!text || expanded || !lines) return;
    const measure = () => setOverflow(text.scrollHeight > text.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(text); const frame = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [title, lines, expanded]);
  return <div className="shared-board-task-heading">
    <button type="button" className="shared-projects-task-open" data-affair-drag-surface onClick={onOpen} aria-pressed={selected}>
      <strong ref={element} id={id} className={lines && !expanded ? "shared-task-title-clamped" : undefined}
        style={{ "--board-task-title-lines": lines } as CSSProperties} title={title}>{title}</strong>{children}
    </button>
    {lines > 0 && (overflow || expanded) ? <button type="button" className="shared-task-title-toggle" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(value => !value)}><ExperimentalIcon name="chevron" />{expanded ? (english ? "Collapse title" : "Свернуть название") : (english ? "Expand title" : "Развернуть название")}</button> : null}
  </div>;
}
