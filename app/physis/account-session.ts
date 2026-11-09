import { accountPhysisVault, openAccountPhysisVault, unlockPhysisVault, validateVault, type AccountKeyAccess, type PhysisVault } from './crypto';

export type VaultState = { vault: PhysisVault | null; revision: number };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Never replace a populated legacy vault without its key. All mutations use CAS. */
export async function openPhysisAccount(owner: string, access: AccountKeyAccess, request: Request, check: () => void,
  legacy?: { secret: string; method: 'password' | 'recovery' }): Promise<{ state: VaultState; key: CryptoKey | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    check();
    const state = await request<VaultState>('/vault'); check();
    if (state.vault) validateVault(state.vault);
    if (state.vault?.version === 2) {
      const key = await openAccountPhysisVault(access, state.vault); check(); return { state, key };
    }
    let previousKey: CryptoKey | undefined;
    let emptyCursor: number | undefined;
    if (state.vault) {
      if (legacy) {
        previousKey = await unlockPhysisVault(owner, state.vault, legacy.secret, legacy.method); check();
      } else {
        const records = await request<{ records: { deletedAt: string | null }[]; hasMore: boolean; snapshot: number }>('/records'); check();
        if (records.hasMore || records.records.some(record => !record.deletedAt)) return { state, key: null };
        emptyCursor = records.snapshot;
      }
    }
    const keyVersion = (state.vault?.keyVersion ?? 1) + (emptyCursor !== undefined ? 1 : 0);
    const next = await accountPhysisVault(access, keyVersion, previousKey); check();
    const body = { requestId: crypto.randomUUID(), expectedRevision: state.revision, vault: next.vault,
      ...(emptyCursor !== undefined ? { expectedCursor: emptyCursor, records: [] } : {}) };
    try {
      const saved = await request<{ revision: number }>(emptyCursor !== undefined ? '/rotate' : '/vault', {
        method: emptyCursor !== undefined ? 'POST' : 'PUT', body: JSON.stringify(body),
      }); check();
      return { state: { vault: next.vault, revision: saved.revision }, key: next.key };
    } catch (error) {
      check();
      if ((error as { status?: number })?.status !== 409 || attempt === 2) throw error;
      // Another tab may have initialized or migrated it. Read its committed key.
    }
  }
  throw new Error('Не удалось открыть Фюзис. Повторите попытку.');
}
