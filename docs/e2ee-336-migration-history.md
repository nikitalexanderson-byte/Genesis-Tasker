# Same-original-actor streamed coordinator history

20 November2026. Read-only component accepted in the exact scope below. This is
not a release receipt. Production3.3.5/149, source coverage9/20, floors0/pilot/cutover
off and GENESIS_DEPLOY_ANDROID=false remain unchanged.

`E2eeMigration.withStagedSourceHistory` now owns the actual local coordinator
fence while resolving original registry inputs. It returns a callback result
only after every current/history path reaches authenticated actual EOF and the
source catalogue and original raw state metadata remain unchanged. There is no
transport, lease, source mutation, content-plan publication or activation here.
The existing strict v3 `run()` continues to refuse before network work.

The root must be a valid preparing v3 state for the exact target scope. Cancelled
v1/v2 ancestors retain their ORIGINAL migrationId/size/parts/raw SHA-256 and use
the bounded old JSON/Base64 wrapper reader; a v3 ancestor retains source-stage
references. Every archive ID must match its decoded migration ID and exact
ancestor prefix, with an immutable serial1. Unknown locator roles must refuse
before their corresponding bodies are opened. Original bytes are never
re-serialized to invent their original digest.

Separate `migrationId:cancel:nonce` copies are included as original metadata.
Their locators are all classified before any corresponding body is opened;
every cancelled ancestor requires a retained copy. Each immutable copy passes
raw duplicate/UTF8 validation and must retain the exact original source binding
and ancestor prefix. Its phase may precede cancellation. The final locator set,
each original raw metadata hash and serial are checked again after consumption;
a new/missing/changed copy cannot turn into a successful source receipt.

Every complete source stage in the current authenticated catalogue, including a
complete stage orphaned at coordinator CAS, must be present in the root source
history. Older staged histories must be consistent prefixes. Incomplete stages,
extra/missing parts, changed references, aliasing, gaps or duplicate metadata are
explicit refusals. An unknown legacy source prefix cannot be omitted simply
because it is absent from the root's ancestor list.

Source-only input cannot safely discard a retained plan: it may be the only
remaining protected copy of a later server response. Planned ancestors, their
orphan outbox/private output and any uncomposed content-plan journal therefore
require explicit plan/original review. Network-touched ancestors/copies with a
source token, lease, pending packet or renewal also require that review. A complete/cancelled marker is not proof
that those records are disposable. Full durable remote-original quarantine,
reproducible prior plans and state4 publication remain separate work.

A consumer cannot currently append a new content-plan journal through this
read-only scope: its appearance also triggers review. State4 composition must
bind the exact owned attempt, protected originals and publication guards before
admitting that output. An unverified exception/ignore-list is not a safe bridge.

The implementation currently supports the SAME original unlocked actor only.
It does not use Google authentication to establish old key custody, reopen an
old private signing identity on a new device or grant new-device recovery.
The separate roots/PUBLIC-signer original readers have their own evidence and
still need authenticated handoff and metadata/history composition. Unresolved
legacy/content-plan records from another scope also refuse; a future product
locator must authenticate their owner/target/role before classification. An
arbitrary ignore-list would hide original data and is not supported.

Read admission counts retained original source payload bytes/parts and original
coordinator/archive/cancel metadata before payload scanning. Stage sizes/parts come from authenticated
manifests; old wrappers use their original physical size/part count. Metadata is
bounded to4MiB per record and a caller-supplied aggregate maximum up to128MiB;
the provider's10000-record limit and configured aggregate byte/part limits still
apply. Source-stage catalogue/journal metadata retain their separate primitive
bounds; `metadataBytes` here is the coordinator metadata total, not a provider-
wide storage inventory or reservation for a future content plan. Actual writes
still need complete provider/free-space admission. Exceeding a limit preserves every stored original and explicitly refuses.
This is not a claim that arbitrarily large accounts are accepted.

One active path is allowed across the whole handle. The handle captures all
callbacks, limits, target and paths before IO, tracks EOF/failure, refuses
concurrent readers and invalidates escaped factories on close. Web owns/wipes
borrowed chunk copies and drains pending reads on cleanup. Native caps each read
at256KiB, closes owned original streams and wipes the requested output range on
failure; previously returned caller-owned native buffers remain the caller's
responsibility. No whole-heap/key-object erasure is claimed.

The shared path inventory now lives in dependency-free `private-paths.ts` and is
re-exported from the existing source registry. This removes the newly exposed
coordinator/source import cycle without changing the20 path definitions or
their required domains. Existing narrow `listLocal` prefixes stay nonempty;
dedicated technical original-role discovery validates every key frame and the
original actor namespace before filtering. It opens no corresponding bodies.

## Acceptance status

Evidence is retained under `output/release-3.3.6/runtime/`. Final full JS1951/1951,
0 failure/skip, `migration-history-full-js-02.log`; owned types03 and scoped
lint02 PASS. The cancelled-copy red witness01 failed with a missing expected
rejection; it is fixed in the final source, including binding/missing-copy/role
and duplicate metadata refusals. Initial99-case/1950-case runs preceded this
repair and are not its acceptance.

Final Chromium157/WebCrypto/cold IndexedDB16/16, console0:
`migration-history-browser-final-01.{json,log}` and console01. All4,194,392
logical bytes/24 hashes of four original sources match independent bounded Node
construction, rechecked by the host from the extracted report. A validly sealed
but rebound immutable cancellation copy refuses before the consumer. The owned
tamper fixture is restored to the exact original encrypted row and the entire
stored inventory remains identical. This is six SYNTHETIC project paths per
source, not real project/category coverage or authenticated cross-device recovery.

Full `build:web` final04 PASS:98 public HTML variants/14 languages, all authored
disclosures,280 gallery images, dictionary parity and offline assets preserved.
Build01/03 hit ENOSPC while other fixtures consumed temporary space. Build02
passed before the final cancellation repair. Cleanup commands were rejected by
automatic policy; NTFS compression of an inactive owned old AVD quickboot RAM
image preserved the file and freed space, and final04 was run after JS fixture
cleanup. No signed APK, user disk image or evidence was deleted. No UI or public
text was introduced; the full security UI/14-language semantic matrix remains.

Diagnostic native compilation passed6m53s. Frozen input01
66D985B59DAE0F42806D21EBDF07F4F6A3F7E30445826611FFA59F15EBD1E3CF
built successfully9m30s with189/189 across23 security suites. It predates the
cancelled-copy repair and is SUPERSEDED, without runtime/provider acceptance.
Frozen input02:
7BEE05EA18133ADAF44F949D68BE0582902B8520497B76D576FA53E4A130CDEA.
Build SUCCESS10m55s; expanded JVM249/249 across34 E2EE security/auth suites,
including native feature-source regressions,0 failures/skips. Main APK:
`85654AA5370BA98F937E90418BE5818D95BEBD543C7D71D726CE6C3E2A3F25EC`;
test APK:
`3295882524B96EE8847532686B13A4EC18FD4155015B4C8A24AC1494BFF73D69`.
Actual API26/API34 each passed2/2 new coordinator cases and6/6 regressions:
`output/qa/security336-migration-history-api{26,34}-03/results.json`. The attempted
runner02 used abbreviated class names, was rejected before test execution and
is diagnostic only;03 supplies fully qualified names on the SAME frozen02 APKs.

`migration-history-host-api{26,34}-03.json` independently verifies all4,194,392
logical bytes/24 hashes per platform and every extracted new artifact hash.
All48 encrypted rows remain identical and transport calls stay0. Actual new
fixture elapsed9,201/19,529ms; max Java heap512/192MiB. These are selected fixture
measurements, not peak heap, a product SLA or API26/192MiB/OEM acceptance.

Separate host regression reports with `legacy-regression`, `original-legacy-
regression` and `original-stage-regression` verify the exact12,583,247byte/49part
old wrapper and9,437,206 decoded bytes,1,048,598 original legacy logical bytes
after owned synthetic old-alias deletion, and73,400,354 original stage bytes.
Fresh JCA vectors still open through roots/PUBLIC-signer WebCrypto capabilities.
These are separate older component proofs, not new cross-device custody for the
coordinator. Its own native raw-wrapper ordering is not independently rebuilt
by the host; the actual reader verifies that original raw digest.

Post-device source/APK identities match frozen02:
`migration-history-post-device-identity-02.json`. Full Android lint02 completed
SUCCESS12m40s,0 errors/208 warnings/8 hints. No new issue/file pairs against
`content-plan-readback-native-lint-01.xml`; exact XML/log/delta02 are retained.
Final post-lint source and both APK identities also match:
`migration-history-post-lint-identity-02.json`. This component result grants no
migration activation.

Remaining release gates include all11 real sources, protected remote originals,
authenticated cross-device custody, real bounded native/WebView process-role
inputs and nested old key/AAD materialization, source/plan/state4 publication,
normal product writers/unlock/enrollment/recovery, atomic shared ACL/rotation,
attachments/Drive, signed direct upgrades,48 full product scenarios,14-language
semantic/visual acceptance and independent human cryptographic review.
