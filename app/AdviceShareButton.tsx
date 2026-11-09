"use client";
/* eslint-disable @next/next/no-img-element -- The preview is a local generated PNG, with its object URL revoked on close. */
import { useEffect, useRef, useState } from 'react';
import { ExperimentalIcon } from './ExperimentalIcon';
import { DialogCloseButton } from './DialogCloseButton';
import type { DailyAdvice } from './daily-advice';
import {loadSavedAdvice} from './cloud-sync';

export function AdviceShareButton({ advice, copy, closeLabel }: {
  advice: DailyAdvice; closeLabel: string;
  copy: { share: string; sharePreparing: string; shareError: string; shareDownload: string };
}) {
  const [preparing, setPreparing] = useState(false), [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), ticket = useRef(0);
  useEffect(() => () => { ticket.current++; }, []);
  useEffect(() => {
    if (!preview) return;
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  async function prepare() {
    const current = ++ticket.current; setPreparing(true); setFailed(false);
    try {
      const { renderAdviceShare } = await import('./advice-share');
      let authorized=advice;
      if(advice.categories.includes('psychopompia')||advice.containsAlcohol===true){
        const result=await loadSavedAdvice({id:advice.id,dayKey:advice.dayKey,collection:advice.collection??'aurora'});
        if(!result.advice||result.advice.id!==advice.id)throw new Error('ADVICE_SHARE_UNAVAILABLE');
        authorized=result.advice;
      }
      const file = await renderAdviceShare(authorized);
      if (ticket.current === current) setPreview({ file, url: URL.createObjectURL(file) });
    } catch { if (ticket.current === current) setFailed(true); }
    finally { if (ticket.current === current) setPreparing(false); }
  }
  async function share() {
    if (!preview) return;
    try {
      await navigator.share({ files: [preview.file], title: advice.title, text: (advice.title || copy.share) + '\nhttps://genesiscalendar.com' });
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); }
  }
  return <>
    <button type="button" className="daily-advice-icon-action" disabled={preparing} aria-label={preparing ? copy.sharePreparing : copy.share} title={copy.share} onClick={() => void prepare()}><ExperimentalIcon name="share-2"/></button>
    {preparing ? <span role="status" className="sr-only">{copy.sharePreparing}</span> : null}
    {failed ? <span role="alert">{copy.shareError}</span> : null}
    {preview ? <dialog ref={dialog} className="advice-share-dialog" aria-label={copy.share} onClose={() => setPreview(null)}>
      <header><h2>{copy.share}</h2><DialogCloseButton aria-label={closeLabel} onClick={() => setPreview(null)}/></header>
      <img src={preview.url} alt={advice.title} width={1080}/>
      <footer><a href={preview.url} download="GENESIS-advice.png">{copy.shareDownload}</a>
        {navigator.canShare?.({ files: [preview.file] }) ? <button type="button" onClick={() => void share()}>{copy.share}</button> : null}</footer>
    </dialog> : null}
  </>;
}
