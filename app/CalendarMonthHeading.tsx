import { useEffect, useRef, type ReactNode } from "react";
import { ExperimentalIcon } from "./ExperimentalIcon";

export function CalendarMonthHeading({ title, icon, previousLabel, nextLabel, onPrevious, onNext }: {
  title: string; icon: ReactNode; previousLabel: string; nextLabel: string;
  onPrevious: () => void; onNext: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = titleRef.current;
    if (!heading) return;
    const fitTitle = () => {
      heading.style.fontSize = "";
      const available = heading.clientWidth;
      const preferred = Number.parseFloat(getComputedStyle(heading).fontSize);
      if (available > 0 && heading.scrollWidth > available) {
        heading.style.fontSize = `${Math.max(16, Math.floor(preferred * available / heading.scrollWidth))}px`;
      }
    };
    fitTitle();
    const observer = new ResizeObserver(fitTitle);
    if (heading.parentElement) observer.observe(heading.parentElement);
    let active = true;
    void document.fonts.ready.then(() => { if (active) fitTitle(); });
    return () => { active = false; observer.disconnect(); };
  }, [title]);
  return <div className="calendar-month-title-row">
    <button type="button" className="calendar-inline-arrow calendar-inline-previous" aria-label={previousLabel} onClick={onPrevious}><ExperimentalIcon name="chevron"/></button>
    <div className="calendar-month-title">{icon ? <span className="calendar-inline-symbol" aria-hidden="true">{icon}</span> : null}<h1 ref={titleRef}>{title}</h1></div>
    <button type="button" className="calendar-inline-arrow" aria-label={nextLabel} onClick={onNext}><ExperimentalIcon name="chevron"/></button>
  </div>;
}
