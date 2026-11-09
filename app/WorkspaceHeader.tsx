import { useId, useState, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { translateText } from "./i18n";

/** Shared presentation contract for personal and team workspaces. */
export function WorkspaceHeader({ title, description, mark, context, children, overviewLabel }: {
  title: string; description: string; mark: ReactNode; context?: ReactNode; children?: ReactNode; overviewLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const localizedTitle = translateText(title);
  return <header className="workspace-header" data-exp-ui="panel" data-mobile-expanded={overviewLabel ? expanded : undefined}>
    <div className="workspace-header-main">{mark}
      <div className="workspace-header-copy"><h1>{localizedTitle.includes(" · ") ? <>{localizedTitle.split(" · ")[0]}<span className="workspace-title-secondary"> · <em>{localizedTitle.split(" · ").slice(1).join(" · ")}</em></span></> : localizedTitle}</h1><div id={`${id}-context`} className="workspace-header-context">{description ? <p>{description}</p> : null}{context}</div></div>
    </div>
    {children ? <div id={`${id}-summary`} className="workspace-header-summary">{children}</div> : null}
    {overviewLabel ? <button type="button" className="workspace-overview-toggle" aria-expanded={expanded} aria-controls={`${id}-context${children ? ` ${id}-summary` : ""}`} onClick={() => setExpanded(value => !value)}><ExperimentalIcon name="chevron"/>{translateText("Обзор")}</button> : null}
  </header>;
}

export function TasksHeroMark() {
  return <span className="projects-hero-mark tasks-hero-mark" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" focusable="false">
      <path d="M16 8H8v32h32V8h-8M18 6h12v8H18V6Z" />
      <path d="m14 23 3 3 5-6m4 4h9m-21 9 3 3 5-6m4 4h9" />
    </svg>
  </span>;
}
