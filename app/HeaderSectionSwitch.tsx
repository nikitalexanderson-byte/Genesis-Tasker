import { ExperimentalIcon } from "./ExperimentalIcon";
import "./header-section-switch.css";

type Section = { id: string; label: string; icon: string; active: boolean; onSelect: () => void };

/** One section switch, mounted in the active desktop or compact header. */
export function HeaderSectionSwitch({ label, sections, panelId }: { label: string; sections: Section[]; panelId?: string }) {
  if (!sections.length) return null;
  return <div className="header-section-switch" role={panelId ? "tablist" : "group"} aria-label={label}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowLeft" ? buttons.length - 1 : 1)) % buttons.length;
      event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
    }}>
    {sections.map(section => <button key={section.id} id={section.id} type="button"
      role={panelId ? "tab" : undefined} aria-selected={panelId ? section.active : undefined}
      aria-pressed={panelId ? undefined : section.active} aria-controls={panelId}
      tabIndex={panelId && !section.active ? -1 : 0} aria-label={section.label} data-tooltip={section.label}
      onClick={section.onSelect}>
      <ExperimentalIcon name={section.icon} /><span data-no-translate>{section.label}</span>
    </button>)}
  </div>;
}
