"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExperimentalIcon } from './ExperimentalIcon';
import { LANGUAGES, translateText } from './i18n';
import './dialog-controls.css';

const dialogs = 'dialog[open], [role="dialog"], [role="alertdialog"]';
type Control = HTMLButtonElement | HTMLInputElement;
type Entry = { root: HTMLElement; host: HTMLElement; title: string; subtitle: string; close: HTMLButtonElement; sources: Control[]; disabled: boolean[]; saveLabel: string; closeLabel: string; alternativesLabel: string };
const label = (button: Control) => (button.getAttribute('aria-label') || (button instanceof HTMLInputElement ? button.value : button.textContent) || '').trim();
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[.…!]+$/g, '').trim();
const saveWords = [...new Set(LANGUAGES.map(language => normalized(translateText('Сохранить', language))))];
function isSave(control: Control) {
  if (control.dataset.dialogSave === 'false') return false;
  if (control.dataset.dialogSave === 'true') return true;
  const value = normalized(label(control));
  return saveWords.some(word => /[\u3400-\u9fff\u3040-\u30ff]/u.test(word) ? value.includes(word) : value.split(/[\s:—–-]+/u).includes(word));
}
function own(control: Element, root: HTMLElement) { return control.closest(dialogs) === root; }
function available(control: HTMLElement, root: HTMLElement) {
  if (!own(control, root) || control.hidden || control.closest('[data-dialog-header-host]')) return false;
  for (let parent = control.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || getComputedStyle(parent).display === 'none' || parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector('summary')?.contains(control)) return false;
  }
  return control.hasAttribute('data-dialog-header-source') || control.getClientRects().length > 0;
}
const alternativeWords = LANGUAGES.flatMap(language => ['Сохранить как шаблон', 'Сохранить как новое', 'Сохранить только время', 'Сохранить файл'].map(value => normalized(translateText(value, language))));
const disabled = (control: Control) => control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true';
function alternative(control: Control) {
  return control.dataset.dialogSaveAlternative === 'true' || alternativeWords.includes(normalized(label(control))) || control.getAttribute('aria-haspopup') === 'dialog' || /(?:как шаблон|as (?:a )?template|только время|time only|save file|сохранить файл|отдельный вариант)/iu.test(label(control));
}
function primarySources(sources: Control[]) {
  const grouped = new Map<Element, Control[]>();
  for (const source of sources.filter(button => !alternative(button))) {
    const group = source.form ?? source.closest('section, fieldset, article') ?? source.parentElement!;
    grouped.set(group, [...(grouped.get(group) ?? []), source]);
  }
  return [...grouped.values()].map(group => group.find(button => button.matches('.primary-button, .physis-primary, [type="submit"]')) ?? group[0]);
}
function Header({ entry }: { entry: Entry }) {
  const lock = useRef(false); const [more, setMore] = useState(false);
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active === entry.close || entry.sources.includes(active as Control)) header.current?.querySelector<HTMLButtonElement>(active === entry.close ? '.dialog-close-button' : '.dialog-save-button')?.focus({ preventScroll: true });
  }, [entry]);
  const preferred = primarySources(entry.sources);
  const primary = preferred.length ? preferred : entry.sources.slice(0, 1);
  const alternatives = entry.sources.filter(source => !primary.includes(source));
  const save = (sources: Control[]) => {
    if (lock.current || sources.some(disabled)) return;
    const active = sources.filter(source => source.isConnected && !disabled(source));
    const forms = [...new Set(active.filter(source => !source.formNoValidate).map(source => source.form).filter((form): form is HTMLFormElement => !!form && !form.noValidate))];
    for (const form of forms) if (!form.checkValidity()) { form.reportValidity(); return; }
    lock.current = true; setMore(false);
    try { for (const source of active) if (source.isConnected && !source.disabled) source.click(); }
    finally { requestAnimationFrame(() => { lock.current = false; }); }
  };
  return <header ref={header} className="dialog-universal-header">
    <div className="dialog-universal-title"><h2>{entry.title}</h2>{entry.subtitle && <p>{entry.subtitle}</p>}</div>
    <div className="dialog-universal-actions">
      {primary.length > 0 && <button type="button" className="dialog-save-button" data-no-translate aria-label={entry.saveLabel} data-tooltip={entry.saveLabel} disabled={primary.some(disabled)} onClick={() => save(primary)}><ExperimentalIcon name="save" /></button>}
      {alternatives.length > 0 && <div className="dialog-save-alternatives"><button type="button" className="dialog-save-button" data-no-translate aria-label={entry.alternativesLabel} data-tooltip={entry.alternativesLabel} aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(value => !value)}><svg className="experimental-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>{more && <div className="dialog-save-menu" role="menu">{alternatives.map((button, index) => <button key={index} role="menuitem" type="button" disabled={disabled(button)} onClick={() => save([button])}><ExperimentalIcon name="save" /><span>{label(button)}</span></button>)}</div>}</div>}
      <button type="button" className="dialog-close-button" data-no-translate aria-label={entry.closeLabel} data-tooltip={entry.closeLabel} disabled={disabled(entry.close)} onClick={() => entry.close.click()}><ExperimentalIcon name="close" /></button>
    </div>
  </header>;
}

/** Mirrors existing actions without moving React-owned nodes or replacing their save/cancel paths. */
export function DialogHeaderActions() {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const managed = new Map<HTMLElement, { host: HTMLElement; marked: Set<HTMLElement>; saves: Set<Control>; wrapper?: HTMLElement }>();
    let frame = 0;
    const clear = (root: HTMLElement) => {
      const item = managed.get(root); if (!item) return;
      item.marked.forEach(element => element.removeAttribute('data-dialog-header-source'));
      item.wrapper?.removeAttribute('data-dialog-header-wrapper');
      item.host.remove(); managed.delete(root);
    };
    const scan = () => {
      frame = 0;
      const next: Entry[] = [];
      const active = new Set<HTMLElement>();
      for (const root of document.querySelectorAll<HTMLElement>(dialogs)) {
        if (!root.isConnected || root.getClientRects().length === 0 || root.hidden || root.getAttribute('aria-hidden') === 'true' || root.closest('[hidden]') || root.dataset.dialogHeader === 'none') continue;
        const content = root.matches('.modal-backdrop, .stoicheion-letter-dialog') ? root.firstElementChild as HTMLElement | null : root;
        if (!content) continue;
        const close = [...content.querySelectorAll<HTMLButtonElement>('button.dialog-close-button')].find(button => own(button, root) && !button.closest('[data-dialog-header-host]'));
        const labelled = (root.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)).find(element => element && content.contains(element));
        const title = labelled ?? [...content.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]')].find(element => !element.closest('[data-dialog-header-host]') && own(element, root));
        const heading = title?.cloneNode(true) as HTMLElement | undefined;
        const subtitles = [...(heading?.querySelectorAll('[data-dialog-subtitle]') ?? [])];
        const subtitle = subtitles.map(element => element.textContent?.trim()).filter(Boolean).join(' · ');
        subtitles.forEach(element => element.remove());
        const titleText = heading?.textContent?.trim() || root.getAttribute('aria-label')?.trim();
        if (!close || !titleText) continue;
        active.add(root);
        let item = managed.get(root);
        if (!item) {
          const host = document.createElement('div'); host.dataset.dialogHeaderHost = 'true';
          const wrapper = title?.closest<HTMLElement>('header[data-dialog-header-container]') ?? undefined;
          (wrapper ?? content).prepend(host); wrapper?.setAttribute('data-dialog-header-wrapper', 'true');
          item = { host, marked: new Set(), saves: new Set(), wrapper }; managed.set(root, item);
        }
        const style = getComputedStyle(content);
        for (const edge of ['top', 'right', 'left']) (item.wrapper ?? item.host).style.setProperty(`--dialog-edge-${edge}`, style.getPropertyValue(`padding-${edge}`));
        item.host.style.setProperty('--dialog-header-inline', parseFloat(style.paddingInlineStart) < 1 ? '20px' : '0px');
        const sources = [...content.querySelectorAll<Control>('button,input[type="submit"]')].filter(button => available(button, root) && (isSave(button) || item!.saves.has(button) && (disabled(button) || /^[.…]+$/.test(label(button)))));
        item.saves = new Set(sources);
        const marked = new Set<HTMLElement>([...(title ? [title] : []), close, ...sources]);
        const oldHeader = title?.closest('header');
        if (oldHeader && !item.wrapper && [...oldHeader.children].every(child => child === title || child === close)) marked.add(oldHeader);
        for (const previous of item.marked) if (!marked.has(previous)) previous.removeAttribute('data-dialog-header-source');
        for (const element of marked) if (!element.hasAttribute('data-dialog-header-source')) element.setAttribute('data-dialog-header-source', 'true');
        item.marked = marked;
        next.push({ root, host: item.host, title: titleText, subtitle, close, sources, disabled: [disabled(close), ...sources.map(disabled)], saveLabel: translateText('Сохранить'), closeLabel: translateText('Закрыть'), alternativesLabel: translateText('Дополнительные действия') });
      }
      for (const root of managed.keys()) if (!active.has(root)) clear(root);
      setEntries(current => current.length === next.length && current.every((entry, index) => {
        const other = next[index];
        return entry.root === other.root && entry.title === other.title && entry.subtitle === other.subtitle && entry.close === other.close && entry.saveLabel === other.saveLabel && entry.closeLabel === other.closeLabel && entry.alternativesLabel === other.alternativesLabel && entry.sources.length === other.sources.length && entry.sources.every((source, position) => source === other.sources[position]) && entry.disabled.every((disabled, position) => disabled === other.disabled[position]);
      }) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden', 'disabled', 'aria-disabled', 'aria-busy', 'aria-hidden', 'class', 'data-settings-active', 'data-dialog-header'] });
    document.addEventListener('input', schedule); document.addEventListener('change', schedule); document.addEventListener('click', schedule); window.addEventListener('resize', schedule);
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('input', schedule); document.removeEventListener('change', schedule); document.removeEventListener('click', schedule); window.removeEventListener('resize', schedule); for (const root of managed.keys()) clear(root); };
  }, []);
  return <>{entries.map(entry => createPortal(<Header entry={entry} />, entry.host))}</>;
}
