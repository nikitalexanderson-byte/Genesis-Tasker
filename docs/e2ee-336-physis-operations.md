# Physis whole-operation exclusion —19 November2026

The actual web PhysisMemoryStore now holds an owner operation across optimistic
memory, encryption, paged reads/decryption, HTTP, acknowledgement and final
cleanup. This prepares reliable migration capture; it is not that capture or a
complete Physis source adapter. Seven of twenty source categories remain
implemented and production migration is disabled.

## Change and ordering

`physisLegacyAccess()` in `app/cloud-sync.ts` binds a validated current transport
owner and captured session generation. It deliberately does not require the
workspace key: an independent old Physis vault has a different unlock boundary.
The existing owner Web Lock excludes migration before any queue/record mutation.
Every nested Physis request borrows the same live permit through `api()` instead
of requesting another shared lock behind a waiting exclusive migration.

Store save/delete/flush/reload/discard/export/rotation use the bound transport.
Internal reload/flush calls borrow their parent's operation. Concurrent saves
admitted before a barrier may append to the existing queue; both parent operations
wait for its complete drain. An operation arriving after the exclusive request
waits before optimistic mutation, and a preparing/active marker rejects it.
Migration preflight is asynchronous: a save admitted before the exclusive lock
has actually been queued is part of the earlier work and must drain normally.

Submitted records and rotation vault text are copied before awaiting a lock, so
later caller mutation cannot change the submitted intent. The actual staging,
crypto and queue acknowledgement occur only under exclusion. Exact uncertain
ciphertext/request IDs and both rotation keys retain their existing retry rules.
No plaintext storage or new durable Physis queue is introduced.

An owner/session change during HTTP cannot publish a stale error/acknowledgement
or clear the pending queue. Rotation failure handling also rechecks the live
store before changing retained rotation state. Explicit store disposal keeps
its existing semantics; complete migration-aware close/background/product
routing remains a separate requirement.

Explicit transport/session/exclusion injections remain available for isolated
domain peers. The only product constructor call uses the actual owner-bound
factory. No unguarded transport is selected as a product fallback.

## Verification and limits

The pre-existing Physis crypto/account/store suites pass33/33. The real
cloud-sync/store/WebCrypto/gate bindings pass12 new VM checks; with existing
personal-editor and transport checks the focused run is35/35. They cover:

- Encryption plus optimistic memory before HTTP, acknowledgement and final
  captured state; migration cannot begin in between.
- Later operation refusal before memory mutation, and two already admitted
  saves draining their separate intents before capture.
- Reload/export decrypt and rotation's nested reload/encryption/HTTP without
  reentrant-lock deadlock.
- Offline pending preservation, active marker and foreign-owner refusal,
  late sign-out response, independent Physis access while workspace is locked,
  and immutable submission while waiting for a lock.

The VM uses the actual production bindings, replacing the persistent marker IO
and platform LockManager with their isolated fixtures. It does not claim new
Chromium/IndexedDB or complete authenticated Physis UI acceptance. The common
gate's earlier real-browser acceptance is recorded separately in
`e2ee-336-operation-fences.md`; it does not substitute for this feature's final
product journey. No UI strings/assets/layouts changed.

First run01 retained two fixture failures: it scheduled a second save before
migration preflight had queued the exclusive lock, and compared a cross-realm
array without normalizing both sides. Run02 asserts the actual pending exclusive
lock and compares normalized values. Product assertions about source retention,
state mutation, crypto and HTTP were preserved; an additional admitted-save
case covers the opposite ordering. The failed run is not called a product pass.

Evidence under `output/release-3.3.6/runtime/`:
`physis-operation-existing-01.log`, `physis-operation-fence-01.log`,
`physis-operation-fence-02.log`, `physis-operation-typecheck-01.log` and
`physis-operation-lint-02.log`. Full JS1611/1611 passes
(`physis-operation-full-js-01.log`); typecheck/scoped lint and static web build
also pass (`physis-operation-web-build-01.log`). Native reassembly succeeded
in34s with both APKs byte-identical to the already accepted reader build;
identity/comparison are `physis-operation-native-build-identity-01.json` and
`physis-operation-native-artifact-comparison-01.json`. No unchanged native test
suite was repeated; the recorded API26/34/35 passes still apply to those exact
APK hashes. All task-owned emulators remain stopped.

Still required: all mounted/unmounted form drafts and memory/rotation/key capture
under the barrier, four-table reconciliation and tombstones, new-root readback,
Physis bootstrap/unlock/account-vault operations outside this store, protected
editing/close/lock/recovery, full browser acceptance, the remaining13 sources
and whole-system48-scenario/14-language/independent-review gates. No version,
update floor, pilot/cutover, device installation or publication is changed here.
