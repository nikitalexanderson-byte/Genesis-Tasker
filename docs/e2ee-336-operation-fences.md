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

## Actual connected features

The actual web `DiaryRepository` now uses this boundary for notes, saved advice,
dream records, drafts, deletions, sync settings, local-only reuploads, dream
preferences and draft cleanup. Nested list/save/upload routines pass the same
operation-bound access explicitly. There is no mutable global borrowed permit.
Construction reads persisted settings without rewriting source bytes.

Discard operations are asynchronous and serialized. The real provider/editors
await them before removing UI state or closing; errors retain the editor/draft.
The synthetic dream preview implements its explicit local fixture access; the
production code has no optional/fail-open operation wrapper.

The web `MindmapRepository` now covers personal maps and the member-owned local
ciphertext of shared maps: drafts, immutable request receipts, views, conversion
journals, list/history reads, retries and deletion cleanup. Immediate encryption
of the newest draft remains independent of a slow earlier upload. Staging and
upload are separate completed operations, so a migration between them captures
the durable draft and denies the later legacy upload. No operation holds a permit
while waiting for the repository's other queue. View/delete ordering and nested
HTTP therefore cannot deadlock a waiting exclusive migration. Shared map HTTP
also sends the captured account ID for the existing PHP owner mismatch boundary.

The shared map wrapper protects its member's personal migration inventory. It
does **not** implement a project/space migration fence, signed shared ACL or shared
root rotation; legacy shared network documents remain server-readable.

The actual `RestorationRepository` (independent Stoicheion practice archive) and
`AuroraRepository` serialize load, save and conflict recovery before acquiring
their operation. Nested merge/retry/recover routines receive the same bound access
instead of waiting on their own queue. Validation after asynchronous crypto
precedes all local commits. Successful receipts must report exactly the next safe
integer revision. Malformed receipts retain the journal; acknowledgment cleanup
compares the exact encrypted attempt before removing it, preserving a different
pending envelope written by another tab. Aurora protection failures cannot be
presented as an ordinary successful offline save.

## Native Aurora capability

The shared Aurora runtime requires an operation runner on every platform. Its
native access factory binds each RPC and synchronous Room storage closure to an
explicit, live operation token. Unbound repository storage fails closed. Native
keeps the actual opaque permit in the specific bridge instance; a token is neither
a vault key nor account/device approval.

`NativeLegacyOperationPermit` acquires the same database/scope mutex used by the
Room fence and HTTP guard. Coroutine context propagation lets actual HTTP borrow
the exact bound capability across dispatcher changes, avoiding a second mutex
acquisition. Foreign database/scope use, expired permits and IO from Room
transactions fail before a connection. Key-cache initialization takes the owner
permit before its key mutex, preserving that lock order for non-editor calls too.

Finishing or closing a view invalidates first, drains all admitted native work,
then releases exclusion. An unawaited native child causes an error while the
mutex remains held until it drains. The caller chooses the cleanup ID before
begin, so an unknown/lost begin outcome can still be ended. End-before-begin
tombstones prevent a delayed acquisition from orphaning a mutex. Cleanup remains
available after account expiry; cancelled begin jobs close their admitted permit.
The real gateway also captures session generation, including same-owner re-login.

These are local lifecycle/transport capabilities for the existing legacy formats,
not new cryptographic algorithms or proof of a complete native migration.

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

### Extended editor increment evidence

Also under `output/release-3.3.6/runtime/`:

- `frontend-editors-full-02.log`:1420/1420 JS cases PASS, no skips. Includes
 19 new adversarial real-repository cases and4 native-access protocol cases.
 `editor-operation-adversarial-04.log` covers71 feature cases before the final
 shared account header assertion; `editor-owner-header-02.log` passes all19
 after that assertion/factory binding correction.
- `browser-editors-operation-final.log`:28/28 real Chromium checks across two
 tabs and actual Web Locks/IndexedDB. Actual personal/shared mindmap, Aurora and
 restoration repositories journal before HTTP, finish borrowed IO/cleanup before
 capture, then deny the next save with zero additional server writes and exact
 previous bytes retained. The server is loopback-only with synthetic identities;
 this is repository integration, not a rendered-product UI audit.
- `native-editor-build-05.log`: QA APK/test APK build and all206 JVM suites PASS:
 1131 cases,1123 passed,8 opt-in HTTP integration skips,0 failures/errors.
 `native-editor-test-build-06.log` packages the final UI-test diagnostics.
 Native metadata remains QA3.3.5/149, separate package/certificate and localhost
 origin; this is not the final3.3.6 release or its versionCode.
- `native-editor-api26-final.log`:12/12 actual instrumentation cases PASS.
 Includes permit borrowing ahead of migration, foreign/expired/abandoned permits,
 IO/Room inversion, actual HTTP-client denial, lost begin/end ordering, closed
 view draining, account expiry cleanup and the old-provider UI boundary.
- The last case renders84 combinations:3 embedded screens ×14 languages ×2
 schemes at font1.3. No WebView or gateway IO starts and the exact pre-existing
 Room record remains.84 screenshots are retained in `web-runtime-screens/`;
 English/light backup and Russian/dark Aurora were visually inspected. This
 confirms the new message bodies, not every pre-existing screen's translations.
- `web-editors-build-final.log`, `editor-typecheck-final.log`,
 `editor-lint-final.log`, `editor-i18n-final.log`: web build/packaging, typecheck,
 changed JS/TS lint and existing14-language/native catalogue audits PASS.

Failed/intermediate evidence is retained:

- Native build01 hit stale incremental top-level symbol resolution; a full
 compile then exceeded the default2GiB Kotlin heap in build02. Build05 uses the
 repository's existing QA approach:6GiB in-process compiler, one worker. Neither
 failed build is counted as acceptance.
- The first browser editor driver used promise-returning polling that did not
 await the actual server condition. Bounded awaited browser-side polls fixed the
 driver; final28 checks pass with the real pending HTTP response.
- The first native UI runs targeted the old entry selectors; the API26 image
 additionally had Chromium69, which cannot parse the bundle. The common runtime
 boundary now handles that condition explicitly; see `native-web-runtime-336.md`.
- **Modern-provider product UI acceptance is still incomplete.** On the isolated
 API35/Chromium124 image, the retained empty archive did not converge to the
 existing no-unused-height assertion. That assertion has not been weakened or
 removed. The later save/offline scenario was interrupted twice by Windows
 `qemu-system-x86_64-headless.exe` access violations (`0xc0000005`), recorded in
 `host-qemu-failures.json`. `native-aurora-api35-pre-gate.log` and
 `native-aurora-api35-ui-03.log` are failures/incomplete runs, not PASS. Software
 acceleration did not yield a usable online device. The layout failure still
 needs measurement/fix, and save/reopen needs a complete stable-device run.

Only task-owned API26/API35 AVDs and synthetic QA package/data were used. No
personal device, production account, deployment, Play upload or DNS change was
performed. Browser and loopback server were closed; no task emulator remains
running after the API26 shutdown and API35 host failures.

## Remaining scope

This connects the repositories listed above, not all 20 migration paths. Native
mindmaps/diary/other non-Room sources still need their own whole-operation wiring.
Aurora's separate result/payment/task bridges remain separate data paths. The
remaining personal/shared editors, unmounted journals, direct local
storage cleanup, external calls and native non-Room preferences still require
their own bindings. Old uncontrolled pages cannot be claimed to obey new local
writer code. Denying legacy writes is not a replacement for routing migration-time
edits to the new protected edit queue. Diary source reconciliation/output adapters
and product bootstrap/unlock/recovery routing remain required.

The single-slot Aurora/restoration limit of the earlier increment is superseded
by the append-only writer journals below. Complete migration reconciliation and
the remaining product lifecycle/source adapters are still required.

All coverage, files, shared ACL/rotations, archives/Drive, direct upgrades, restore
drills, the 48 acceptance scenarios and independent crypto review remain release
conditions. No production migration, deletion/retirement or global E2EE claim is
authorized by these tests.

## Append-only editor journals and portable copies

The actual Aurora and independent restoration repositories now use
`encrypted-pending-journal.ts`. Every repository instance has a random writer ID;
each save stages a new immutable ciphertext snapshot before HTTP. A writer's
newest full-document snapshot is its intentional successor, while every earlier
unresolved request remains stored. Different writers and the old single-slot
`pending` key form separate branches. Reload enumerates them even after all
original editors close; independent branches merge and conflicting branches stay
available for an explicit choice. No mutable shared journal index is required.

Acknowledgment names the exact raw entries captured before that successful
latest write. It cannot remove a changed entry, a later save or another writer.
Automatic reconciliation/recovery uses a fresh internal writer so it cannot
accidentally supersede this still-open editor's unprocessed branch. A 1024-entry
limit blocks additional staging without pruning retained work. Storage errors
prevent unjournaled HTTP. Invalid/lower receipts do not roll the current
repository back to an earlier acknowledged revision. Existing legacy cache
slots and uncontrolled old writers remain separate lifecycle concerns; this is
not a claim that all browser storage now uses the E2EE vault.

The native bridge exposes only owner-bound enumerated Aurora keys under the
same operation capability. Native key loading also checks permanent store
closure: a cold HTTP response cannot repopulate a closed editor's memory key or
reopen the store. Temporary key bytes are wiped on failed publication/cache IO.

Web and native device-backup materializers include **every** pending snapshot,
its portable decrypted document/base and its exact source identity inside the
encrypted archive, including older requests of a writer. Account keys are not
part of the Aurora backup section. The restore planner recomputes branch heads
and rejects different writers' differing documents with the existing explicit
choice requirement; it does not trust an arbitrary `document` property. A
conflicting backup is still exportable and all copies remain preserved. A UI
for choosing among these portable branches is still required for full archive
recovery acceptance; no first/last-writer choice is silently applied.

Evidence in `output/release-3.3.6/runtime/`:

- `frontend-journal-full-final.log`:1431/1431 JS PASS,0 skipped. New cases cover
  closed offline tabs, same-writer immutable history, conflicts/copy recovery,
  a still-open editor's unprocessed branch, full-journal refusal and portable
  backup preservation/restore choice. `journal-open-editor-reconcile.log` and
  `journal-backup-adversarial-01.log` retain focused evidence.
- `browser-journal-01.log`:14/14 real two-tab Chromium checks PASS, actual
  repositories/WebCrypto/Storage/Web Locks with loopback synthetic HTTP.
  `browser-editor-journal-regression.log`:28/28 previous editor fence checks PASS.
- `native-journal-build-01.log`:QA APK/test APK and JVM build PASS;1131 cases,
  1123 PASS,8 explicit integration skips,0 failures/errors across206 suites.
  `native-journal-assets-final.log` repackages the final shared JS assets.
- `native-journal-api35-bridge.log`:6/6 actual Room/bridge/lifecycle/portable
  backup instrumentation PASS. No release package, personal device or cloud
  account is used. QA metadata remains3.3.5/149.
- `native-journal-api26-bridge-final.log`:the same6/6 bridge/lifecycle/portable
  backup cases also PASS on the task-owned API26 image with the final QA APK.
- `editor-journal-typecheck-final.log`, `editor-journal-lint-01.log`,
  `editor-journal-browser-lint.log`, `web-journal-build-final.log`:typecheck,
  changed-code lint, web/locale/precache packaging PASS. No authored copy or
  catalogue text changed in this increment.

The measured archive height now controls the native WebView height, capped by
the available viewport. Gno explicitly retains its full-height viewport rather
than feeding its current measured height back into itself. The API35 light,
font1.3 empty/expanded assertion passed unchanged. That run's later offline UI
case was interrupted by another host QEMU access violation; the failed event is
saved in `host-qemu-journal-failure.json`. A task-owned API34/Chromium113 image
boots stably and reached a real next-step UI timeout, retained in
`native-journal-api34-offline-light.log`. Neither the host crash nor that timeout
is counted as a passing full UI scenario. Further evidence follows after repair.

Final modern-provider acceptance supersedes that open UI item. The initial
API34 next-step timeout came from input dispatched before the target was enabled;
the driver now waits for its actual enabled/non-inert state, retains real
UiDevice touches and all original progress/offline/viewport assertions. The next
stable run exposed a product bug: immediately closing Gno after leaving the
archive saved its old pre-archive document during reload. A memoized legacy host
now installs accepted child saves into the parent's current document before
returning; immutable/deletion checks and durable queues remain enforced.

`native-journal-api34-ui-light-final.log`:3/3 actual UI cases PASS, font1.3.
`native-journal-api34-dark-final.log`:9/9 UI + bridge cases PASS, font1.3.
The isolated API34 image uses Chromium113. Tests cover empty content sizing,
bounded active content/footer, original draw, two real taps, save, return/close
and offline reopen, plus actual Room/capability/portable backup checks. They do
not assert that Chromium113 is a currently patched provider. Ten complete-window
screenshots are in `aurora-journal-screens/`; the original oversized window is
`aurora-before-height.png`. Its interrupted JSON is empty, not a measurement.
`aurora-after-height.json` reports400×190 CSS pixels with an exactly190px empty
document. Light empty and dark offline-restored screenshots were inspected.
Every OEM/tablet/14-language combination remains untested; this repair changes
no authored copy, palette or catalogue. `native-journal-close-assets.log` packages
the final shared UI; `journal-close-lint-final.log` and
`journal-close-typecheck-final.log` PASS. Final post-repair checks are
`frontend-journal-close-full-final.log`1431/1431 PASS and
`web-journal-close-build-final.log` PASS. Earlier failed logs are retained.

Latest owner authorization permits the complete3.3.6 web/API and signed website
APK deployment **after** full acceptance. It does not turn these intermediate
checks into full E2EE acceptance or waive independent cryptographic review.

## Native task sync and controller ordering

19 November. CloudTaskSync now acquires an opaque owner permit before decrypt,
holds it across provider response and revision/operation-matched acknowledgement,
and checks the same account generation/transition epoch before accepting a late
response. The production account sync acquires the owner permit before its
dataSyncMutex; nested task/HTTP calls borrow it. Migration capture therefore
drains already-running response/ack work before installing its persistent fence.
Persistent deny is checked before old key access. Denial is not network fallback
or a successful sync. Actual API34/35 cases preserve pending ciphertext after a
late owner change, deny before decryption and prove response/ack drain. The new
task source separately preserves exact queue content under a new root; see
`e2ee-336-tasks-client-source.md`. Other native feature writer/lifecycle paths
still need complete product integration; this is not a blanket coverage claim.
