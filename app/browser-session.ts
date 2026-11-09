export type SessionEnvelope<T> = { user: T | null; csrf: string; loginId?: string };
export class SessionResponseError extends Error {
  constructor(message = "INVALID_SESSION_RESPONSE") { super(message); this.name="SessionResponseError"; }
}

/** A malformed successful response is a transport error, never proof of sign-out. */
export function sessionEnvelope<T extends { uid: string }>(value: unknown): SessionEnvelope<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionResponseError();
  const row = value as Record<string, unknown>;
  if (!Object.hasOwn(row,"user") || typeof row.csrf !== "string" || !row.csrf ||
      (row.loginId !== undefined && typeof row.loginId !== "string") ||
      (row.user !== null && (!row.user || typeof row.user !== "object" || Array.isArray(row.user) ||
        typeof (row.user as Record<string, unknown>).uid !== "string" || !(row.user as Record<string, unknown>).uid))) {
    throw new SessionResponseError();
  }
  return row as SessionEnvelope<T>;
}

/** Focus, reconnect and periodic observers share one check; cancelling one cannot cancel another. */
export function sessionReader<T>(read: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return (signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (!pending) {
      const request = Promise.resolve().then(read);
      pending = request;
      const release = () => { if (pending === request) pending = null; };
      void request.then(release, release);
    }
    const request = pending;
    if (!signal) return request;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      void request.then(value => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort(); else resolve(value);
      }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
  };
}
