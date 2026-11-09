import type {SharedProjectQuota} from './cloud-sync';

/** Server counts the owner's pool. Never sum the current member's visible projects. */
export function sharedProjectQuotaAvailable(quota: SharedProjectQuota | undefined, parentId?: string | null): boolean {
  return Boolean(parentId) || !quota || quota.remaining === null || quota.remaining > 0;
}
