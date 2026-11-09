export type PhysisAccessStatus = 'checking' | 'ready' | 'unavailable' | 'error';
type AccessReply = { available: boolean; ownerId: string };

/** Admission is server-owned. Network failures cannot erase an open unsaved vault. */
export function createPhysisAccessCheck(owner: string, request: (signal: AbortSignal) => Promise<AccessReply>,
  changed: (status: PhysisAccessStatus) => void, timers: { schedule: typeof setTimeout; cancel: typeof clearTimeout } = { schedule: setTimeout.bind(globalThis), cancel: clearTimeout.bind(globalThis) }) {
  const controller = new AbortController();
  let pending = false, status: PhysisAccessStatus = 'checking', delay = 1000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (pending || controller.signal.aborted) return;
    if (retry !== undefined) timers.cancel(retry);
    retry = undefined;
    pending = true;
    try {
      const result = await request(controller.signal);
      if (controller.signal.aborted) return;
      status = result.available === true && result.ownerId === owner ? 'ready' : 'unavailable';
      delay = 1000;
      changed(status);
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error as { status?: number } | null;
      if (failure?.status === 403 || failure?.status === 401) {
        status = 'unavailable';
        changed(status);
      } else {
        if (status !== 'ready') { status = 'error'; changed(status); }
        retry = timers.schedule(() => void refresh(), delay);
        delay = Math.min(delay * 2, 30000);
      }
    } finally { pending = false; }
  };
  return { refresh, stop() { controller.abort(); if (retry !== undefined) timers.cancel(retry); } };
}
