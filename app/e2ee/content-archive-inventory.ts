/** Fixed device-content roles. This inventory grants no key, source-original,
 * control-packet or general empty-prefix discovery capability. */
const ids=new Set(['personal-diary-device-live-v1','personal-physis-editor-forms-v1']);
const prefixes=['profile-original:','shared-transfer-private:','shared-bulk-private:','shared-bulk-recovery:','shared-bulk-recovery-history:',
 'shared-request:','shared-work-private:','shared-work-history:','product-tx:','product-approval:','mindmap-view:','mindmap-conversions:',
 'shared-map-draft:','shared-map-local:','shared-map-conversion-journal:','shared-resource-create:','shared-project-create:',
 'shared-project-resolution:','membership-operation:','personal-content-restore:','domain-content-restore:','shared-content-restore:',
 'external-google-copy:','imported-legacy-content:'];
export const contentArchiveDeviceId=(id:string)=>ids.has(id)||prefixes.some(prefix=>id.startsWith(prefix));
