# Bounded reconciliation of protected source histories

20 November2026. Web/native component increment; not complete migration or a
release. Real source coverage stays9/20. The six synthetic project paths below
are test fixtures, not six implemented project adapters. Production3.3.5/149,
update floors0, pilot/cutover off, GENESIS_DEPLOY_ANDROID=false.

## Implemented boundary

`E2eeMigrationSources.stagedReconciliation()` synchronously preflights the full
required per-scope registry and captures every callback before callers may
start source capture, durable-key work or a server lease. The returned runner
is inert. `reconcileStaged()` remains a convenience wrapper with asynchronous
failure semantics. Web/native callers use the same path/domain inventory.

The runner accepts a current original source and every supplied historical
source, each with an exact owner/scope/kind and ordered complete path inventory.
History IDs must be unique; there are at most96 sources including current.
Lease IDs/hash and positive safe integer fence/generation are checked before
any original factory or output sink. This is structural validation, not proof
that a caller supplied every original. Authenticated coordinator catalogue,
history/custody and provenance remain the caller's obligation.

Each path exposes only an original ID, bounded open/read, completion check and
close. One reader can be active per original/path. Every current AND historical
input must reach actual authenticated EOF; an unopened original, early close,
read failure or account change cannot certify completeness. Web owns/wipes its
borrowed copy and captures iterator/verification callbacks before IO. Native
reads into caller buffers with a chunk ceiling and wipes a requested output
range on a failed read; buffers already retained by the caller are its own
responsibility. Repeated native EOF reads are stable; explicit close revokes
that reader's completion capability.

Output is one semantic record/file stream at a time, with no aggregate content
array. Domain/path, placement, size, object identity and duplicate/record limits
are checked before the sink. Local-only records stay local in the protected
content-plan writer. A caught duplicate, concurrent-output error or failed sink
still poisons the path. A producer returning while its sink is pending waits
for settlement but cannot return complete coverage. Late callbacks are revoked.

Cleanup attempts every open original even if another close fails, preserves
the primary failure, and settles an outstanding sink before closing inputs.
Native sink completion is per-emission under a shared gate; one emission cannot
complete another's pending acknowledgement. Cancellation closes originals in a
NonCancellable cleanup section. Successful coverage alone does not publish a
content plan: that separate component still authenticates every output and
checks its source-completion callback before its own inert final marker.

## Checks and evidence

- JS selected scope66/66, no failure/skip, `staged-reconciliation-js-draft-08.log`.
  This includes full protected-source -> reconciler -> encrypted-plan -> cold
  readback composition, complete hashes and preservation of original rows.
- Scoped ESLint PASS, `staged-reconciliation-lint-draft-09.log`; owned TypeScript
  PASS, `staged-reconciliation-types-final-10.log`.
- Full static web build PASS, `staged-reconciliation-web-build-01.log`, including
  public locale documents/gallery, dictionaries and offline precache.
- Real Chromium157/IndexedDB11/11, terminal
  `staged-reconciliation-browser-final-01.json`. Two histories over all six
  synthetic project paths; each first path is2MiB+17, other paths7bytes. Full
  output is4,194,408bytes: five remote records/26 envelopes and one local-only
  record. Cold originals and plan reopen through fresh IndexedDB connections.
  All six hashes match independent bounded Node construction; readback checks
  every output byte, borrowed expiry, unchanged source rows, quota refusal,
  unopened history and retired actor.
- Frozen native input01:
  `481149A2B51B0AA4FBC8D418F7178EE145F89103B5E83373696F032B542537DE`.
  Build SUCCESS11m; selected JVM190/190,0 failure/skip. Actual API26/API34 each
  pass2/2 new composed cases and3/3 content-plan +2/2 original-source regressions.
  Each cold-reads the full4,194,408-byte composed plan; all six complete hashes
  match independent bounded Node construction and all33 original encrypted rows
  survive. New-case elapsed7,212/11,623ms; no peak-heap/SLA claim is made.
  New-case artifact checks verify its extracted proof hash on each platform.
  Both regression runs also independently match all83,886,080bytes in two40MiB
  files and open their fresh JCA plan vectors through WebCrypto. Those are
  existing content-plan format regressions, not a new composed wire format.
- Main APK SHA-256:
  `01E6FAB89762D61E643A638656408950323F8AAB46486F139BEA6982E1A6C6BE`.
  Test APK:
  `C4D39016EC68B3140A9033563DE6780F060835AC3113AFD958C71FACB6E9CC2B`.
  Source hash and both artifacts still match the frozen build after provider
  execution. No new Android lint was run for this increment; the previous full
  lint is original-source, and final-candidate full lint remains required.

Exact new reports: `output/qa/security336-staged-reconciliation-api{26,34}-01/`
and runtime `staged-reconciliation-{native,host,content-plan-host}-*` evidence.
Prior content-plan commit3905118d passed both web/API and Android remote CI
44749102743. This component's own remote CI is separate and not release evidence.

The first red lifecycle suite reproduced three defects in the unaccepted draft:
an async factory's returned raw iterator was not closed after retirement,
cleanup masked a primary failure, and a caught invalid output could still
return coverage. All three were fixed before the above JS/browser acceptance.
`staged-reconciliation-lifecycle-red-02.log` preserves their witnesses.

Browser draft01 passed the positive path but its quota test retained old reader
handles after locking their vault; that fixture returned an unlock refusal.
Draft02 explicitly reopened original source readers after cold restart. Only
the final bundle/report above is acceptance evidence. Native diagnostic compile
draft01 read different intermediate source/test interfaces while editing was
still in progress and failed; it is not a runtime or final input result. The
following native input is frozen before build and must match APK/runtime hashes.

## Remaining integration

No new crypto/writer protocol or content wire format is introduced. Existing
source-stage and content-plan interop vectors keep their own recorded provider
scope; this increment does not claim new cross-provider vector acceptance.
It introduces no HTTP port and does not open v3 `run()` or enable transport.

The explicit complete coordinator state, mixed legacy1/2/staged3 histories,
authenticated read-only handoff/custody, protected REMOTE originals, actual
native/WebView bounded inputs, process-role collectors and nested old cipher
materialization remain unfinished. Do not discard any losing/incomplete plan
as derived data unless complete reproducible originals are demonstrably saved.
See `e2ee-336-streamed-coordinator-integration.md` for those constraints.

All11 remaining real categories, normal product writers/unlock/enrollment/
recovery, shared ACL+atomic rotation, attachments/Drive, signed direct upgrades,
48 system scenarios,14-language semantic acceptance and independent human
cryptographic review remain required before activation and release.
