"use client";
import { useState } from 'react';
import { useDiary } from './DiaryProvider';
import { diaryCopy } from './diary-copy';
import type { DiaryRecord } from './diary-storage';
import { DialogCloseButton } from './DialogCloseButton';
import { ExperimentalIcon } from './ExperimentalIcon';
import { useDialogAccessibility } from './use-dialog-accessibility';

export function DiarySettings({ language, onClose }: { language: string; onClose: () => void }) {
  const text = diaryCopy(language), diary = useDiary();
  const [confirmation, setConfirmation] = useState<'enable' | 'disable' | 'purge' | null>(null);
  const [error, setError] = useState(false);
  const close = () => { if (!diary.busy) onClose(); };
  const ref = useDialogAccessibility<HTMLElement>(close);
  const change = async (enabled: boolean) => {
    setError(false);
    try { await diary.setSyncEnabled(enabled); setConfirmation(null); }
    catch { setError(true); }
  };
  return <>
    <div className="modal-backdrop"><section className="modal diary-settings" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="diary-settings-heading" data-exp-ui="dialog" data-no-translate>
      <header><h2 id="diary-settings-heading">{text.settings}</h2><DialogCloseButton aria-label={text.cancel} disabled={diary.busy} onClick={close}/></header>
      <label className="diary-sync-setting"><span>{text.syncLabel}</span><input type="checkbox" checked={diary.syncEnabled} disabled={diary.busy || diary.loading}
        onChange={event => { setError(false); setConfirmation(event.target.checked ? 'enable' : 'disable'); }}/></label>
      <p role="status">{diary.syncEnabled ? text.syncOn : text.localOnly}</p>
      <p>{text.syncHint}</p><p>{text.localWarning}</p>
      {diary.syncEnabled && diary.pendingUploads > 0 ? <div className="diary-notice"><p>{text.pendingUpload}</p><button type="button" disabled={diary.busy} onClick={() => void change(true)}>{text.retrySync}</button></div> : null}
      <button type="button" className="diary-purge-server" disabled={diary.busy || diary.loading} onClick={() => { setError(false); setConfirmation('purge'); }}><ExperimentalIcon name="trash"/>{text.purgeServer}</button>
      <p className="diary-settings-detail">{text.backupRetention}</p>
      {error && !confirmation ? <p role="alert">{text.settingsError}</p> : null}
    </section></div>
    {confirmation ? <DiarySettingsConfirmation language={language} mode={confirmation} busy={diary.busy} error={error}
      onClose={() => { if (!diary.busy) setConfirmation(null); }} onConfirm={() => void change(confirmation === 'enable')}/> : null}
  </>;
}
function DiarySettingsConfirmation({ language, mode, busy, error, onClose, onConfirm }: {
  language: string; mode: 'enable' | 'disable' | 'purge'; busy: boolean; error: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const text = diaryCopy(language), ref = useDialogAccessibility<HTMLElement>(() => { if (!busy) onClose(); });
  return <div className="modal-backdrop"><section className="modal diary-settings" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="diary-sync-confirm-heading" data-exp-ui="dialog" data-no-translate>
    <header><h2 id="diary-sync-confirm-heading">{mode === 'enable' ? text.enableTitle : mode === 'purge' ? text.purgeTitle : text.disableTitle}</h2><DialogCloseButton aria-label={text.cancel} disabled={busy} onClick={onClose}/></header>
    <p>{mode === 'enable' ? text.enableBody : mode === 'purge' ? text.purgeBody : text.disableBody}</p>
    {error ? <p role="alert">{text.settingsError}</p> : null}
    <footer><button type="button" disabled={busy} onClick={onClose}>{text.cancel}</button><button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{text.apply}</button></footer>
  </section></div>;
}
export function DiaryDeleteDialog({ language, record, onClose }: { language: string; record: DiaryRecord; onClose: () => void }) {
  const text = diaryCopy(language), diary = useDiary();
  const [error, setError] = useState(false);
  const close = () => { if (!diary.busy) onClose(); }, ref = useDialogAccessibility<HTMLElement>(close);
  return <div className="modal-backdrop"><section className="modal diary-settings" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="diary-delete-heading" data-exp-ui="dialog" data-no-translate>
    <header><h2 id="diary-delete-heading">{text.deleteTitle}</h2><DialogCloseButton aria-label={text.cancel} disabled={diary.busy} onClick={close}/></header>
    <p>{text.deleteBody}</p>{error ? <p role="alert">{text.settingsError}</p> : null}
    <footer><button type="button" disabled={diary.busy} onClick={close}>{text.cancel}</button><button type="button" className="primary-button" disabled={diary.busy} onClick={() => {
      setError(false); void diary.remove(record).then(onClose).catch(() => setError(true));
    }}>{text.deleteNote}</button></footer>
  </section></div>;
}
