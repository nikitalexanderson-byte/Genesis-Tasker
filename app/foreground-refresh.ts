/** One foreground read at a time; a slow server must not build a queue of polls. */
export function foregroundRefresh(operation: (signal: AbortSignal) => Promise<unknown>, options: {
  available: (initialRead: boolean) => boolean;
  success: () => void;
  failure: (error: unknown) => void;
  settled?: () => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const controller = new AbortController();
  let pending = false, attempted = false, failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const trigger = async () => {
    if (pending || controller.signal.aborted) return;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (options.available(!attempted)) {
      attempted = true;
      pending = true;
      try { await operation(controller.signal); if (!controller.signal.aborted) { failures = 0; options.success(); } }
      catch (error) { if (!controller.signal.aborted) { failures++; options.failure(error); } }
      finally { pending = false; if (!controller.signal.aborted) options.settled?.(); }
    }
    if (!controller.signal.aborted) timer = schedule(() => void trigger(), Math.min(30_000, 5_000 * 2 ** Math.min(failures, 3)));
  };
  timer = schedule(() => void trigger(), 0);
  return { trigger, stop() { controller.abort(); if (timer !== undefined) cancel(timer); } };
}
