"use client";
import {useEffect, useRef} from "react";
import {loadGenesisSession, type GenesisUser} from "./cloud-sync";
import {requestUpgrade} from "./upgrade-events";
import {
  BILLING_TRIAL_REFRESH_EVENT, billingTrialFrom, billingTrialImprovesPaid,
  billingTrialRemaining, invalidateTrialAccess, resolvedFeatureAccess,
} from "./billing-trial";

type UserChange = ((user: GenesisUser) => void) | undefined;

/** The single global host refreshes leases. Status components never grant or extend access. */
export function useBillingTrialLifecycle(user: GenesisUser | null, onUserChange: UserChange) {
  const accountId = user?.uid;
  const latest = useRef({user, onUserChange});
  const controls = useRef<{schedule: () => void} | null>(null);
  const granted = useRef(new Set<string>());
  const prompted = useRef(new Set<string>());
  useEffect(() => { latest.current = {user, onUserChange}; }, [user, onUserChange]);

  useEffect(() => {
    const uid = accountId, initial = latest.current.user;
    if (!uid || !initial || initial.uid !== uid) return;
    let stopped = false, pending = false, timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let request: AbortController | null = null;
    const visible = () => document.visibilityState === "visible";
    const inspect = (profile: GenesisUser) => {
      const trial = billingTrialFrom(profile);
      if (!trial?.plan || !trial.endsAt || profile.uid !== uid) return;
      const key = [uid, trial.plan, trial.startsAt, trial.endsAt].join(":");
      const access = profile.featureAccess;
      if (access?.source === "trial" && resolvedFeatureAccess(access) === access) granted.current.add(key);
      if (trial.status === "expired" && visible() && granted.current.has(key) && !prompted.current.has(key)
        && billingTrialImprovesPaid(access, trial.plan)) {
        prompted.current.add(key);
        requestUpgrade({reason:"trial-expired", plan:trial.plan});
      }
    };
    const publishInvalidation = () => {
      invalidateTrialAccess();
      const current = latest.current;
      if (current.user?.uid === uid) current.onUserChange?.({...current.user});
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const current = latest.current.user;
      if (stopped || !visible() || !navigator.onLine || current?.uid !== uid) return;
      inspect(current);
      if (billingTrialFrom(current)?.status !== "active") return;
      const remaining = billingTrialRemaining(current.featureAccess);
      // A conservative lease can end <1s before the server's whole-second timestamp.
      // Recheck rather than declaring expiry from the display clock.
      timer = setTimeout(() => void refresh(), remaining !== null && remaining > 0
        ? Math.min(remaining, 2_147_000_000) : Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    };
    const refresh = async () => {
      if (stopped || pending || !visible()) return;
      publishInvalidation();
      if (!navigator.onLine) return;
      pending = true;
      request = new AbortController();
      try {
        const fresh = await loadGenesisSession(request.signal);
        if (stopped || request.signal.aborted || fresh?.uid !== uid || latest.current.user?.uid !== uid) return;
        latest.current = {...latest.current, user:fresh};
        latest.current.onUserChange?.(fresh);
        failures = 0;
        inspect(fresh);
      } catch {
        // The old lease remains invalid. Status shows that an online check is needed.
        if (!request?.signal.aborted) failures++;
      } finally {
        pending = false;
        request = null;
        if (!stopped) schedule();
      }
    };
    const onForeground = () => {
      if (billingTrialFrom(latest.current.user ?? {})?.status === "active") void refresh();
    };
    const onVisibility = () => {
      if (visible()) onForeground();
      else {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        request?.abort();
        publishInvalidation();
      }
    };
    const onOffline = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      request?.abort();
      publishInvalidation();
    };
    const manualRefresh = () => void refresh();
    const onPageHide=onOffline;
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("online", onForeground);
    window.addEventListener("offline", onOffline);
    window.addEventListener(BILLING_TRIAL_REFRESH_EVENT, manualRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    controls.current = {schedule};
    inspect(initial);
    schedule();
    if (billingTrialFrom(initial)?.status === "active" && billingTrialRemaining(initial.featureAccess) === null) void refresh();
    return () => {
      stopped = true; request?.abort();
      if (timer !== undefined) clearTimeout(timer);
      controls.current = null;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("online", onForeground);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(BILLING_TRIAL_REFRESH_EVENT, manualRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
      invalidateTrialAccess();
    };
  }, [accountId]);
  useEffect(() => { controls.current?.schedule(); }, [user]);
}
