"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Language } from "./i18n";
import type { WorkspaceRecoveryRequest } from "./cloud-sync";
import { useDialogAccessibility } from "./use-dialog-accessibility";

type WorkspaceRecoveryDialogProps = {
  request: WorkspaceRecoveryRequest;
  language: Language;
  onRecovered: () => void;
  onCancel: () => void;
};

export function WorkspaceRecoveryDialog({ request, language, onRecovered, onCancel }: WorkspaceRecoveryDialogProps) {
  const isEnglish = language === "en";
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useDialogAccessibility<HTMLFormElement>(() => { if (!submitting) onCancel(); });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = recoveryCode.trim();
    if (!code) {
      setError(isEnglish ? "Enter the recovery code from your GENESIS account." : "Введите код восстановления из личного кабинета GENESIS.");
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await request.validate(code);
      onRecovered();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      const localizedMessage = isEnglish
        ? (message.includes("формат")
          ? "The recovery code format is invalid."
          : message.includes("не подош")
            ? "The recovery code did not match. Your encrypted data was not changed."
            : "The recovery code could not be verified.")
        : (message || "Не удалось проверить код восстановления.");
      setError(localizedMessage);
      setSubmitting(false);
      inputRef.current?.select();
    }
  };

  return (
    <div className="modal-backdrop workspace-recovery-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onCancel();
    }}>
      <form ref={dialogRef} className="workspace-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-recovery-title" aria-describedby="workspace-recovery-description" tabIndex={-1} onSubmit={submit}>
        <DialogCloseButton type="button" className="modal-close" disabled={submitting} onClick={onCancel} aria-label={isEnglish ? "Cancel recovery" : "Отменить восстановление"} />
        <span className="workspace-recovery-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64"><path d="M21 29v-8a11 11 0 0 1 22 0v8" /><rect x="13" y="28" width="38" height="28" rx="8" /><circle cx="32" cy="41" r="4" /><path d="M32 45v5M8 19l5 2M56 19l-5 2M32 3v5" /></svg>
        </span>
        <div className="workspace-recovery-heading">
          <span className="eyebrow">{isEnglish ? "Encrypted workspace" : "Зашифрованное пространство"}</span>
          <h2 id="workspace-recovery-title">{isEnglish ? "Restore access" : "Восстановление доступа"}</h2>
          <p id="workspace-recovery-description">{request.reason === "key-mismatch"
            ? (isEnglish ? "This device's key does not match the encrypted workspace. Your data has not been changed." : "Ключ этого устройства не подошёл к зашифрованному пространству. Ваши данные не изменены.")
            : (isEnglish ? "This is a new device. Enter the recovery code to decrypt your personal workspace." : "Это новое устройство. Введите код восстановления, чтобы расшифровать личное пространство.")}</p>
        </div>
        <label className="workspace-recovery-field">
          <span>{isEnglish ? "GENESIS recovery code" : "Код восстановления GENESIS"}</span>
          <div>
            <input ref={inputRef} data-dialog-initial-focus type={codeVisible ? "text" : "password"} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={isEnglish ? "Paste the code saved from your account" : "Вставьте код, сохранённый из личного кабинета"} aria-invalid={Boolean(error)} aria-describedby={error ? "workspace-recovery-error" : "workspace-recovery-hint"} />
            <button type="button" onClick={() => setCodeVisible((visible) => !visible)}>{codeVisible ? (isEnglish ? "Hide" : "Скрыть") : (isEnglish ? "Show" : "Показать")}</button>
          </div>
        </label>
        {error ? <p className="workspace-recovery-error" id="workspace-recovery-error" role="alert">{error}</p> : <p className="workspace-recovery-hint" id="workspace-recovery-hint">{isEnglish ? "The code is shown in Account → Data protection on a device where GENESIS is already open." : "Код находится в разделе «Личный кабинет → Защита данных» на устройстве, где GENESIS уже открыт."}</p>}
        <div className="workspace-recovery-actions">
          <button type="button" className="text-button" disabled={submitting} onClick={onCancel}>{isEnglish ? "Cancel" : "Отмена"}</button>
          <button type="submit" className="primary-button" disabled={submitting || !recoveryCode.trim()}>{submitting ? (isEnglish ? "Verifying…" : "Проверяем…") : (isEnglish ? "Decrypt data" : "Расшифровать данные")}</button>
        </div>
        <small className="workspace-recovery-privacy">{isEnglish ? "The code is processed only on this device and is never sent to the GENESIS server." : "Код обрабатывается только на этом устройстве и не передаётся серверу GENESIS."}</small>
      </form>
    </div>
  );
}
