"use client";
import { useEffect, useRef, useState } from 'react';
import './diary.css';
export function DiaryMark() {
  return <svg className="diary-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className="diary-mark-cover" d="M8 5h16a2 2 0 0 1 2 2v21H9a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" />
    <path d="M10 5v23M6 24h20M16 5v8l3-2 3 2V5"/>
    <path className="diary-mark-ink" d="M14 17h8m-8 4h6"/>
  </svg>;
}
export function DiaryLaunchButton({ label, onClick }: { label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null); const [moving, setMoving] = useState(false);
  useEffect(() => {
    let visible = false; const update = () => setMoving(visible && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    if (ref.current) observer.observe(ref.current); document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <button ref={ref} type="button" className="diary-launch" data-animating={moving} onClick={onClick}><DiaryMark /><span>{label}</span></button>;
}
