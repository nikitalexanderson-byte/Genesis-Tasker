/** No OAuth or uploads until express prior written consent from Google and a reviewed rollout. */
export const DRIVE_BACKUP_ENABLED = false;
export interface BackupCloudAdapter {
  readonly provider: 'google-drive';
  upload(input: { operationId: string; ciphertext: string; sha256: string }): Promise<{ id: string; verified: boolean }>;
  disconnect(): Promise<void>;
}
export function backupDriveAdapter(): BackupCloudAdapter {
  return { provider: 'google-drive', async upload() { throw new Error('DRIVE_BACKUP_NOT_APPROVED'); }, async disconnect() { /* No grant has been requested. User files are never deleted. */ } };
}
