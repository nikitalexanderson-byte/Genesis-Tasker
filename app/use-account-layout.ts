import { useCallback, useRef, useState } from "react";
import { captureAccountSessionGuard, updateAccountPreferences, type GenesisUser } from "./cloud-sync";
import { accountLayout, type AccountLayout } from "./ui-visibility";
import { sameLayoutValue } from "./project-view-order";

/** Serialize small patches so a resize cannot overwrite an inbox move. */
export function useAccountLayout(user: GenesisUser | null, onUserChange: (user: GenesisUser) => void) {
  const uid = user?.uid ?? "";
  const language = user?.language;
  const [pending, setPending] = useState<{ uid: string; patch: Partial<AccountLayout> }>({ uid: "", patch: {} });
  const [failure, setFailure] = useState<{ uid: string; message: string }>({ uid: "", message: "" });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = useCallback((patch: Partial<AccountLayout>) => {
    if (!uid) return;
    const assertSession = captureAccountSessionGuard();
    setPending(current => ({ uid, patch: { ...(current.uid === uid ? current.patch : {}), ...patch } }));
    setFailure({ uid, message: "" });
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        assertSession();
        const result = await updateAccountPreferences({ uiLayout: patch });
        assertSession();
        const saved = accountLayout(result.user.uiVisibility);
        if (Object.entries(patch).some(([key, value]) => !sameLayoutValue(saved[key as keyof AccountLayout], value))) {
          throw new Error(language === "en" ? "Layout was not saved. Please try again." : "Расположение не сохранилось. Повторите изменение.");
        }
        onUserChange(result.user);
        setPending(current => {
          if (current.uid !== uid) return current;
          const remaining = { ...current.patch };
          for (const key of Object.keys(patch) as (keyof AccountLayout)[]) {
            if (sameLayoutValue(remaining[key], patch[key])) delete remaining[key];
          }
          return { uid, patch: remaining };
        });
      } catch (error) {
        setFailure({ uid, message: error instanceof Error ? error.message : String(error) });
      }
    });
  }, [uid, language, onUserChange]);
  return { layout: { ...accountLayout(user?.uiVisibility), ...(pending.uid === uid ? pending.patch : {}) },
    save, error: failure.uid === uid ? failure.message : "" };
}
