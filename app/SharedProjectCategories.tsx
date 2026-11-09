"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { type CSSProperties, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { deleteSharedProjectCategory, saveSharedProjectCategory, type SharedCategory, type SharedProject } from "./cloud-sync";
import { translateText, getRuntimeLanguage } from "./i18n";
import { formatProjectCount } from "./task-count-i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { CategorySection } from "./CategorySection";

export function SharedProjectCategories({ spaceId, categories, projects, canManage, english, expanded, onExpanded, view, onView, onChanged, onOpen }: {
  spaceId: string; categories: SharedCategory[]; projects: SharedProject[]; canManage: boolean; english: boolean;
  onChanged: () => Promise<void>; onOpen: (project: SharedProject) => void;
  expanded: boolean; onExpanded: (expanded: boolean) => void;
  view: "cards" | "list"; onView: (view: "cards" | "list") => void;
}) {
  const [editing, setEditing] = useState<SharedCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#2d6c68");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (formOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input:not([type="color"])')?.focus();
    }
    if (!formOpen && dialog.open) dialog.close();
  }, [formOpen]);
  const openForm = (category: SharedCategory | null) => {
    setEditing(category); setTitle(category?.title ?? ""); setColor(category?.color ?? "#2d6c68");
    setMessage(""); setFormOpen(true);
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); await onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    void run(async () => {
      await saveSharedProjectCategory(spaceId, { title: title.trim(), color, expectedRevision: editing?.revision }, editing?.id);
      setFormOpen(false); setEditing(null); setTitle("");
    });
  };
  const projectItems = projects.filter(project => !project.isInbox && project.kind !== "task-list");
  return <><CategorySection expanded={expanded} onExpanded={onExpanded} view={view} onView={onView} onCreate={canManage && !busy ? ()=>openForm(null) : undefined}>
    <div className="shared-category-list">
      {[...categories, { id: "", title: english ? "No category" : "Без категории", color: "#718077", position: 0, revision: 0 }].map(category => {
        const items = projectItems.filter(project => (project.categoryId ?? "") === category.id);
        return <article key={category.id} style={{ "--category-color": category.color } as CSSProperties}>
          <header className="shared-category-header">
          <i aria-hidden="true" /><h4 data-no-translate>{category.id ? category.title : translateText("Без категории")}</h4><span className="shared-category-count" data-no-translate>{formatProjectCount(items.length,getRuntimeLanguage())}</span>
          {category.id && canManage ? <div className="category-actions">
            <button type="button" disabled={busy} data-no-translate aria-label={`${translateText("Редактировать категорию")} «${category.title}»`}
              onClick={() => openForm(category)}><ExperimentalIcon name="edit" /></button>
            <button type="button" disabled={busy} data-no-translate aria-label={`${translateText("Удалить категорию")} «${category.title}»`}
              onClick={() => { if (window.confirm(translateText("Удалить категорию? Проекты и задачи сохранятся."))) void run(async () => {
                await deleteSharedProjectCategory(spaceId, category.id, category.revision);
                if (editing?.id === category.id) { setEditing(null); setTitle(""); }
              }); }}><ExperimentalIcon name="delete" /></button>
          </div> : null}
          </header>
          {items.length ? <div className="shared-category-projects">{items.map(project => <button type="button" key={project.id} onClick={() => onOpen(project)}>
            <ExperimentalIcon name="projects" /><span>{project.title}</span>
          </button>)}</div> : null}
        </article>;
      })}
    </div>
    {message && !formOpen ? <p role="status">{message}</p> : null}
    </CategorySection>
    {canManage ? <dialog ref={dialogRef} className="shared-projects-modal shared-category-modal" aria-labelledby={dialogTitleId}
      onCancel={event => { if (busy) event.preventDefault(); }}
      onClose={() => { setFormOpen(false); setEditing(null); }}>
      {formOpen ? <>
        <header><h2 id={dialogTitleId}>{editing ? (english ? "Edit category" : "Редактировать категорию") : (english ? "New category" : "Новая категория")}</h2>
          <DialogCloseButton type="button" className="shared-projects-close" disabled={busy} aria-label={english ? "Close" : "Закрыть"} onClick={() => setFormOpen(false)} />
        </header>
        <form className="shared-category-form" onSubmit={submit}>
          <label>{english ? "Category name" : "Название категории"}<input maxLength={80} required value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
          <label>{english ? "Color" : "Цвет"}<input type="color" value={color} disabled={busy} onChange={event => setColor(event.target.value)} /></label>
          {message ? <p role="alert">{message}</p> : null}
          <div className="shared-category-form-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setFormOpen(false)}>{english ? "Cancel" : "Отмена"}</button>
            <button type="submit" className="primary-button" disabled={busy || !title.trim()}>{editing ? (english ? "Save" : "Сохранить") : (english ? "Create category" : "Создать категорию")}</button>
          </div>
        </form>
      </> : null}
    </dialog> : null}
  </>;
}
