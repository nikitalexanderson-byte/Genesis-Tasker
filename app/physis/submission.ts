import type { PhysisRecord, PhysisStore } from './types.ts';

/** Retain generated IDs until acknowledgement; a lost response must not create a second copy. */
export function createPhysisSubmission() {
  const pending = new Map<string, PhysisRecord[]>();
  return async (intent: string, prepare: () => PhysisRecord[], store: PhysisStore) => {
    let records = pending.get(intent);
    const retry = records !== undefined;
    if (!records) { records = prepare(); pending.set(intent, records); }
    // A background retry can acknowledge this intent before its UI callback retries.
    // Existing confirmed IDs may already contain later edits; never replay the frozen draft over them.
    if (store.status === 'saved' && records.every(record => store.records.some(current => current.id === record.id))) {
      pending.delete(intent); return;
    }
    // Newer edits can still be optimistic (saving/offline). Preserve them too;
    // the store retains and retransmits its original uncertain request independently.
    const current = new Map(store.records.map(record => [record.id, record]));
    const latest = retry ? records.map(record => current.get(record.id) ?? record) : records;
    // Month plans may exceed the API's 100-record transaction limit. Acknowledged
    // chunks leave the retry intent; an uncertain chunk retains exactly its IDs.
    for (let index = 0; index < latest.length; index += 100) {
      await store.saveMany(latest.slice(index, index + 100));
      pending.set(intent, records.slice(index + 100));
    }
    pending.delete(intent);
  };
}
