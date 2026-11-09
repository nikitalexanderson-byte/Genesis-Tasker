"use client";

import { DialogCloseButton } from "./DialogCloseButton";
import { translateText } from "./i18n";
import { useDialogAccessibility } from "./use-dialog-accessibility";

export function ProjectCompletionDialog({ title, onConfirm, onCancel, fileRetentionWarning }: {
  title: string; fileRetentionWarning?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(onCancel);
  return <div className="modal-backdrop project-completion-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <div ref={dialogRef} className="project-completion-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="project-completion-title" aria-describedby="project-completion-name" tabIndex={-1}>
      <DialogCloseButton type="button" onClick={onCancel} aria-label={translateText("Закрыть")} />
      <h2 id="project-completion-title">{translateText("Завершить этот проект?")}</h2>
      <p id="project-completion-name" data-no-translate>{title}</p>
      {fileRetentionWarning ? <p>{translateText("Файлы закрытого проекта автоматически удаляются через 30 дней. Повторное открытие проекта до истечения срока отменяет очистку.")}</p> : null}
      <div>
        <button type="button" onClick={onConfirm}>{translateText("Да")}</button>
        <button type="button" className="text-button" data-dialog-initial-focus onClick={onCancel}>{translateText("Нет")}</button>
      </div>
    </div>
  </div>;
}
