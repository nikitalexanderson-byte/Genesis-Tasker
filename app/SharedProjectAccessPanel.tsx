"use client";

import { useEffect, useRef, useState } from "react";
import {IconActionButton} from './IconActionButton';
import {useSharedEditorDrafts} from './use-shared-editor-drafts';
import {SharedEditorDraftRecovery} from './SharedEditorDraftRecovery';
import {WorkDraftError} from './shared-work-draft-journal';
import {workflowDraftError} from './workflow-draft-copy';
import {validateProjectAccessEditor,type ProjectAccessEditorSnapshot} from './c-workflow-device-drafts';
import './shared-templates.css';
import { GenesisApiError, loadSharedProjectAccess, previewSharedProjectAccess, saveSharedProjectAccess } from "./cloud-sync";
import { translateText, type Language } from "./i18n";
import type { ProjectAccessPermissions, ProjectGrantRole, SharedProjectAccessCommand, SharedProjectAccessDraft, SharedProjectAccessPreview, SharedProjectAccessState } from "./shared-project-access";
import "./shared-project-access.css";

const roleLabels = { member: "Редактирование", commenter: "Комментарии", viewer: "Просмотр", none: "Нет доступа" } as const;
function accessError(error: unknown,language:Language) {
  if(error instanceof WorkDraftError||error instanceof Error&&/^(DRAFT_|SHARED_EDITOR_)/.test(error.message))return workflowDraftError(error,language);
  const code = error instanceof GenesisApiError ? String(error.payload?.error ?? error.message) : "";
  if (code === "PROJECT_ACCESS_CONFLICT") return "Права или структура проектов изменились. Обновите предпросмотр; ваш выбор сохранён.";
  if (code === "PROJECT_ACCESS_OPERATION_REUSED") return "Эта операция уже использована. Обновите предпросмотр и повторите.";
  if (code === "LAST_OWNER") return "Сначала передайте владение проектом другому участнику.";
  if (code === "PROJECT_ACCESS_MANAGER_UNRESTRICTED") return "Ограничения по проектам доступны для участников и гостей.";
  if (error instanceof GenesisApiError && [401, 403, 404].includes(error.status)) return "Нет доступа к изменению этих прав. Обновите данные.";
  return "Не удалось загрузить или сохранить права. Проверьте соединение и повторите.";
}

export function SharedProjectAccessPanel({ spaceId, userId, actorId, language, disabled = false, onChanged }: {
  spaceId: string; userId: string; actorId:string; language: Language; disabled?: boolean; onChanged: () => Promise<void>;
}) {
  const t = (source: string) => translateText(source, language);
  const [state, setState] = useState<SharedProjectAccessState | null>(null);
  const [draft, setDraft] = useState<SharedProjectAccessDraft>({ allProjects: false, grants: [] });
  const [preview, setPreview] = useState<SharedProjectAccessPreview | null>(null), [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50), [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const mounted = useRef(true), lock = useRef(false), request = useRef<AbortController | null>(null);
  const recovery=useSharedEditorDrafts(actorId,spaceId,spaceId,'project-access',validateProjectAccessEditor);
  const matchingRecovery={...recovery,rows:recovery.rows.filter(row=>row.value.editor.targetUserId===userId)};
  const blocked=recovery.locked||matchingRecovery.rows.some(row=>row.value.phase==='pending'&&row.value.attempts>0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const draftKey = (value: SharedProjectAccessDraft) => JSON.stringify([value.allProjects, value.allProjects ? [] : [...value.grants].sort((a,b)=>a.projectId.localeCompare(b.projectId))]);
  const dirty = Boolean(state && draftKey(state) !== draftKey(draft));
  useEffect(() => { if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard); },[dirty]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(""); setStatus("");
    const controller = new AbortController(); request.current = controller;
    try { await work(controller.signal); }
    catch (reason) { if (mounted.current && !controller.signal.aborted) {
      setError(accessError(reason,language));
      if(reason instanceof GenesisApiError && reason.status===409)setPreview(null);
      if(reason instanceof GenesisApiError && [401,403,404].includes(reason.status)){setState(null);setPreview(null);}
    } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const load = (preserveDraft = false) => run(async signal => {
    if(recovery.locked)return;
    const value = await loadSharedProjectAccess(spaceId, userId, signal); if (!mounted.current) return;
    setState(value); if(!preserveDraft&&!recovery.current.current)setDraft({ allProjects: value.allProjects, grants: value.grants }); setPreview(null);
  });
  const change = (next: SharedProjectAccessDraft) => { if(blocked)return;setDraft(next);recovery.update({targetUserId:userId,draft:next});setPreview(null);setError("");setStatus(""); };
  const restoreEditor=(value:ProjectAccessEditorSnapshot)=>{if(value.targetUserId!==userId)return;setDraft(value.draft);setPreview(null);setError('');};
  const setGrant = (projectId: string, role: ProjectGrantRole | "inherit", includeDescendants?: boolean) => {
    const previous = draft.grants.find(row => row.projectId === projectId), rows = draft.grants.filter(row => row.projectId !== projectId);
    change({ ...draft, grants: role === "inherit" ? rows : [...rows, { projectId, role, includeDescendants: includeDescendants ?? previous?.includeDescendants ?? false }] });
  };
  const prepare = () => run(async signal => {
    if(blocked||!recovery.device.loaded)return;
    const value = await previewSharedProjectAccess(spaceId, userId, { allProjects: draft.allProjects, grants: draft.allProjects ? [] : draft.grants }, signal);
    if (!mounted.current) return;
    setPreview(value);
    setState(previous => previous ? { ...previous, projects: value.projects, fingerprint: value.fingerprint, revision: value.revision } : previous);
  });
  const finishSend = async () => {
    await recovery.send(operation=>saveSharedProjectAccess(spaceId,operation.id!,operation.body as SharedProjectAccessCommand));if(!mounted.current)return;
    const signal=new AbortController().signal;
    const value = await loadSharedProjectAccess(spaceId, userId, signal); if (!mounted.current) return;
    await onChanged(); if (!mounted.current) return;
    await recovery.finish();if(!mounted.current)return;
    setState(value); setDraft({ allProjects: value.allProjects, grants: value.grants }); setPreview(null);
    setStatus("Доступ к проектам сохранён.");
  };
  const apply = () => run(async () => {
    if(!preview||preview.blockers.length||blocked||!recovery.device.ready||!recovery.device.loaded)return;
    await recovery.prepare({targetUserId:userId,draft},{kind:'project-access.save',id:userId,body:{...preview.desired,expectedFingerprint:preview.fingerprint,operationId:`project-access:${crypto.randomUUID()}`},expected:{revision:preview.revision}});
    await finishSend();
  });
  const count = (value: number) => new Intl.NumberFormat(language).format(value);
  const permissions = (value: ProjectAccessPermissions) => !value.read ? t("Нет доступа") : new Intl.ListFormat(language, { style: "short", type: "conjunction" }).format([
    t("Просмотр"), ...(value.comment ? [t("Комментарии")] : []), ...(value.editTasks ? [t("Редактирование")] : []),
    ...(value.organizeTasks ? [t("Организация задач")] : []), ...(value.createProjects ? [t("Создание проектов")] : []),
    ...(value.manageProjects ? [t("Управление проектами")] : []), ...(value.inviteMembers ? [t("Приглашение участников")] : []),
  ]);
  const projects = state?.projects.filter(project => project.title.toLocaleLowerCase(language).includes(search.trim().toLocaleLowerCase(language))) ?? [];
  const projectMap = new Map(state?.projects.map(project => [project.id, project]) ?? []);
  const missing = draft.grants.filter(row => state && !projectMap.has(row.projectId));
  const assignments = preview?.changes.reduce((sum, row) => sum + row.clearedAssignments, 0) ?? 0;
  return <details className="shared-project-access" data-project-access-user-id={userId} onToggle={event => { if (event.currentTarget.open && !state) void load(); }}>
    <summary>{t("Доступ к проектам")}</summary>
    <p>{t("Выберите проекты и права участника. Правило для подпроектов применяется только при явном включении наследования.")}</p>
    <SharedEditorDraftRecovery controller={matchingRecovery} language={language} busy={busy||disabled} editing={dirty} title={()=>t('Доступ к проектам')} onRestore={restoreEditor} onEdit={restoreEditor} onRetry={()=>void run(finishSend)} onError={reason=>setError(accessError(reason,language))}/>
    {!state ? <>{busy ? <p role="status">{t("Загрузка…")}</p> : <IconActionButton icon="map-refresh" label={t("Загрузить права")} disabled={disabled||recovery.locked} onClick={() => void load()}/>}</> : <>
      <fieldset disabled={busy || disabled || blocked || !recovery.device.ready || !recovery.device.loaded}>
        <IconActionButton icon="map-refresh" label={t("Обновить список проектов")} onClick={() => void load(true)}/>
        <label className="shared-project-access-check"><input type="checkbox" checked={draft.allProjects} onChange={event => change({ ...draft, allProjects: event.target.checked })} />{t("Все проекты пространства, включая будущие")}</label>
        <p>{t("Проектные ограничения имеют приоритет над правами категории. Уже скачанные участником файлы удалить с его устройства невозможно.")}</p>
        {!draft.allProjects ? <>
          {missing.length ? <p role="alert">{t("Некоторые выбранные проекты больше недоступны. Уберите их правила перед предпросмотром.")} <button type="button" className="text-button" onClick={() => change({ ...draft, grants: draft.grants.filter(row => projectMap.has(row.projectId)) })}>{t("Убрать недоступные правила")}</button></p> : null}
          <label>{t("Найти проект")}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(50); }} /></label>
          <div className="shared-project-access-rules">{projects.slice(0, limit).map(project => {
            const rule = draft.grants.find(row => row.projectId === project.id), parent = project.parentId ? projectMap.get(project.parentId) : null;
            return <div className="shared-project-access-rule" key={project.id} data-access-project-id={project.id}>
              <div><strong data-no-translate>{project.title}</strong>{parent ? <small data-no-translate>{parent.title}</small> : null}
                {project.inTrash ? <small>{t("Корзина")}</small> : project.archivedAt ? <small>{t("Архив")}</small> : null}</div>
              <label>{t("Правило доступа")}<select value={rule?.role ?? "inherit"} onChange={event => setGrant(project.id, event.target.value as ProjectGrantRole | "inherit")}>
                <option value="inherit">{t("Без отдельного правила")}</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select></label>
              {rule ? <label className="shared-project-access-check"><input type="checkbox" checked={rule.includeDescendants} onChange={event => setGrant(project.id, rule.role, event.target.checked)} />{t("Включая существующие и будущие подпроекты")}</label> : null}
            </div>;
          })}</div>
          {!projects.length ? <p>{t("Проекты не найдены.")}</p> : <p>{t("Показано {shown} из {total}").replace("{shown}", count(Math.min(limit, projects.length))).replace("{total}", count(projects.length))}</p>}
          {projects.length > limit ? <button type="button" className="secondary-button" onClick={() => setLimit(value => value + 50)}>{t("Показать ещё")}</button> : null}
          <p>{t("Без отдельного правила действует ближайшее включённое правило родителя. Если его нет, доступа нет. «Нет доступа» создаёт явное исключение.")}</p>
        </> : null}
        <button type="button" className="secondary-button" disabled={!draft.allProjects && Boolean(missing.length)} onClick={() => void prepare()}>{t(preview ? "Обновить предпросмотр" : "Предпросмотр изменений")}</button>
      </fieldset>
      {preview ? <section className="shared-project-access-preview" aria-label={t("Предпросмотр изменений")}>
        <h4>{t("Проектов с изменениями: {count}").replace("{count}", count(preview.changes.length))}</h4>
        {assignments ? <p>{t("Будут сняты назначения: {count}").replace("{count}", count(assignments))}</p> : null}
        {preview.blockers.map(row => <p role="alert" key={row.projectId}><strong data-no-translate>{projectMap.get(row.projectId)?.title}</strong> · {t("Сначала передайте владение проектом другому участнику.")}</p>)}
        {preview.changes.length ? <ul>{preview.changes.map(row => <li key={row.projectId}><strong data-no-translate>{row.title}</strong><span>{permissions(row.beforePermissions)} → {permissions(row.afterPermissions)}</span></li>)}</ul> : <p>{t("Текущие права проектов не изменятся.")}</p>}
        <button type="button" className="primary-button" disabled={busy || disabled || blocked || !recovery.device.ready || !recovery.device.loaded || Boolean(preview.blockers.length)} onClick={() => void apply()}>{t(busy ? "Сохранение…" : "Применить доступ")}</button>
      </section> : null}
    </>}
    {error ? <p role="alert">{t(error)}</p> : null}{status ? <p role="status">{t(status)}</p> : null}
  </details>;
}
