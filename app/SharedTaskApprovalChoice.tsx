"use client";
import type { SharedMember } from "./cloud-sync";

export function SharedTaskApprovalChoice({enabled, ids, members, english, disabled, onEnabled, onIds}: {
  enabled: boolean; ids: string[]; members: SharedMember[]; english: boolean; disabled?: boolean;
  onEnabled: (value: boolean) => void; onIds: (ids: string[]) => void;
}) {
  return <section className="shared-task-approval-choice">
    <label className="shared-approval-switch"><input type="checkbox" checked={enabled} disabled={disabled}
      onChange={event => onEnabled(event.target.checked)}/><span>{english ? "Require participant approval to complete" : "Закрытие по подтверждению участников"}</span></label>
    {enabled ? <>
      <p>{english ? "The task is completed when every selected participant confirms it." : "Задача завершится, когда каждый выбранный участник подтвердит выполнение."}</p>
      <fieldset disabled={disabled}><legend>{english ? "Who confirms completion" : "Кто подтверждает выполнение"}</legend>
        {members.map(member => <label key={member.userId}><input type="checkbox" checked={ids.includes(member.userId)}
          onChange={event => onIds(event.target.checked ? [...ids,member.userId] : ids.filter(id => id !== member.userId))}/><span data-no-translate>{member.displayName}</span></label>)}
      </fieldset>
      {!ids.length ? <p role="status">{english ? "Select at least one participant." : "Выберите хотя бы одного участника."}</p> : null}
    </> : null}
  </section>;
}
