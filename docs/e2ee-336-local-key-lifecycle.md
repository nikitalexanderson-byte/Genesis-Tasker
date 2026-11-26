# Legacy LocalCipher alias loss: durable creation guard

19 November 2026. This guard increment has passed its final native build and
instrumentation. Full product recovery/lifecycle remains pending. No production
setting or version changes.

The old `decrypt(create=false)` already refused a missing Keystore key. However,
`encrypt(create=true)` could create a new key under the same alias before any read
noticed retained ciphertext. This affects every LocalCipher consumer, including
Room tasks/documents, diary, account-key wrappers, auth, planning/shared drafts,
file drafts and staged imports. Fixing an individual migration reader does not
close that global first-write path.

`LocalCipher` now requires a durable device-only alias witness before returning
new ciphertext. A witnessed alias cannot be regenerated after deletion or
invalidation. An existing valid Keystore alias can be adopted without changing
its material; the witness is recorded before the next encryption. Decrypt remains
read-only and does not manufacture a witness, directory, key or replacement DB.
The witness contains only a protocol marker and SHA-256 of the technical alias,
never a key, user content, recovery authority or authorization grant.

An installation upgraded from a version without witnesses needs a conservative
read-only inventory before first key creation. The default production alias checks
the real `genesis.db` tasks/documents/outbox, all package SharedPreferences XML
and retained backup XML, plus `files/shared-task-file-drafts` and
`noBackup/shared-data-import-v1`, including interrupted drafts/chunks. These are
the non-Room/non-preference LocalCipher write stores found in the current code.
Technical settings and a genuinely empty known-schema DB permit initial creation.
Retained data blocks it. Orphan DB sidecars, corrupt/unknown/busy databases,
invalid XML, unavailable inventories and malformed witnesses refuse safely.

SQLite inventory uses READONLY, no localized collator writes and a non-deleting
corruption handler. Android's default corruption handler can delete a corrupt DB
even during attempted opening; it must not be used by this inventory. Queries
select only table names or `1 LIMIT 1`, never content columns. Preference values
are checked for canonical legacy ciphertext, including split XML text/CDATA.
Files are inspected for presence; no draft/import contents are opened or removed.
Any populated entry in a known private auth/shared journal remains evidence even
if its ciphertext encoding or XML value type is corrupt. Other preference files
also receive a canonical legacy-ciphertext check. An unrecognized private value
must never count as an empty installation.

Keystore load/generation is serialized in process and first writes share a
nonblocking per-alias file lock across processes. An unknown/incomplete witness
does not authorize another key. AtomicFile plus fsync protects the witness before
encryption can return. Source errors never delete/reinitialize legacy storage.

This witness is not a backup of a non-exportable Keystore key and cannot recover
one already lost. It is also not a defense against root/same-UID deletion of both
the witness and all evidence. Existing key/data generations, package and signing
identity remain unchanged. Full product lost-key UX, emergency export, new E2EE
vault lifecycle, archive/direct-upgrade acceptance and independent crypto review
remain mandatory. A malformed witness blocks writes while an available old key
can still decrypt retained content for recovery.

Application startup configures this guard after UpdateGate and before repositories
or workers, then prepares the legacy field key outside any Room transaction. A
missing/corrupt key or inventory is retained as a redacted initialization problem;
it does not crash into a fresh database. This preparation is necessary on devices
using exclusive rollback-journal transactions: a first write cannot inventory its
own DB from a second connection while holding that DB's exclusive writer. It does
not unlock/provision an E2EE vault. The first guard build was intentionally stopped
after JVM/main APK tasks to include this review finding and its dedicated test;
that partial build is not final acceptance. Build02 reached main/test APKs and
actual API26 11/11 plus API34/API35 65/65 selected tests passed; it was then
stopped before final lint acceptance to include the conservative corrupt-private-
preference finding and its additional instrumentation case. Final acceptance
must use the resulting build03, not those earlier partial results.

Actual instrumentation covers fresh creation, encrypt-first alias loss,
old installations with/without ciphertext, Room/prefs/CDATA/backup files/drafts/
imports, non-deleting corrupt/busy DB handling, corrupt witness, concurrent
creation lock, pre-transaction first-key preparation, unknown XML and read-only
missing-key behavior. All fixtures use separate
synthetic roots and aliases, never the app's actual default alias or user data.

Evidence for the preceding 12-case candidate, retained under
`output/release-3.3.6/runtime/`:

- `native-key-lifecycle-api26-02.log`: 12/12 key-lifecycle instrumentation PASS.
- `native-key-lifecycle-api34-02.log` and `native-key-lifecycle-api35-02.log`:
  66/66 selected cases each PASS, including the 12 lifecycle cases and 54 prior
  source/storage/legacy-operation regressions. No negative instrumentation status.
- `native-key-lifecycle-jvm-summary-03.json`: 1167 JVM tests in 212 suites,
  1159 passed, 8 opt-in real-PHP HTTP tests skipped, failures/errors 0.
- `key-lifecycle-full-js-01.log`: 1543/1543 PASS; full project lint after the
  unrelated diary test-variable fix is 0 errors / 4 existing image warnings.
- Main/test APKs are the isolated QA package with metadata 3.3.5/149. Android
  lint for `native-key-lifecycle-build-03.log` completed successfully: build26m9s,
  0 errors, 206 existing warnings, 8 hints. Successful instrumentation was not
  substituted for that required completion.

Final hardening records a durable denial when a pre-witness legacy
inventory finds retained data **or fails**. Later housekeeping or Android's
preference reader must not erase that evidence and thereby permit an automatic
replacement key. Two additional actual instrumentation cases cover both paths.
Their acceptance was collected from build04 (14 lifecycle cases), not inferred
from build03's 12-case result. An inventory-error hold may require an
explicit recovery/support decision; automatic empty reinitialization is forbidden.

Final evidence for the persistent-denial revision:

- `native-key-lifecycle-build-04.log`: main/test QA APK, JVM and `lintDebug`,
  BUILD SUCCESSFUL in 25m2s. Lint: 0 errors, 206 existing warnings, 8 hints.
- `native-key-lifecycle-api26-03.log`: 14/14 lifecycle instrumentation PASS.
- `native-key-lifecycle-api34-03.log` / `native-key-lifecycle-api35-03.log`:
  68/68 each PASS, no negative instrumentation status, including all 14 lifecycle
  cases plus the 54 prior source/storage/legacy-operation regressions.
- `native-key-lifecycle-jvm-summary-04.json`: 1167 tests / 212 suites,
  1159 passed, 8 opt-in real-PHP HTTP tests skipped, failures/errors 0.
- Parsed actual instrumentation cases are retained in
  `native-key-lifecycle-instrumentation-summary-04.json`. All three emulators
  were stopped afterwards; no personal device was used. QA package and metadata
  remain `ru.genesis.calendar.qa1103.debug`, 3.3.5/149.

These focused cases are not the original whole-system 48 acceptance scenarios.
They do not establish clean-device E2EE recovery, all private paths, normal editor
lock/cutover/background routing or the application's general Room corruption UX.
Full product integration and independent crypto review remain activation gates.
