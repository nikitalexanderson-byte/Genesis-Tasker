# Bounded shadow readback and web E2EE response parsing

20 November2026. Component acceptance; not complete product migration or a
release. Coverage remains9/20, v3 run refuses before transport, production stays
3.3.5/149 with update floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false.

## Implemented behavior

Web/native signed migration transports now expose `forEachEnvelope` and
`getEnvelope`. The new iterator requests ONE envelope per page, snapshots and
validates its owner/scope/domain/object order, awaits the sink, checks the device
again and only then requests the next page. Every managed domain, including
attachment chunks, needs a final empty page with the pinned directory headers.
Loops, foreign scopes, extra response records, checkpoint drift, failed/pending
sinks and device retirement cannot return a complete iteration count. The8000
object bound remains. Direct get binds exact domain/ID, rejects disallowed IDs/
domains before IO, accepts at most one result, and returns null for a missing ID.

Those checks do not prove that an untrusted server omitted no objects. Pinned
headers and an empty response are not a cryptographic completeness witness.
The caller must compare the ENTIRE expected plan inventory/hashes, authenticate
each exact expected context/signature/AEAD and verify complete original digests
before accepting readback. The callbacks receive structurally checked encrypted
envelopes; they are not an API for already authenticated plaintext.

Existing signed server `read`/`get` actions are reused. No new server route,
permission, crypto/writer protocol or wire format is introduced. The old
aggregate `readAll()` retains its50-record request shape and256MiB aggregate
guard for existing callers. Streamed coordinator code must require the new
ports; native defaults explicitly refuse rather than emulate them with readAll.
The old coordinator has NOT yet been switched to these ports.

The web authenticated E2EE channel now reads bounded UTF8 bytes before parsing
JSON instead of unconditional response.json(). Route budgets match native:
directory32MiB, read16MiB, other known E2EE routes256KiB; errors have an8KiB
budget. Declared/actual oversized success bodies, invalid UTF8, zero progress,
invalid JSON roots/content types and account retirement refuse success. The
reader cancels incomplete streams and releases their locks; consumed wire
buffers are wiped. UTF8 split sequences and a leading BOM retain normal JSON
semantics. Small JSON API errors keep their existing E2EE error code; bounded
HTML/non-JSON HTTP errors still enter the existing non-success handler. Runtime
route/method checks match native GET status versus POST command/read/etc.

The existing cookie/CSRF/session-generation/timeout/cancellation machinery is
used. Tests exercise the REAL cloud-sync API path in an isolated fixture and
an account transition while a response body is pending; old durable data remains.
Other web API parsing is unchanged. Immutable strings/parsed values remain in
caller/GC ownership; wiping wire buffers is not whole-memory/string zeroization.
This parser does not save remote original provenance for migration. That
separate authenticated quarantine/custody requirement remains mandatory.

## Accepted evidence

- Selected JS110/110,0 failure/skip, `readback-http-js-final-06.log`: new response
  and signed iterator/get cases, actual cloud-sync channel/account transitions,
  legacy transport/fences, existing migration and staged reconciliation.
- Owned TypeScript `readback-http-types-final-07.log` and scoped ESLint
  `readback-http-lint-final-07.log` PASS. Full static web build
  `readback-http-web-build-final-03.log` PASS, including public documents/gallery,
  dictionaries and offline precache. No new product UI text was added.
- Actual Chromium157/WebCrypto/IndexedDB17/17,
  `readback-http-browser-final-03.json`. A provisioned synthetic device fixture,
  full4MiB+6byte envelope readback/independent Node hashes, exact get, pinned
  headers, backpressure, retirement and malformed responses are checked. Real
  owned-loopback HTTP also exercises valid UTF8, declared/actual oversize,
  malformed UTF8 and HTML503 handling. A non-byte stream chunk retains the
  sanitized protocol error through cleanup. The one console error is the intentional
  owned `/http/error`503 response; its diagnostic is saved separately. The
  signed inventory request/response port is synthetic, not the actual backend.
- Frozen native input03:
  `8026B1BAF9512B21956B66A14A05EDD3A6E678C830434E43FF7D4B520F694D41`.
  Build SUCCESS31s, JVM195/195,0 failure/skip. Actual API26/API34 each pass2/2
  new provider cases plus2/2 staged-reconciliation regressions. Each provider
  authenticates every byte of a maximum4MiB envelope plus two3-byte records;
  full hashes independently match bounded Node construction. One-envelope
  requests, final empty pages, exact get, denied pre-IO domains, callback failure,
  retirement, loops, oversized replies and pinned-header changes are checked.
  These native ports are synthetic signed callback fixtures, not real HTTP or
  backend/account enrollment. No peak heap/capacity/performance claim is made.
- Main APK SHA-256:
  `33387AC536FA46514AB6BB5F7FFFBE10709BCE5EB86805FE6C6EA3A5D59258AF`.
  Test APK:
  `8CA2227EC0F5E531DE06530BA9C75B6C0D298DF1ADD9FBEC01205D4A81EB9FAF`.
  Frozen source and APK identities still match after provider execution. New
  full Android lint was not run; final-candidate full lint remains required.

Actual provider reports:
`output/qa/security336-readback-stream-api{26,34}-03/results.json`; runtime
`readback-stream-{native,host}-*` and `readback-http-*` contain exact artifacts.

Diagnostic native input01 did not reach acceptance: test fixture expression
bodies returned a scope where Unit was required. Both test fixtures were fixed
before input02 was frozen. An initial local109-case JS run passed108 and could
not run the PHP packaging case because an old temp PHP directory had no binary.
A fresh official PHP8.4.27 archive was verified against the repository-pinned
SHA256, extracted only into a fresh owned temp directory and validated with all
required extensions. The complete selected109 cases then passed. No existing
runtime directory was overwritten. Missing-module red tests and the initial
QA-only TypeScript diagnostics remain separately recorded, not passing evidence.

Input02 and its passing provider reports were superseded by the cleanup repair:
`readback-http-cleanup-red-05.log` reproduced a TypeError masking the intended
protocol error on a non-byte stream chunk. Cleanup now wipes only Uint8Array
chunks. The final110-case suite,17 browser checks and native input03 above cover
that exact source; earlier artifacts remain diagnostic evidence.

## Remaining release boundary

Explicit composed coordinator state/plan publication, mixed old histories and
read-only key custody, protected remote originals, real bounded native/WebView
inputs, product writers/unlock/enrollment/recovery,11 remaining real categories,
shared ACL+atomic rotation, attachments/Drive, signed direct upgrades,48 system
scenarios,14-language semantic acceptance and independent human crypto review
remain mandatory. See `e2ee-336-streamed-coordinator-integration.md` and
`security-336-acceptance-matrix.md`. No activation follows from this component.
