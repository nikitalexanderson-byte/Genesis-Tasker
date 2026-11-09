"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "./i18n";
import { ExperimentalIcon } from "./ExperimentalIcon";
import { androidReleaseVersion } from "./android-install";
import androidInstallCopy from "./android-install-copy.json";

const APP_BASE = (process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim() || "").replace(/\/$/, "");
type InstallCopy = { title: string; download: string; help: string; open: string; allow: string; update: string };
const COPY: Record<Language, InstallCopy> = androidInstallCopy;

export function AndroidDownload({ href, language, toolbar = false }: { href: string; language: Language; toolbar?: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const copy = COPY[language];

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${APP_BASE}/android-update.json`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((release: unknown) => setVersion(androidReleaseVersion(release)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!toolbar) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target) &&
          !panel.current?.contains(event.target) && disclosure.current) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        disclosure.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolbar, open]);

  const download = <a className="android-download-button android-native-download-button" href={href}>
    <ExperimentalIcon name="download" />
    <span><strong>{copy.download}</strong><small data-no-translate>GENESIS{version ? ` ${version}` : ""} · APK</small></span>
  </a>;
  const instructions = <ol className="android-install-steps"><li>{copy.open}</li><li>{copy.allow}</li><li>{copy.update}</li></ol>;

  return toolbar ? <div className="android-install-toolbar" ref={disclosure} data-no-translate>
    <button type="button" className="icon-button ux-action-button android-native-icon-button" aria-label={copy.title} title={copy.title} aria-controls={panelId} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ExperimentalIcon name="download" />
    </button>
    {open ? createPortal(<section ref={panel} id={panelId} className="android-install-panel" aria-label={copy.title} data-no-translate>
      <h2>{copy.title}</h2>{download}{instructions}
    </section>, document.body) : null}
  </div> : <section className="android-install-welcome" aria-label={copy.title} data-no-translate>
    {download}
    <details className="android-install-help"><summary>{copy.help}</summary>{instructions}</details>
  </section>;
}
