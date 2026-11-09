'use client';
import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {weatherDisplay, type WeatherDisplay} from './weather-display';

const fallback = '{}', eventName = 'genesis:weather-display';
const memory = new Map<string, string>(), volatile = new Set<string>();
function read(key: string) {
  if (volatile.has(key)) return memory.get(key) ?? fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return memory.get(key) ?? fallback; }
}
function parse(raw: string) {try {return weatherDisplay(JSON.parse(raw));} catch {return weatherDisplay(null);}}

/** Device preference scoped to the account, shared by Appearance and the Today card. */
export function useWeatherDisplay(ownerId: string | null) {
  const key = `genesis:weather-display:${ownerId ?? 'local'}`;
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {if (event.key === key || event.key === null) notify();};
    const local = (event: Event) => {if ((event as CustomEvent<string>).detail === key) notify();};
    window.addEventListener('storage', storage); window.addEventListener(eventName, local);
    return () => {window.removeEventListener('storage', storage); window.removeEventListener(eventName, local);};
  }, [key]);
  const snapshot = useCallback(() => read(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => fallback);
  const units = useMemo(() => parse(raw), [raw]);
  const update = useCallback((patch: Partial<WeatherDisplay>) => {
    const next = JSON.stringify(weatherDisplay({...parse(read(key)), ...patch}));
    memory.set(key, next);
    try {localStorage.setItem(key, next); volatile.delete(key);} catch {volatile.add(key);}
    window.dispatchEvent(new CustomEvent(eventName, {detail: key}));
  }, [key]);
  return {units, update};
}
