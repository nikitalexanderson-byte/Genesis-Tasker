# Whole-operation legacy writer exclusion

This increment prepares the inactive 3.3.6 migration. It does not activate E2EE,
change update floors, replace legacy account keys, or migrate a real account.

## Identity binding

Only a fully validated `/session` response establishes the live transport owner.
Coalesced observers share its post-transition generation receipt. A changed/null
identity retires memory capabilities, aborts requests and emits the existing
session-ended event without deleting durable keys, data or queues. This also
happens when saving a valid new login receipt fails because storage is full.

A malformed session cannot publish a different owner. Other endpoints cannot
silently establish one by returning `user`; a mismatched private or ordinary
response retires old editors. Cache restore, workspace merge, task writers and
observers check owner/generation. A cached owner key can still encrypt offline
work for that owner, but it cannot authorize private HTTP.

## Operation permits

`WebLegacyTransportGate.withOperation()` holds the existing owner shared Web Lock
through encryption, local journaling, IO, response processing and final cleanup.
The migration's exclusive lock cannot snapshot the middle of that operation.

An opaque, frozen permit is registered in a gate-private WeakMap. Borrowed IO
checks the exact gate, owner, live operation and session. It does not acquire a
second shared lock: that request would queue behind a waiting exclusive migration
and deadlock its own parent. The normal transport classification and owner header
are retained. New/forged/foreign/expired permits cannot open a connection.

Borrowed children are tracked. If a callback returns without awaiting a child,
the parent rejects, invalidates the permit and drains the in-flight work before
releasing its lock. A late response cannot commit through the invalid permit.
This boundary neither approves devices nor grants access to source contents.

## Actual connected feature

The actual web `DiaryRepository` now uses this boundary for notes, saved advice,
dream records, drafts, deletions, sync settings, local-only reuploads, dream
preferences and draft cleanup. Nested list/save/upload routines pass the same
operation-bound access explicitly. There is no mutable global borrowed permit.
Construction reads persisted settings without rewriting source bytes.

Discard operations are asynchronous and serialized. The real provider/editors
await them before removing UI state or closing; errors retain the editor/draft.
The synthetic dream preview implements its explicit local fixture access; the
production code has no optional/fail-open operation wrapper.

## Evidence

Under `output/release-3.3.6/runtime/`:

- `identity-binding-02.log` and final `frontend-operations-08.log`: owner changes,
  malformed/coalesced sessions, old HTTP responses, cached-only owner, private
  mismatch and storage exhaustion; all final JS tests 1397/1397 PASS.
- `diary-operation-02.log`: 36 focused cases before the last private-response
  regression was added; final full suite includes it. Actual diary encryption,
  offline/reload/failed receipt/CAS/delete/sync behavior retained. Tests reproduce
  migration queued during encryption and prove local acknowledgment cleanup
  precedes capture; every fenced diary operation preserves the prior bytes.
- `browser-whole-operation-01.log`: 25 real Chromium/Web Locks/IndexedDB checks,
  including two-tab exclusive waiting, borrowed IO, final local commit and zero
  sockets from expired permits. All PASS through Playwright CLI.
- `diary-browser-operation-01.log`: 5 actual rendered editor/API checks on an
  isolated synthetic premium account: close/reopen draft, save/reload, ciphertext
  only in private HTTP and durable sources, asynchronous empty-editor cleanup.
  Disabled assistant/Physis fixture requests returned the expected 403.
- `web-operations-build-04.log`: build:web and packaging verifiers PASS.
- `typecheck-operations-02.log`, `lint-operations-01.log`,
  `lint-operations-02.log`: typecheck and changed-source ESLint PASS.

The common worker bundle still exactly matches its source/policy; the new permit
class is not needed by the worker's own global transport guard.

## Remaining scope

This connects one web feature's local writer lifecycle, not all 20 migration
paths. The remaining personal/shared editors, unmounted journals, direct local
storage cleanup, external calls and native non-Room preferences still require
their own bindings. Old uncontrolled pages cannot be claimed to obey new local
writer code. Denying legacy writes is not a replacement for routing migration-time
edits to the new protected edit queue. Diary source reconciliation/output adapters
and product bootstrap/unlock/recovery routing remain required.

All coverage, files, shared ACL/rotations, archives/Drive, direct upgrades, restore
drills, the 48 acceptance scenarios and independent crypto review remain release
conditions. No production migration, deletion/retirement or global E2EE claim is
authorized by these tests.
