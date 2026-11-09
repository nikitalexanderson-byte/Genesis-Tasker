/** Contract only. No provider OAuth, background import, or direct browser health-store access. */
export type PhysisConnector = {
  provider: 'google-health' | 'health-connect' | 'healthkit' | 'garmin' | 'health-services';
  capability: 'cloud' | 'android-bridge' | 'apple-bridge' | 'wearos';
  status: 'planned' | 'consented' | 'syncing' | 'stopped' | 'revoked';
  dataTypes: ('workout' | 'nutrition' | 'intake' | 'measurement')[];
  direction: 'import' | 'export' | 'both';
  consent: { grantedAt: string | null; revokedAt: string | null; scopes: string[] };
  cursor: string | null; revision: number;
};
export type PhysisExternalRecord = {
  provider: PhysisConnector['provider']; externalId: string; revision: string; deleted: boolean;
  originalUnits: string; timestamp: string; timeZone: string; historicalDay: string;
  provenance: { importedAt: string; source: string; originatingPhysisId: string | null };
};
export function connectorDeduplicationKey(record: PhysisExternalRecord) { return `${record.provider}:${record.externalId}`; }
export function acceptsConnectorRecord(connector: PhysisConnector, record: PhysisExternalRecord) {
  return connector.provider === record.provider && connector.status === 'syncing' && connector.consent.grantedAt !== null &&
    connector.consent.revokedAt === null && connector.direction !== 'export' && record.provenance.originatingPhysisId === null;
}
