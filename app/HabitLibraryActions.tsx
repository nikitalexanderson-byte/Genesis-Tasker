import { IconActionButton } from "./IconActionButton";
import type { CSSProperties } from "react";
import { translateText, type Language } from "./i18n";
import "./habit-library-actions.css";

export function HabitLibraryActions({ isKeyHabit, active, language, disabled = false, stateDisabled = false, onKey, onEdit, onToggleActive, onArchive, onRestore, onDelete }: {
  isKeyHabit: boolean; active: boolean; language: Language;
  disabled?: boolean; stateDisabled?: boolean;
  onKey?: () => void; onEdit?: () => void; onToggleActive?: () => void; onArchive?: () => void; onRestore?: () => void; onDelete?: () => void;
}) {
  const t = (ru: string, en: string) => language === "en" ? en : translateText(ru, language);
  const count = [onKey,onEdit,onToggleActive,onArchive,onRestore,onDelete].filter(Boolean).length;
  return <div className="habit-library-actions" style={{"--habit-action-count": count} as CSSProperties}>
    {onKey ? <IconActionButton icon="star" label={isKeyHabit ? t("Убрать фокус", "Remove focus") : t("Сделать главной", "Make key")} aria-pressed={isKeyHabit} onClick={onKey} disabled={disabled}/> : null}
    {onEdit ? <IconActionButton icon="edit" label={t("Изменить", "Edit")} onClick={onEdit} disabled={disabled}/> : null}
    {onToggleActive ? <IconActionButton icon={active ? "pause" : "play"} label={active ? t("Пауза", "Pause") : t("Включить", "Resume")} onClick={onToggleActive} disabled={disabled||stateDisabled}/> : null}
    {onArchive ? <IconActionButton icon="archive" label={t("В архив", "Archive")} onClick={onArchive} disabled={disabled||stateDisabled}/> : null}
    {onRestore ? <IconActionButton icon="map-back" label={t("Восстановить", "Restore")} onClick={onRestore} disabled={disabled||stateDisabled}/> : null}
    {onDelete ? <IconActionButton icon="delete" label={t("Удалить", "Delete")} className="danger" onClick={onDelete} disabled={disabled||stateDisabled}/> : null}
  </div>;
}
