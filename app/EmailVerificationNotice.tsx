import { useEffect, useId, useRef, useState } from "react";
import { accountEmailVerification, dismissAccountEmailVerification, captureAccountSessionGuard, type GenesisUser } from "./cloud-sync";
import {DialogCloseButton} from "./DialogCloseButton";
import copy from "./email-verification-copy.json";
import "./email-verification.css";

/** Account verification is required even when optional notifications are disabled. */
export function EmailVerificationNotice({ user, onChange }: { user: GenesisUser; onChange: (user: GenesisUser) => void }) {
  const text = copy[user.language];
  const titleId = useId();
  const status = user.emailVerification;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"sent" | "error" | null>(null);
  const [cooldown, setCooldown] = useState(user.emailVerification?.retryAfter ?? 0);
  const [dismissedUntil,setDismissedUntil]=useState(()=>typeof localStorage==="undefined"?0:Number(localStorage.getItem(`genesis-email-notice:${user.uid}`))||0),[clock,setClock]=useState(()=>Date.now());
  const current = useRef({ user, onChange, status });
  const request = useRef<(send?: boolean) => Promise<void>>(async () => {});
  useEffect(() => { current.current = { user, onChange, status }; }, [user, onChange, status]);

  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const guard = captureAccountSessionGuard();
    const refresh = async (send = false) => {
      if (pending || !active) return;
      if (!navigator.onLine) { setMessage("error"); return; }
      pending = true;
      setBusy(true);
      if (send) setMessage(null);
      try {
        const result = await accountEmailVerification(send, controller.signal);
        guard();
        if (!active) return;
        setCooldown(result.verification.retryAfter);
        const latest = current.current;
        latest.onChange({ ...latest.user, emailVerification: result.verification });
        if (send) setMessage("sent");
        else if (!result.verification.required) setMessage(null);
      } catch {
        if (active && !controller.signal.aborted) setMessage("error");
      } finally {
        pending = false;
        if (active) setBusy(false);
      }
    };
    request.current = refresh;
    void refresh();
    const resume = () => { setClock(Date.now());if (document.visibilityState === "visible" && current.current.status?.required !== false) void refresh(); };
    const timer = window.setInterval(resume, 60000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [user.uid]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function dismiss(){
    const until=Date.now()+86400000;setDismissedUntil(until);localStorage.setItem(`genesis-email-notice:${user.uid}`,String(until));
    const guard=captureAccountSessionGuard();void dismissAccountEmailVerification().then(result=>{guard();current.current.onChange({...current.current.user,emailVerification:result.verification});}).catch(()=>undefined);
  }
  if (!status?.required||dismissedUntil>clock||status.dismissedUntil&&Date.parse(status.dismissedUntil)>clock) return null;
  return <section className="email-verification-notice" aria-labelledby={titleId} data-testid="email-verification-notice" data-no-translate>
    <DialogCloseButton onClick={dismiss} aria-label={text.dismiss}/>
    <div className="email-verification-copy">
      <strong id={titleId}>{text.title}</strong>
      <p>{text.description.replace("{email}", user.email ?? "")}</p>
      <small>{text.hint}</small>
      {status.deadlineAt?<p>{text.deadline.replace("{date}",new Date(status.deadlineAt).toLocaleDateString(user.language))}</p>:null}
    </div>
    <div className="email-verification-actions">
      <button type="button" disabled={busy || cooldown > 0} onClick={() => void request.current(true)}>
        {cooldown > 0 ? text.wait.replace("{seconds}", String(cooldown)) : text[status.hasRequest ? "resend" : "send"]}
      </button>
      <button type="button" disabled={busy} onClick={() => void request.current()}>{text.check}</button>
    </div>
    {message ? <p className="email-verification-result" role="status">{text[message]}</p> : null}
  </section>;
}
