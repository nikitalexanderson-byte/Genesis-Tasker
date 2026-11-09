/** Retry only a failed module fetch. Never retry application code or reload a draft. */
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .+ failed|Unable to preload CSS/i.test(message);
}

export async function importWithRecovery<T>(
  load: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 400)),
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isModuleLoadError(error)) throw error;
    await wait();
    // A single retry handles a transient connection/deployment failure. The
    // boundary offers an explicit refresh if this also fails. No storage is
    // cleared, no worker is forced to activate, and no automatic reload occurs.
    return load();
  }
}
