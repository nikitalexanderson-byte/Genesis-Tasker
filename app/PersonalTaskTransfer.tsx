"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useState } from "react";
import {
  createSharedTask, listSharedProjects, listSharedSpaces, loadSharedProject,
  removeCloudTaskForTransfer,
  type GenesisTask, type SharedProject, type SharedProjectSnapshot, type SharedSpace,
} from "./cloud-sync";
import { sharedProjectDestinations } from "./shared-expansion";
import { translateText, type Language } from "./i18n";
import { useDialogAccessibility } from "./use-dialog-accessibility";
import "./personal-task-transfer.css";

type Props = {
  task: GenesisTask;
  language: string;
  personalCalendarConnected: boolean;
  onClose: () => void;
  onMoved: (taskId: string) => void;
};

function moveRestriction(task: GenesisTask, calendarConnected: boolean): string | null {
  if (task.title !== task.title.trim().replace(/\s+/gu, " ") || task.description !== task.description.trim()) return "fields";
  if (task.done) return "completed";
  if (calendarConnected || task.createdIn !== "genesis" || task.googleEventId || task.googleTaskId
    || task.googleTaskListId || Object.keys(task.googleLinks ?? {}).length || task.syncAccountIds.length
    || task.googleAccountId || task.googleReadOnly) return "external";
  if (task.recurrence !== "none" || task.recurrenceMode !== "none" || task.recurrenceSeriesId
    || task.recurrencePattern !== "none") return "recurrence";
  if (task.time || (task.endDate && task.endDate !== task.dueDate) || task.reminders.length
    || task.dependsOnIds.length || task.priority !== 5 || task.categoryId
    || task.yandexEntryType === "meeting" || task.calendarMode !== "profane" || task.calendarNote
    || task.yandexLocation || task.yandexTelemostUrl || task.yandexAttendees?.length
    || task.yandexOptionalAttendees?.length || task.yandexReminders?.length) return "fields";
  return null;
}

export function PersonalTaskTransfer({ task, language, personalCalendarConnected, onClose, onMoved }: Props) {
  const english = language === "en";
  const [groups, setGroups] = useState<{ space: SharedSpace; projects: SharedProject[] }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [snapshot, setSnapshot] = useState<SharedProjectSnapshot | null>(null);
  const [includeDescription, setIncludeDescription] = useState(true);
  const [includeDueDate, setIncludeDueDate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose);
  const restriction = moveRestriction(task, personalCalendarConnected);
  const canMove = !restriction && includeDescription && includeDueDate;
  const publishedTitle = task.title.trim().replace(/\s+/gu, " ");
  const publishedDescription = includeDescription ? task.description.trim() : "";
  const destinations = groups.map(group => ({ ...group, rows: sharedProjectDestinations(group.projects)
    .filter(({ project }) => ["owner", "manager", "member"].includes(project.role)) })).filter(group => group.rows.length);
  const selectedGroup = destinations.find(group => group.rows.some(({ project }) => project.id === projectId));
  const selectedRow = selectedGroup?.rows.find(({ project }) => project.id === projectId);
  const inboxTitle = translateText("Хаос-бокс", language as Language);
  const destinationPath = selectedGroup && selectedRow ? `${selectedGroup.space.title} › ${selectedRow.project.isInbox ? inboxTitle : selectedRow.path}` : "";

  useEffect(() => {
    let active = true;
    void (async () => {
      const spaces = await listSharedSpaces();
      const groups = await Promise.all(spaces.map((space) => listSharedProjects(space.id)));
      if (!active) return;
      const writable = groups.flat().filter((project) => ["owner", "manager", "member"].includes(project.role));
      setGroups(spaces.map((space, index) => ({ space, projects: groups[index] })));
      setProjectId(writable[0]?.id ?? "");
    })().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void loadSharedProject(projectId).then((result) => { if (active) setSnapshot(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [projectId]);

  const publish = async (move: boolean) => {
    if(task.entryType === "birthday"){setError(english ? "Birthdays stay in personal affairs." : "Дни рождения сохраняются только в личных делах.");return;}
    if (!snapshot || busy || (move && !canMove)) return;
    const status = snapshot.statuses.find((item) => !item.isDone);
    if (!status) { setError(english ? "The destination has no matching status." : "В проекте нет подходящего статуса."); return; }
    setBusy(true);
    setError("");
    try {
      const published = await createSharedTask(snapshot.project.id, {
        ...(move ? { sourceTaskId: task.id } : {}),
        title: publishedTitle,
        entryType: task.entryType,
        tags: task.tags,
        description: publishedDescription,
        dueDate: includeDueDate ? task.dueDate || null : null,
        statusId: status.id,
      });
      if (!published?.id || published.projectId !== snapshot.project.id || published.title !== publishedTitle
        || published.description !== publishedDescription
        || published.dueDate !== (includeDueDate ? task.dueDate || null : null)
        || published.statusId !== status.id) {
        throw new Error(english ? "The server did not confirm the shared task." : "Сервер не подтвердил создание общей задачи.");
      }
      if (move) {
        await removeCloudTaskForTransfer(task);
        onMoved(task.id);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={dialogRef} className="editor-modal personal-task-transfer" role="dialog" aria-modal="true"
      aria-labelledby="personal-task-transfer-title" tabIndex={-1}>
      <DialogCloseButton type="button" className="modal-close" disabled={busy} onClick={onClose} aria-label={english ? "Close" : "Закрыть"} />
      <span className="eyebrow">{english ? "Private → shared" : "Личное → общее"}</span>
      <h2 id="personal-task-transfer-title">{english ? "Move to shared projects" : "Переместить в общие"}</h2>
      <p>{english
        ? "Preview the exact fields visible to project members. Shared data is processed by the GENESIS server."
        : "Проверьте поля, которые увидят участники проекта. Общие данные обрабатываются сервером GENESIS."}</p>
      <label><span>{english ? "Shared project" : "Общий проект"}</span>
        <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSnapshot(null); }} disabled={busy}>
          {destinations.map(group => <optgroup key={group.space.id} label={group.space.title} data-no-translate>
            {group.rows.map(({ project, depth, path }) => <option key={project.id} value={project.id} data-no-translate>
              {depth ? `${"\u00a0\u00a0".repeat(depth)}↳ ` : ""}{project.isInbox ? `${inboxTitle} (${group.space.title})` : path}
            </option>)}
          </optgroup>)}
        </select>
      </label>
      {destinationPath ? <p className="transfer-destination-path" data-no-translate>{destinationPath}</p> : null}
      {!destinations.length ? <p>{english ? "Create a shared project first." : "Сначала создайте общий проект."}</p> : null}
      <div className="personal-task-transfer-preview">
        <strong>{english ? "Members will see" : "Участники увидят"}</strong>
        <p data-no-translate>{publishedTitle}</p>
        {task.tags.length ? <p>{task.tags.map((tag) => `#${tag}`).join(" ")}</p> : null}
        {task.description ? <label><input type="checkbox" checked={includeDescription} onChange={(event) => setIncludeDescription(event.target.checked)} />
          {english ? "Description" : "Описание"}: <span data-no-translate>{task.description.trim()}</span></label> : null}
        {task.dueDate ? <label><input type="checkbox" checked={includeDueDate} onChange={(event) => setIncludeDueDate(event.target.checked)} />
          {english ? "Due date" : "Срок"}: <time>{task.dueDate}</time></label> : null}
        <small>{english ? "Open status; completion history stays private" : "Статус: открыто; история завершения останется личной"}</small>
      </div>
      <p className="personal-task-transfer-limit">{english
        ? "Time, reminders, repetition, dependencies, priority, calendar settings and Google links do not transfer."
        : "Время, напоминания, повторения, зависимости, приоритет, параметры календаря и связи Google не передаются."}</p>
      {restriction ? <p role="status">{english
        ? "This task has linked or unsupported private fields. You can publish a copy; the personal original stays in place."
        : "У задачи есть связанные или неподдерживаемые личные поля. Можно опубликовать копию; личный оригинал останется на месте."}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button type="button" className="text-button" disabled={busy} onClick={onClose}>{english ? "Cancel" : "Отмена"}</button>
        <button type="button" className="text-button" disabled={busy || !snapshot} onClick={() => void publish(false)}>{english ? "Publish a copy" : "Опубликовать копию"}</button>
        <button type="button" className="primary-button" disabled={busy || !snapshot || !canMove} onClick={() => void publish(true)}>{english ? "Move task" : "Переместить задачу"}</button>
      </div>
    </section>
  </div>;
}
