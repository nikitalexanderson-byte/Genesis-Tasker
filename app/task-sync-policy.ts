type CachedTask = {
  id: string;
  updatedAt: number;
  googleEventId?: string | null;
  googleTaskId?: string | null;
  googleLinks?: Record<string, unknown>;
};

/** Only a never-synced draft may be created from cache when absent from Google. */
export function shouldUploadCachedTask(local: CachedTask, remote: CachedTask | undefined, deleted: boolean): boolean {
  if (deleted || local.googleTaskId) return false;
  if (remote) return local.updatedAt > remote.updatedAt;
  return !local.googleEventId && !Object.keys(local.googleLinks ?? {}).length;
}
