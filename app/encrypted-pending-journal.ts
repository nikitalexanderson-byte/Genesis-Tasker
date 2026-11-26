/** Append-only ciphertext snapshots. Each repository instance has its own writer
 * and sequence; another tab cannot overwrite its unacknowledged work. The old
 * single-slot key remains readable and is removed only after a proven receipt.
 * Callers hold their owner operation permit for all reads, writes and cleanup.
 */
export type EncryptedJournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export type EncryptedJournalEntry = Readonly<{key:string;raw:string;writer:string;sequence:number}>;
export type EncryptedJournalBranch = Readonly<{head:EncryptedJournalEntry;entries:readonly EncryptedJournalEntry[]}>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LIMIT = 1024;

export class EncryptedPendingJournal {
  readonly writer = crypto.randomUUID();
  #sequence = 0;
  constructor(readonly legacyKey:string) {
    if(!legacyKey.endsWith(':pending'))throw new Error('E2EE_INVALID_JOURNAL_BINDING');
  }
  read(storage:EncryptedJournalStorage):EncryptedJournalBranch[] {
    const keys = new Set<string>([this.legacyKey]), prefix = this.legacyKey + ':writer:';
    for(let i=0;i<storage.length;i++) {
      const key=storage.key(i);if(key?.startsWith(prefix))keys.add(key);
      if(keys.size>LIMIT+1)throw new Error('E2EE_JOURNAL_LIMIT');
    }
    const writers=new Map<string,EncryptedJournalEntry[]>();let count=0;
    for(const key of keys) {
      const raw=storage.getItem(key);if(raw===null)continue;
      if(++count>LIMIT)throw new Error('E2EE_JOURNAL_LIMIT');
      let writer='legacy',sequence=0;
      if(key!==this.legacyKey) {
        const parts=key.slice(prefix.length).split(':');writer=parts[0];sequence=Number(parts[1]);
        if(parts.length!==3||parts[2]!=='pending'||!UUID.test(writer)||!Number.isSafeInteger(sequence)||sequence<1||String(sequence)!==parts[1])
          throw new Error('E2EE_INVALID_JOURNAL_ENTRY');
      }
      const entries=writers.get(writer)??[];entries.push({key,raw,writer,sequence});writers.set(writer,entries);
    }
    return [...writers].sort(([a],[b])=>a.localeCompare(b,'en')).map(([,entries])=>{
      entries.sort((a,b)=>a.sequence-b.sequence);return {head:entries.at(-1)!,entries};
    });
  }
  stage(storage:EncryptedJournalStorage,raw:string):EncryptedJournalBranch {
    const branches=this.read(storage),existing=branches.find(branch=>branch.head.writer===this.writer)?.entries??[];
    if(branches.reduce((n,branch)=>n+branch.entries.length,0)>=LIMIT)throw new Error('E2EE_JOURNAL_LIMIT');
    const sequence=++this.#sequence;if(!Number.isSafeInteger(sequence))throw new Error('E2EE_JOURNAL_LIMIT');
    const key=`${this.legacyKey}:writer:${this.writer}:${sequence}:pending`;
    // One durable write before IO. No mutable shared index or head pointer.
    storage.setItem(key,raw);
    const head={key,raw,writer:this.writer,sequence};return {head,entries:[...existing,head]};
  }
  acknowledge(storage:EncryptedJournalStorage,branch:EncryptedJournalBranch):void {
    // All entries are exact snapshots known before the accepted latest write.
    // A later save, even by this writer, is absent and cannot be acknowledged.
    for(const entry of branch.entries)if(storage.getItem(entry.key)===entry.raw)storage.removeItem(entry.key);
  }
}
