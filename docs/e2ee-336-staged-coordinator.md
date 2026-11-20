# Staged coordinator source publication — accepted local increment

20 November2026. This is the local source-publication portion of the streaming
plan, following accepted reader commitd69787b1. It is not the complete streamed
planner/common reader or a new accepted product source category. Coverage9/20,
production3.3.5/149, floors0/pilot/cutover off and GENESIS_DEPLOY_ANDROID=false
remain. There is no Deploy/Play/personal-device/version change in this increment.

`E2eeMigration.prepareStaged` publishes explicit local state version3. Its
`source-stage-v1` discriminant contains the original target, original vault actor,
ordered required registry paths, current complete stage reference and every
known earlier complete stage. There are no fake zero-length legacy snapshot
fields. Strict original state1/2 readers remain; mixed cancelled ancestors retain
their exact source formats. Native status distinguishes the staged source.
Crypto/writer protocol, schema and mandatory-update policy are unchanged.

The registry checks every personal/project/space path before keys or producers.
Stream-only adapters are registered separately. Bounded compatibility requires
an explicit per-path limit no greater than the old format bound; only one small
path is copied/chunked at a time. A stream-only registration cannot fall back to
an empty legacy capture. Callback/binding/policy values are captured before
awaits. Native local producers may suspend between bounded writes under the
same source actor and single-path gate as synchronous producers.

Independent durable-key confirmation precedes capture. Every current and prior
stage is authenticated through actual path EOF before publication. Unknown
remnants refuse; incomplete journals explicitly require reconciliation and
cannot disappear from a successful preparation. Complete stages orphaned by
quota, a crash or a losing pointer CAS remain original history in the next
attempt. Snapshot verification gives no transport or restore authority.

The coordinator pointer, exact cancelled ancestor and a compare/re-seal of the
authenticated complete stage catalogue commit in ONE existing vault transaction.
This catalogue compare also spans metadata admission and JS crypto awaits: a
concurrent create/finish cannot slip a source attempt past the published history.
The catalogue body keeps its format and stage identities; only its local record
serial advances. Guard metadata is included in publication admission and wiped.
Fault cases explicitly append another incomplete stage during publication
admission and require the pointer transaction to refuse without deleting either
stage. Actual filesystem/provider admission still belongs to the storage owner;
one large fixture proves neither unlimited space nor all-account capacity.

**Version3 run deliberately refuses `E2EE_STREAMED_PLANNER_REQUIRED` before any
transport or durable-key callback.** This preparatory API is not connected to
product activation. Fake leases/planned flags are invalid local state; legacy
prepare/restart cannot reinterpret a cancelled v3 source. A separately named
staged restart preserves the exact ancestors and stage history. The remaining
streamed content planner/common-reader integration must replace this gate before
v3 can run. Old1/2 coordinators keep their existing bounded planner.

## Exact local acceptance, not product release

- JS draft05 passes88 selected coordinator/source-stage/file/preflight cases;
  scoped lint draft04 and owned types draft05 pass. Draft03 exposed a test helper
  whose own captured path list was mutated by its fault callback; draft04 fixes
  the helper to retain its original accepted list. The production callback/value
  snapshot checks are not weakened.
- Actual Chromium157/IndexedDB drafts01/02 each22/22 before the catalogue-CAS
  increment. Draft02 additionally checks every non-primary byte and key cleanup.
  The final catalogue-race bundle03 passes25/25, including the same-transaction
  IDB race refusal. Structured evidence: migration-stage-browser-report-03.json.
- Native input01 failed compilation because guard callbacks inferred Scope
  rather than Unit. Input02 corrected those annotations but was deliberately
  cancelled before acceptance to add the atomic catalogue publication guard.
  Neither is successful native evidence. Input03 is currently building:
  `20692275A82E6641B8E231BEF1C0D96156DBCFD17895A73B79048C3C69A6A7CB`.
  Build SUCCESS18m52s; selected JVM163/163 pass. Lint0 errors/208 warnings/8
  hints, no new issue/file pairs versus the accepted reader input02.
  The full tested count is not a product48-scenario completion.
- Actual API26/API34 each pass5/5 coordinator-source cases and4/4 existing
  retained-source regression cases,0 failures/skips. The generated70MiB+7byte
  primary path and all6 synthetic project paths cold-read correctly; independent
  bounded host digest matches all73,400,327 primary bytes. Coordinator elapsed
  41,231/70,099ms(API26/API34), Java max heaps512/192MiB. The regression's complete
  71,305,891-byte source wire,51MiB original file history,4 raw values and2
  manifests independently match too(elapsed122,399/101,452ms).
  Each platform's3 extracted artifacts match hashes; fresh JCA vectors open in
  Node WebCrypto with both original paths/63bytes. Peak heap/SLA are not measured.
- Assembled main APK03:
  `78305B903FE7ABE65E4A7323F4E29ED099C66321F6A8A4FE8FA8EF2231D729A0`.
  Test APK03:
  `A13FEEECFEECCE5286AB596A56A5981E2C7CF0DB1C67AD7F69EAC29A7C4DF578`.
  These assembled APKs match the final build identity; frozen native input
  remained unchanged through actual runtime acceptance. Reports and failed/
  cancelled draft evidence use `migration-stage-*` under
  `output/release-3.3.6/runtime/`; native reports:
  `output/qa/security336-staged-coordinator-api{26,34}-03/results.json`.

These are synthetic source-registry tests. Six registered project producers do
not implement six real project adapters. Cold tests reopen the same original
device identity; native custody uses a separate no-auth synthetic LocalCipher
bundle. Clean enrolled-device read-only recovery, incomplete-prefix recovery,
every process directory and nested old cipher, all20 real sources, normal
writers, shared ACL/rotation, files/Drive, direct upgrades,48 product scenarios,
14-language semantic acceptance and independent human crypto review remain gates.
