import { useEffect, useRef } from "react";
import { applyHabitAutoDeletion, type HabitWorkspace } from "./habits";

/** Evaluate on arrival, clock changes and synchronized updates, then use the normal encrypted save. */
export function useHabitAutoDeletion(workspace: HabitWorkspace, clock: Date, ready: boolean,
  onSave: (next: HabitWorkspace) => unknown, onError: (message: string) => void) {
  const save = useRef(onSave), error = useRef(onError), pending = useRef(false);
  useEffect(() => { save.current = onSave; error.current = onError; }, [onSave, onError]);
  useEffect(() => {
    if (!ready || pending.current || !workspace.habits.some(habit => habit.autoDeletePolicy)) return;
    try {
      const next = applyHabitAutoDeletion(workspace, clock.toISOString());
      if (next === workspace) return;
      pending.current = true;
      void Promise.resolve(save.current(next)).catch(reason => error.current(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => { pending.current = false; });
    } catch (reason) { error.current(reason instanceof Error ? reason.message : String(reason)); }
  }, [workspace, clock, ready]);
}
