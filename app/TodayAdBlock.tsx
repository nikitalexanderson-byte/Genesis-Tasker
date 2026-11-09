"use client";
/* eslint-disable @next/next/no-img-element -- Ad images can be uploaded data URLs or administrator URLs. */

import { useEffect, useRef, useState } from "react";
import { loadTodayAds, type TodayAd } from "./cloud-sync";

const labels: Record<string, { ad: string; open: string; close: string; wait: string; unit: string }> = {
  ru: { ad: "Реклама", open: "Подробнее", close: "Закрыть", wait: "Закрыть через", unit: "с" },
  en: { ad: "Advertisement", open: "Learn more", close: "Close", wait: "Close in", unit: "s" },
  el: { ad: "Διαφήμιση", open: "Περισσότερα", close: "Κλείσιμο", wait: "Κλείσιμο σε", unit: "δ." },
  de: { ad: "Anzeige", open: "Mehr erfahren", close: "Schließen", wait: "Schließen in", unit: "s" },
  fr: { ad: "Publicité", open: "En savoir plus", close: "Fermer", wait: "Fermer dans", unit: "s" },
  es: { ad: "Publicidad", open: "Más información", close: "Cerrar", wait: "Cerrar en", unit: "s" },
  it: { ad: "Pubblicità", open: "Scopri di più", close: "Chiudi", wait: "Chiudi tra", unit: "s" },
  pt: { ad: "Publicidade", open: "Saiba mais", close: "Fechar", wait: "Fechar em", unit: "s" },
  pl: { ad: "Reklama", open: "Dowiedz się więcej", close: "Zamknij", wait: "Zamknij za", unit: "s" },
  sr: { ad: "Реклама", open: "Сазнајте више", close: "Затвори", wait: "Затвори за", unit: "с" },
  uk: { ad: "Реклама", open: "Докладніше", close: "Закрити", wait: "Закрити через", unit: "с" },
  zh: { ad: "广告", open: "了解更多", close: "关闭", wait: "可关闭倒计时", unit: "秒" },
  tr: { ad: "Reklam", open: "Ayrıntılar", close: "Kapat", wait: "Kapatmaya kalan süre:", unit: "sn" },
  ja: { ad: "広告", open: "詳しく見る", close: "閉じる", wait: "閉じるまで", unit: "秒" },
};

function deviceCountry(): string {
  try { return new Intl.Locale(navigator.language).region?.toUpperCase() ?? ""; }
  catch { return ""; }
}

function lastShownKey(userId: string, adId: string): string {
  return `genesis-today-ad:${userId}:${adId}`;
}

export function TodayAdBlock({ language, userId }: { language: string; userId: string }) {
  const [ad, setAd] = useState<TodayAd | null>(null);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [viewedSeconds, setViewedSeconds] = useState(0);
  const container = useRef<HTMLElement>(null);
  const recorded = useRef(false);
  const copy = labels[language] ?? labels.ru;

  useEffect(() => {
    let active = true;
    void loadTodayAds(language, deviceCountry(), "web").then(({ ads }) => {
      if (!active) return;
      const now = Date.now();
      const next = ads.find((candidate) => {
        let last = 0;
        try { last = Number(localStorage.getItem(lastShownKey(userId, candidate.id)) ?? 0); }
        catch { /* A private browser can disable storage; the ad remains optional. */ }
        return !last || now - last >= candidate.repeatHours * 3_600_000;
      });
      if (next) setAd(next);
    }).catch(() => {});
    return () => { active = false; };
  }, [language, userId]);

  useEffect(() => {
    if (!ad || !container.current) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height * .5, 120)),
      { threshold: Array.from({ length: 101 }, (_, index) => index / 100) });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ad]);

  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!visible || !tabVisible || !ad || recorded.current) return;
    recorded.current = true;
    try { localStorage.setItem(lastShownKey(userId, ad.id), String(Date.now())); }
    catch { /* Ads still work when storage is unavailable. */ }
  }, [visible, tabVisible, ad, userId]);

  useEffect(() => {
    if (!visible || !tabVisible || !ad || viewedSeconds >= 60) return;
    const timer = window.setInterval(() => setViewedSeconds((seconds) => Math.min(60, seconds + 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [visible, tabVisible, ad, viewedSeconds]);

  if (!ad) return null;
  return <section ref={container} className="today-ad-card" aria-label={copy.ad} data-exp-ui="panel">
    <div className="today-ad-media"><img src={ad.imageUrl} alt="" loading="lazy" /></div>
    <div className="today-ad-content">
      <span className="eyebrow">{copy.ad}</span>
      <h2>{ad.title}</h2>
      <p>{ad.description}</p>
      <div className="today-ad-actions">
        <a className="secondary-button" href={ad.linkUrl} target="_blank" rel="noopener noreferrer sponsored">{copy.open}</a>
        <button type="button" className="ghost-button" disabled={viewedSeconds < 60}
          onClick={() => setAd(null)} aria-label={viewedSeconds < 60 ? `${copy.wait} ${60 - viewedSeconds} ${copy.unit}` : copy.close}>
          {viewedSeconds < 60 ? `${copy.wait} ${60 - viewedSeconds} ${copy.unit}` : copy.close}
        </button>
      </div>
    </div>
  </section>;
}
