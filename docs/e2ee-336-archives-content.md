# Old archive content: strict readers and authenticated opening ports

20 November2026. Common reader increment, not a complete `personal.archives`
adapter, native key capability, ordinary import/restore or release. Coverage9/20.

`app/e2ee/archives-content.ts` reads the two actual nested server formats:
`backup_stages.payload_json` is an operation array; safety `snapshot_json` is
the direct14-table dictionary from `genesisBackupPersonalRows`, without a
`tables` wrapper. A complete preflight checks original duplicate/escaped names,
bounded schemas, distinct identities and canonical old IV/cipher framing before
the first old-key call. Unknown authority tables/operation sections/future fields
refuse without IO or source replacement. Source originals remain untouched.

The six sections map to their real old workspace/no-AAD or owner/purpose-bound
account AAD. Encrypted table rows become original plaintext JSON plus inert
metadata; mindmap versions, settings, false/zero and all tombstones remain
separate. Original decrypted text is retained rather than projecting unknown
record fields away. Physis envelope text passes its existing strict format
validator and requires an independent authenticated opening capability for the
exact owner/ID/key version; missing keys are locked, never an empty result.

Opening ports receive the expected owner explicitly. The eventual web/native
factory must bind them to the signed owner/source and pin the original envelopes;
native account/Keystore/Physis keys must stay out of JavaScript. Null/projected
object/non-JSON replies fail rather than discarding encrypted content. The reader
checks the account before/after each asynchronous call and publishes no partial
result after an account transition. Crypto uses the caller's trusted WebCrypto/
JCA readers; this module neither implements a cipher nor supplies new keys.

Output is `execution:history-only` with no request, restore, identity, entitlement,
session, device approval, quota or ACL port and no `complete=true`. It is not an
executable legacy queue. Current record schema/import validation and fresh
permissions remain mandatory before any future content-only import. Logical
history has no dependency on old cipher wrappers after successful materialization;
raw source hashes/IDs are not target remote AAD or new object IDs.

Limits:64MiB original input/plaintext,128MiB aggregate serialized output,1000
operations,50000 rows. Existing source/coordinator/runtime/file budgets can refuse
earlier; this is not composed large-data acceptance. Nested web safety/held state,
native LocalCipher/Diary caches, portable selected files and complete lifecycle
still need the actual archive adapter and authenticated retained-key capture.

Acceptance:8 new reader cases and26/26 focused reader/input regressions PASS;
full JS1786/1786 PASS,0 fail/skip with explicit owned PHP. Types and scoped reader
ESLint PASS. Web build PASS:98 HTML/14 languages, exact dictionaries,280 gallery
screenshots and offline precache. Tests use real WebCrypto old account/Physis
encryption, distinct history/deletions and serialized new-root AEAD readback after
old opening capabilities are retired. That is a primitive test, not a clean-device
product recovery or secure erasure of public synthetic fixture keys.

The isolated PHP fixture inserts synthetic rows into the actual current SQLite
schema, uses actual `genesisBackupPersonalRows` and server encrypt/decrypt wrapper,
then feeds their original JSON to the shared readers. It verifies the selected
local config before opening SQLite and cannot point to production/real owners;
preview/apply/restore/entitlement endpoints never run. All14 tables and every
decrypted record/tombstone/settings row survive this cross-boundary case.

Evidence: `output/release-3.3.6/runtime/archives-content-{focused-01,full-js-01,types-01,lint-01,web-build-01}.log`.
No new Android build/device acceptance is claimed for this unconnected shared
reader. The preceding form increment is at642d7a99; exact accepted native inputs
are recorded in `archives-native-forms-accepted-commit-02.json`. GitHub Source
checks44646564201 is running on that preceding commit, not this reader.
Production3.3.5/149, floors0/pilot/cutover off and GENESIS_DEPLOY_ANDROID=false
are unchanged. Full category/product/large-data/recovery/direct-upgrade/48-scenario/
14-language semantic acceptance and independent human crypto review remain.
