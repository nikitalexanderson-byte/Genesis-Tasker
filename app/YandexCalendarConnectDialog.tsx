"use client";
import { DialogCloseButton } from "./DialogCloseButton";

import { useState } from "react";
import { connectYandexCalendar, type GenesisUser } from "./cloud-sync";
import { translateText } from "./i18n";
import { useDialogAccessibility } from "./use-dialog-accessibility";

type Props = {
  user: GenesisUser;
  onClose: () => void;
};

export function YandexCalendarConnectDialog({ user, onClose }: Props) {
  const t = (copy: string) => translateText(copy, user.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogAccessibility<HTMLElement>(busy ? () => undefined : onClose);

  const connect = () => {
    setBusy(true);
    setError("");
    try {
      connectYandexCalendar(user.uid);
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : "Не удалось подключить Яндекс.Календарь."));
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="yandex-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="yandex-connect-title" aria-describedby="yandex-connect-description" tabIndex={-1}>
      <DialogCloseButton type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label={t("Закрыть")} />
      <h2 id="yandex-connect-title">{t("Подключить Яндекс.Календарь")}</h2>
      <p id="yandex-connect-description">{t("Проекты, привычки и списки задач хранятся в зашифрованном пространстве GENESIS. Задачи синхронизируются с Яндекс.Календарем после подключения.")}</p>
      {error ? <p className="yandex-connect-error" role="alert">{error}</p> : null}
      <div className="yandex-connect-actions">
        <button type="button" className="primary-button" onClick={connect} disabled={busy} aria-busy={busy}>{t("Подключить")}</button>
      </div>
    </section>
  </div>;
}
