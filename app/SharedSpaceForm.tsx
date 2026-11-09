"use client";

import { useEffect, useId, useRef, useState } from "react";
import { normalizeLanguage, translateText } from "./i18n";
import { createSharedSpace, updateSharedSpace, deleteSharedSpace, loadSharedSpaceSettings,
  inviteSharedSpaceMember, revokeSharedSpaceInvitation, setSharedSpaceMemberPermissions,
  type SharedPermissions, type SharedSpace, type SharedProjectQuota, type SharedSpaceSettings, type SharedSpaceInvitationInput } from "./cloud-sync";
import {sharedProjectQuotaAvailable} from './shared-project-quota';

import { SharedSpaceCoverEditor, type SpaceCoverDraft } from "./SharedSpaceCover";

const permissionKeys = ["createProjects", "editTasks", "organizeTasks", "comment", "manageProjects", "inviteMembers"] as const;
export function defaultSpacePermissions(role: string): SharedPermissions {
  const manager = role === "owner" || role === "admin";
  return { createProjects: role !== "guest", editTasks: role !== "guest", organizeTasks: manager,
    comment: role !== "guest", manageProjects: manager, inviteMembers: manager };
}
export function PermissionChecks({ value, onChange, disabled, language }: { value: SharedPermissions;
  onChange: (next: SharedPermissions) => void; disabled?: boolean; language: string }) {
  const t = (source: string) => translateText(source, normalizeLanguage(language));
  const labels = ["Создавать проекты и списки", "Создавать и редактировать задачи", "Перемещать и удалять задачи", "Комментировать", "Управлять проектами и досками", "Приглашать участников"].map(t);
  return <fieldset className="space-permission-checks" disabled={disabled}><legend>{t("Права")}</legend>
    {permissionKeys.map((key, index) => <label key={key}><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />{labels[index]}</label>)}
  </fieldset>;
}

export function SharedSpaceForm({ language, spaceId, ownedProjectQuota, onSaved, onDeleted }: { language: string; spaceId?: string; ownedProjectQuota?: SharedProjectQuota;
  onSaved: (space: SharedSpace) => void; onDeleted: (id: string) => void }) {
  const ru = language === "ru";
  const formId = useId();
  const memberBaseline = useRef<SharedSpaceSettings["members"]>([]);
  const operation = useRef(false);
  const t = (source: string) => translateText(source, normalizeLanguage(language));
  const [settings, setSettings] = useState<SharedSpaceSettings | null>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [invitations, setInvitations] = useState<(SharedSpaceInvitationInput & { key: string })[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [cover,setCover]=useState<SpaceCoverDraft>({coverPosition:{x:50,y:50}});
  const [coverLoading,setCoverLoading]=useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const owner = !spaceId || settings?.space.role === "owner";
  const roleLabel = (role: string) => ({ owner: t("Владелец"), admin: t("Администратор"),
    member: t("Участник"), guest: t("Гость") })[role as SharedSpace["role"]];
  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    void loadSharedSpaceSettings(spaceId).then((value) => {
      if (live) { setSettings(value); memberBaseline.current = value.members; setTitle(value.space.title); setDescription(value.space.description ?? ""); setCover({coverPosition:value.space.coverPosition??{x:50,y:50}}); }
    }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, [spaceId]);
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return; operation.current = true; setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(false); }
  };
  const refresh = async () => { if (spaceId) {
    const value = await loadSharedSpaceSettings(spaceId);
    const baseline = memberBaseline.current;
    setSettings(current => ({...value,members:value.members.map(member => {
      const original=baseline.find(row=>row.userId===member.userId),edited=current?.members.find(row=>row.userId===member.userId);
      return original&&edited&&(edited.role!==original.role||permissionKeys.some(key=>edited.permissions[key]!==original.permissions[key]))?edited:member;
    })})); memberBaseline.current=value.members;
  } };
  const submit = () => { if(coverLoading||!spaceId&&!sharedProjectQuotaAvailable(ownedProjectQuota))return;void run(async () => {
    let applied = false;
    try {
    const space = spaceId && settings ? await updateSharedSpace(settings.space, title, description, cover)
      : await createSharedSpace(title, description, invitations.map((invite) => ({ email: invite.email, role: invite.role, permissions: invite.permissions })),cover);
    if (spaceId) {
      applied = true;
      // Keep the saved revision if a later invitation fails, so the user can retry.
      setSettings((current) => current ? { ...current, space } : current);
      for (const member of settings?.members ?? []) {
        const original = memberBaseline.current.find(row => row.userId === member.userId);
        if (!original || member.role === original.role && permissionKeys.every(key => member.permissions[key] === original.permissions[key])) continue;
        await setSharedSpaceMemberPermissions(space.id, member.userId, member.role, member.permissions);
        memberBaseline.current = memberBaseline.current.map(row => row.userId === member.userId ? member : row);
      }
      for (const invitation of invitations) {
        await inviteSharedSpaceMember(space.id, invitation.email, invitation.role, invitation.permissions);
        setInvitations((current) => current.filter((pending) => pending.key !== invitation.key));
      }
    }
    onSaved(space);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      throw new Error(applied ? `${t("Часть изменений сохранена. Повторите сохранение, чтобы завершить.")} ${message}` : message);
    }
  });};
  const roleSelect = (value: string, change: (role: SharedSpace["role"]) => void, includeOwner = false) => <select aria-label={t("Роль")}
    value={value} disabled={busy || !owner || value === "owner"} onChange={(event) => change(event.target.value as SharedSpace["role"])}>
    {(includeOwner ? ["owner", "admin", "member", "guest"] : ["admin", "member", "guest"]).map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
  </select>;
  if (spaceId && !settings) return <p role="status">{error || (t("Загрузка…"))}</p>;
  return <div className="shared-space-settings-form">
    {error ? <p role="alert">{error}</p> : null}
    <form id={formId} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label>{t("Название")}<input required maxLength={160} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{t("Описание")}<textarea maxLength={5000} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
      <SharedSpaceCoverEditor src={settings?.space.coverUrl??""} value={cover} onChange={setCover} english={!ru} disabled={busy} onLoadingChange={setCoverLoading}/>
      <section className="space-invitation-fields"><h3>{t("Пригласить участников")}</h3>
        {invitations.map((invite) => <div className="space-member-settings" key={invite.key}>
          <label>Google email<input type="email" required maxLength={254} value={invite.email} disabled={busy} placeholder="name@gmail.com"
            onChange={(event) => setInvitations((current) => current.map((item) => item.key === invite.key ? { ...item, email: event.target.value } : item))} /></label>
          {roleSelect(invite.role, (role) => setInvitations((current) => current.map((item) => item.key === invite.key ? { ...item, role: role as SharedSpaceInvitationInput["role"], permissions: defaultSpacePermissions(role) } : item)))}
          <PermissionChecks language={language} value={invite.permissions} disabled={busy || !owner} onChange={(permissions) => setInvitations((current) => current.map((item) => item.key === invite.key ? { ...item, permissions } : item))} />
          <button type="button" className="text-button" disabled={busy} onClick={() => setInvitations((current) => current.filter((item) => item.key !== invite.key))}>{t("Убрать приглашение")}</button>
        </div>)}
        <button type="button" className="secondary-button" disabled={busy || !owner || invitations.length >= 20} onClick={() => setInvitations((current) => [...current,
          { key: crypto.randomUUID(), email: "", role: "member", permissions: defaultSpacePermissions("member") }])}>{t("+ Участник")}</button>
      </section>
    </form>
    {settings ? <section className="space-members-settings"><h3>{t("Участники и права")}</h3>
      {settings.members.map((member) => <div className="space-member-settings" key={member.userId}>
        <strong data-no-translate>{member.displayName || member.email}</strong><small data-no-translate>{member.email}</small>
        {roleSelect(member.role, (role) => setSettings({ ...settings, members: settings.members.map((item) => item.userId === member.userId ? { ...item, role, permissions: defaultSpacePermissions(role) } : item) }), true)}
        <PermissionChecks language={language} value={member.permissions} disabled={busy || !owner || member.role === "owner"} onChange={(permissions) => setSettings({ ...settings, members: settings.members.map((item) => item.userId === member.userId ? { ...item, permissions } : item) })} />
      </div>)}
    </section> : null}
    {settings?.invitations.length ? <section><h3>{t("Ожидают приглашения")}</h3>
      {settings.invitations.map((invite) => <div className="space-member-settings" key={invite.id}>
        <strong data-no-translate>{invite.email}</strong><span>{roleLabel(invite.role)}</span>
        <PermissionChecks language={language} value={invite.permissions} disabled onChange={() => undefined} />
        {owner ? <button type="button" disabled={busy} onClick={() => void run(async () => { await revokeSharedSpaceInvitation(settings.space.id, invite.id); await refresh(); })}>{t("Отозвать приглашение")}</button> : null}
      </div>)}
    </section> : null}
    {settings && owner ? <section className="space-delete-settings">
      {confirmDelete ? <><h3>{t("Удалить это пространство?")}</h3>
        <p>{t("Все общие проекты и задачи этого пространства будут удалены для всех участников. Личные данные и созданные копии в Google останутся.")}</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await deleteSharedSpace(settings.space); onDeleted(settings.space.id); })}>{t("Да, удалить")}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("Нет")}</button></>
        : null}
    </section> : null}
    {!confirmDelete ? <footer className="space-settings-actions">
      {settings && owner ? <button type="button" className="secondary-button danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t("Удалить пространство")}</button> : null}
      <button type="submit" form={formId} className="primary-button" disabled={busy||coverLoading||!spaceId&&!sharedProjectQuotaAvailable(ownedProjectQuota)}>{t(spaceId ? "Сохранить" : "Создать пространство")}</button>
    </footer> : null}
  </div>;
}
