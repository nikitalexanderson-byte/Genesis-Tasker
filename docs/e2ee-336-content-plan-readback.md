# Bounded complete-plan shadow readback

20 November2026. Selected component acceptance PASS; not a released product migration.
Real source coverage remains9/20. Production stays3.3.5/149, floors0,
pilot/cutover off and GENESIS_DEPLOY_ANDROID=false.

## Behavior and trust boundary

`verifyMigrationContentPlanReadback` and native `E2eeContentPlan.verifyReadback`
first authenticate the complete local quarantine plan/reference. They compare
the ENTIRE expected shadow inventory with the streamed peer: every domain/ID
exactly once, no omitted/extra/duplicate objects, exact returned count and every
envelope's context, signature and committed payload hash. The hash deliberately
excludes the signature, so a matching hash never substitutes for signature
verification. Swallowed callback errors remain sticky; concurrent or retained
callbacks cannot manufacture a successful inventory.

Only after full inventory verification do bounded exact gets authenticate the
complete file manifests and every ordered chunk through the existing strict v1
reader. The complete original SHA-256, size, filename and media type must match
the saved plan. Shared comments keep their single-envelope format. No entire
remote ciphertext list or whole plaintext file is collected. Local-only parts
are checked in protected storage and never fetched/uploaded as remote content.
The exact complete local reference is opened again after all remote awaits; a
missing/damaged quarantine record or local-only part prevents a success receipt.
The verifier performs no local writes, content publication or activation.

Native `E2eeFiles.openStreamSuspending` uses the SAME inline private manifest/
ordered-chunk reader as the synchronous streaming and batch readers. Each
fetch/ack is genuinely awaited, with coroutine cancellation and original actor
checks around continuations. Borrowed plaintext is wiped when its sink returns,
throws or is cancelled; private manifest/key-byte buffers are cleaned in the
existing finally. No runBlocking bridge or giant Base64/JSON reconstruction is
introduced. Native's explicit `E2eeBoundedMigrationReadback` capability cannot be
inferred from an aggregate transport's fail-closed default ports.

The coordinator must supply the pinned signed shadow-generation transport and
bind this exact inert plan to authenticated sources/history, lease/source token,
directory checkpoint and local CAS. A successful component receipt contains
only the reference and counts, with no upload, restore, replay or cutover
authority. An empty server page alone still proves no completeness. This change
does not preserve remote-original provenance; that separate quarantine/custody
gate remains required. Original1/2/3 state readers and closed v3 run are unchanged.

## Component evidence

- Selected JS133/133,0 failure/skip:
  `runtime/content-plan-readback-js-final-03.log`. Includes eleven new readback
  scenarios, content-plan/file/manifest/transport/migration/original-source and
  staged-reconciliation regressions.
- Owned TypeScript `content-plan-readback-types-final-04.log` and scoped ESLint
  `content-plan-readback-lint-final-05.log` PASS. Full `build:web`
  `content-plan-readback-web-build-final-02.log` PASS, including the generated
  legacy-worker check, public gallery/documents/locales and offline precache.
- Actual Chromium157/WebCrypto/encrypted IndexedDB15/15, console0:
  `content-plan-readback-browser-final-02.json`. A cold9MiB+7byte file,38 objects,
  original-byte digest independently constructed by bounded Node buffers,
  omission/duplicate/signature/get/malformed-envelope failures,
  swallowed/concurrent/retained callbacks and retirement are checked. Peer ports are synthetic lazy reads
  from the owned fixture; no actual HTTP/backend migration is claimed.
- Native frozen input01:
  `845F51489CB525DF4E604EB5164654045273AECC80A23DA9CC6A9F36BE87D3B7`.
  Build SUCCESS4m22s, JVM203/203 across29 suites,0 failure/skip.
  Actual API26/API34 each pass3/3 new cases plus2/2 bounded transport and2/2
  staged-reconciliation regressions,0 failure/skip. New cases use cold encrypted
  SQLite and JCA, a lazy synthetic peer, the complete9,437,191-byte file and
  3-byte local value, exact inventory/get, rejection paths, suspended ack and
  cancellation/borrowed-buffer wiping. Complete file hashes and every extracted
  proof are independently checked by bounded Node construction. No actual
  HTTP/backend account, product migration or authenticated custody is inferred.
- Regression host checks independently verify4,194,310 bytes for readback,
  4,194,408 bytes/six logical hashes for staged reconciliation, and retention of
  all33 original source rows on each platform. No source coverage is inferred
  from the six synthetic paths. Reports:
  `output/qa/security336-content-plan-readback-api{26,34}-01/results.json`;
  runtime `content-plan-readback-{host,regression}-*`.
- Main APK SHA-256:
  `26F4548583412923C41F079E8985259256C2F33B4E9B86DB96F20725AA08BE63`.
  Test APK:
  `4F75EEBB26E8BBBCB5558991F551672FCA0069B483B35DE4DF042D64B6786BBA`.
  Original source and APK identity checks still match after execution and lint.
- Full Android lint SUCCESS14m6s:0 errors/208 warnings/8 hints, no new issue/file
  pairs versus `original-source-native-lint-01.xml`. Exact XML and comparison:
  `content-plan-readback-native-lint-01.xml` and
  `content-plan-readback-native-lint-verified-01.json`. Final-candidate lint must
  still cover the eventual complete release source, not only this increment.

New-provider fixture elapsed23,602/36,190ms(API26/API34); configured max Java
heaps512/192MiB. These are fixture timings/configurations, not peak-memory,
product capacity or performance guarantees. No new crypto/writer/file format
was introduced.

The missing-export red run, initial TypeScript narrowing diagnostics and a
Kotlin test-fixture compilation failure (`Map.values()` versus the Kotlin
property) are retained separately. Production Kotlin compiled in that diagnostic
build, but it did not reach JVM/provider acceptance. No new public UI text is
introduced. Final-candidate full
Android lint, full product/system acceptance and independent human crypto review
remain mandatory; see `security-336-acceptance-matrix.md`.
