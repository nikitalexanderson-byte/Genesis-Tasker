"use client";

import { useEffect, useId, useRef, useState } from "react";
import { translateText, type Language } from "./i18n";
import { localizedSolarPlace, readSolarPlace, saveSolarPlace, searchSolarPlaces, solarPlaceLabel, readSolarTimesVisible, saveSolarTimesVisible, type SolarPlace } from "./solar-place";
import { getSunriseSunset, getTimezoneFallbackLocation, formatDeviceSolarTime } from "./solar-times";

export function SolarPlaceSettings({ language, focusCity = false }: { language: Language; focusCity?: boolean }) {
  const [selected, setSelected] = useState<SolarPlace | null>(() => readSolarPlace());
  const [showTimes, setShowTimes] = useState(readSolarTimesVisible);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SolarPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => {
    if(!focusCity)return;
    const frame=window.requestAnimationFrame(()=>{
      searchRef.current?.scrollIntoView({block:"center",behavior:"instant"});
      searchRef.current?.focus({preventScroll:true});
    });
    return ()=>window.cancelAnimationFrame(frame);
  },[focusCity]);
  const copy = (ru: string, en: string) => {
    if (language === "ru") return ru;
    if (language === "en") return en;
    const translated = translateText(ru, language);
    return translated === ru ? en : translated;
  };

  useEffect(() => {
    const controller = new AbortController();
    const place = readSolarPlace();
    if (place) {
      const localize = place.id
        ? localizedSolarPlace(place, language, controller.signal)
        : searchSolarPlaces(place.name, language, controller.signal).then((places) =>
          places.find((candidate) => Math.abs(candidate.latitude - place.latitude) < 0.0001
            && Math.abs(candidate.longitude - place.longitude) < 0.0001) ?? place);
      void localize
        .then((localized) => {
          const current = readSolarPlace();
          if (controller.signal.aborted || !current
            || current.latitude !== place.latitude || current.longitude !== place.longitude) return;
          setSelected(localized);
          saveSolarPlace(localized);
        })
        .catch(() => { /* Keep saved coordinates if the geocoder is unavailable. */ });
    }
    return () => controller.abort();
  }, [language]);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      void searchSolarPlaces(query, language, controller.signal)
        .then((found) => {
          setResults(found);
          setActiveIndex(found.length ? 0 : -1);
          if (!found.length) setError(copy("Город не найден. Уточните название.", "No places found. Try a different name."));
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(copy("Не удалось найти город. Проверьте подключение.", "Could not search places. Check your connection."));
        })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, language, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (place: SolarPlace) => {
    saveSolarPlace(place);
    setSelected(place);
    setQuery("");
    setResults([]);
    setError("");
    setOpen(false);
  };
  const timeZone = selected?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const times = getSunriseSunset(new Date(), selected ?? getTimezoneFallbackLocation(timeZone));
  const formatTime = (date: Date) => `${selected ? "" : "≈"}${formatDeviceSolarTime(date, timeZone)}`;

  return <section className="account-preferences solar-place-preference" aria-labelledby="solar-place-title" data-exp-ui="panel">
    <div className="solar-place-intro">
      <span className="eyebrow">{copy("Восход и закат", "Sunrise and sunset")}</span>
      <h3 id="solar-place-title">{copy("Восход и закат", "Sunrise and sunset")}</h3>
      <p>{copy("Выберите город для точного времени восхода и заката по его часовому поясу.", "Choose a city for sunrise and sunset times in its local time zone.")}</p>
    </div>
    <label htmlFor="show-solar-times" aria-label={copy("Показывать время восхода и заката", "Show sunrise and sunset times")} className="account-switch-row solar-display-switch">
      <span><strong>{copy("Показывать время восхода и заката", "Show sunrise and sunset times")}</strong></span>
      <input id="show-solar-times" type="checkbox" role="switch" checked={showTimes} onChange={(event) => {
        setShowTimes(event.target.checked); saveSolarTimesVisible(event.target.checked);
      }} />
      <i aria-hidden="true" />
    </label>
    <div className="solar-settings-preview" aria-label={copy("Сегодня", "Today")}>
      <div><span>{copy("Восход", "Sunrise")}</span><strong>{times ? formatTime(times.sunrise) : "—"}</strong></div>
      <div><span>{copy("Закат", "Sunset")}</span><strong>{times ? formatTime(times.sunset) : "—"}</strong></div>
      <small>{timeZone}{!selected ? ` · ${copy("приблизительно", "approximate")}` : ""}</small>
    </div>
    {selected ? <div className="solar-place-selected" aria-live="polite">
      <span>{copy("Выбранный город", "Selected city")}</span>
      <strong data-no-translate>{solarPlaceLabel(selected)}</strong>
      <small data-no-translate>{selected.timeZone}</small>
      <button type="button" onClick={() => { saveSolarPlace(null); setSelected(null); setQuery(""); setOpen(false); }}>{copy("Сбросить", "Clear")}</button>
    </div> : <p className="solar-place-unselected" aria-live="polite">{copy("Город не выбран · время с символом ≈ приблизительно", "No city selected · times marked ≈ are approximate")}</p>}
    <div className="solar-place-combobox" ref={rootRef}>
      <label htmlFor="solar-place-query">{copy("Найти город", "Find a city")}</label>
      <div className="solar-place-input-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 5 5" /></svg>
        <input ref={searchRef} data-dialog-initial-focus={focusCity ? "" : undefined} id="solar-place-query" type="search" autoComplete="off" value={query}
          placeholder={copy("Начните вводить название города", "Start typing a city name")}
          role="combobox" aria-autocomplete="list" aria-expanded={open && query.trim().length >= 2 && (busy || Boolean(error) || results.length > 0)}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-activedescendant={open && results.length > 0 && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setResults([]); setActiveIndex(-1); setBusy(false); setError(""); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); return; }
            if (!results.length) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index + results.length - 1) % results.length); }
            if (event.key === "Enter") { event.preventDefault(); choose(results[Math.max(activeIndex, 0)]); }
          }} />
      </div>
      {open && query.trim().length >= 2 && (busy || error || results.length > 0) ? <div className="solar-place-popover">
        {busy ? <p role="status">{copy("Ищем города…", "Searching for places…")}</p> : error ? <p role="status">{error}</p> :
          <ul id={listId} role="listbox" aria-label={copy("Подходящие города", "Matching cities")}>
            {results.map((place, index) => <li role="none" key={`${place.id ?? place.name}-${place.latitude}-${place.longitude}`}>
              <button type="button" role="option" id={`${listId}-${index}`} aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(place)}>
                <strong data-no-translate>{place.name}</strong>
                <span data-no-translate>{Array.from(new Set([place.region, place.country].filter(Boolean))).join(", ")}</span>
              </button>
            </li>)}
          </ul>}
      </div> : null}
      <small>{copy("Введите минимум 2 буквы и выберите город из подсказок.", "Type at least 2 letters and choose a city from the suggestions.")}</small>
    </div>
  </section>;
}
