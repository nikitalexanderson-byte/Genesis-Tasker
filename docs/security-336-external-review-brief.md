# GENESIS 3.3.6: brief for independent cryptographic review

Prepared 19 November 2026, updated 20 November. **Draft review material, not an audit result or release
approval.** No reviewer has been appointed or contacted through this task. The
owner must arrange a qualified independent human or organization; model review,
unit tests and dependency scanners do not satisfy this gate.

21 November: the owner asked the implementing agent to perform the review
itself. A separate adversarial internal pass, reproducible findings/fixes and
its exact scope are recorded in `security-336-internal-crypto-review.md`.
It is not independent of the implementer and does not satisfy the independent
human-review gate. No reviewer has been selected and nothing has been sent.
The preliminary `faa7d1eb` ZIP predates those fixes and needs a delta review.

## Candidate and activation boundary

Repository: `nikitalexanderson-byte/Genesis-Tasker`, branch `codex/security-336`.
The committed baseline when this brief was prepared is
`2af7cc42c70d2f4e98948bc748684f91c480045c`. The following Physis-reader increment
introduces this brief after local verification. Reviewers must record the actual reviewed commit and
dependency lock hash; this baseline is not a freeze of the final product.
Subsequent integration changes require a delta review.

Production remains Android3.3.5/149 with mandatory update floors0, migration
pilot/cutover off and `GENESIS_DEPLOY_ANDROID=false`. The subsequent Physis and
reminders increments bring real source categories to nine out of twenty:
workspace, Aurora, Stoicheion, Advice, tasks, diary, mindmaps, Physis and reminders.
A category's source adapter does not prove its complete product lifecycle.
The signed server archive reader/byte fragments are still a partial next
increment, not a tenth source adapter. See each implementation document and the
actual candidate commit/evidence; this brief's original baseline is historical.

The pushed baseline before the latest backup batch is
`d31bd64233694fefa2a7595b2965006257e0e64c`: archive fragment collectors, original
web file/form capture and native whole-backup operation permits. Native Main/
renderer reply-adoption guards are the following locally accepted delta, not a frozen
or independently reviewed candidate. Their detailed state and exact test scope
are in `e2ee-336-archives-native-jobs.md`. The following backup batch also preserves
exact native file bytes/provider provenance and holds explicit whole-operation
web permits through crypto, IO, files and receipts. Current selected evidence is
in `e2ee-336-archives-native-file.md` and `e2ee-336-archives-web-jobs.md`: full
JS1755/1755, real Chromium22/22, JVM23/23 and actual API26/API34 acceptance22/22
each. This still does not implement the complete archives source or constitute
the independent human review.

The independent review may begin with the implemented protocol while feature
integration continues. Final composed-protocol and migration acceptance is
required **before any pilot or cutover**, together with the remaining release
gates. No production credentials or real user data are needed for initial review.

## Intended guarantees and limitations

New roots are random client-generated256-bit values. Backend identity, Google
authentication, billing and ACL remain separate authorities and cannot unwrap
new private content. Separate keys serve content, devices, recovery and files.
An existing trusted device or independent recovery authority approves a new
device; a backend approval flag is insufficient.

Legacy scopes still use their existing formats while migration is disabled.
Old server-known keys/copies are retained for recovery until a separately
approved retirement plan; new encryption cannot protect history already
disclosed. Public metadata, explicitly authorized Google/external copies and
the existing private-message protocol have distinct boundaries.

Saved trusted checkpoints detect rollback below an established trust anchor.
There is no external witness or anti-fork service, so a fresh device cannot
prove a complete server rollback using server state alone. Same-origin code
running while unlocked can use memory capabilities; `extractable=false` is not
an XSS defence. No MLS, message ratchet or forward-secrecy guarantee is claimed.
Revocation protects future independent epochs; already-read history cannot be
revoked retroactively.

## Review map and questions

| Area | Source and design | Required independent assessment |
| --- | --- | --- |
| Envelope/signatures | `app/e2ee/envelope.ts`, native `security/E2eeEnvelope.kt`, `server/src/e2ee-envelope.php`; `e2ee-336-contract-adr.md` | Canonical context/type/number encoding, expected-context checks, P-256 validation, P1363/DER conversion, AES-KW/GCM composition, parser/resource limits, signature identity and ciphertext-hash binding |
| Roots/recovery | `app/e2ee/keys.ts`, native `security/E2eeKeys.kt`; `e2ee-336-runtime-adr.md` | RFC9180 HPKE info binding, independent random roots/authority, HKDF purpose separation, portable key-pair possession checks, enrollment and clean-device recovery trust |
| Directory and commands | `app/e2ee/{directory,commands}.ts`, native equivalents, `server/src/{e2ee-commands,e2ee-store,e2ee-api}.php` | Single-use session-bound challenge, signed authority/role transitions, replay/rollback/fork limits, survivor/history grants, device revocation, CAS/idempotency/signature malleability |
| Storage/lifecycle | `app/e2ee/{storage,device-vault,editor-queue,scope-client}.ts`, native `security/{E2eeDeviceVault,E2eeRecordStorage,E2eeEditorQueue,UnlockedE2eeDevice}.kt` | Lock/account transition and process-death semantics, secure local persistence, invalidated Keystore behavior, immutable retry artifacts, no empty-store or plaintext fallback |
| Inert source stages | `app/e2ee/source-stage.ts`, native `security/E2eeSourceStage.kt`; `e2ee-336-source-stage.md` | Canonical binary metadata decoding, target owner versus original actor, catalogue/journal/part CAS, outstanding producers, EOF versus early close, incomplete and unknown remnants, actual quota/record bounds, key custody and the still-unimplemented coordinator publication boundary |
| Remote original quarantine | `app/e2ee/{remote-original,http-observation,http-response}.ts`, native `auth/{E2eeRemoteOriginal,E2eeHttpObservation,E2eeHttpResponseJson}.kt`; `e2ee-336-remote-originals-design.md` | Exact immutable request registration before networking, raw entity bytes before UTF8/JSON, decoded duplicate-name refusal, distinct partial/complete catalogue purposes, lease/directory/actor binding, part/manifest CAS and EOF, cancellation versus local provider failures, mandatory factory/state4/global-admission integration and authenticated original custody still required |
| HTTP origin/identity isolation | `app/cloud-sync.ts`, `app/e2ee/http-response.ts`, native `auth/AuthSessionClient.kt`; `e2ee-336-http-policy.md` | No redirect forwarding of authenticated E2EE data/CSRF, bounded technical error grammar without raw exception payloads, no body-originated root user/CSRF/profile authority before semantic validation; retained originals and normal session/cookie authority remain distinct |
| Files | `app/e2ee/files.ts`, native `security/E2eeFiles.kt` | Independent file keys, chunk order/context/size, authenticated manifest and truncation, ciphertext-only hashes, resource ceilings and staging requirements |
| Migration | `app/e2ee/{migration,migration-local,migration-sources,migration-transport}.ts`, native counterparts | Snapshot before IO, protected old keys, local-only placement, prior attempts/conflicts/tombstones, lease/fence/source stability, download/decrypt verification, atomic commit and no downgrade |
| Staged source publication | `app/e2ee/migration-stage.ts`, native `E2eeMigrationStage.kt`; separate local acceptance in `e2ee-336-staged-coordinator.md` | Explicit local state3 versus old1/2, original device/target binding, full registry before keys, incomplete/orphan history, catalogue compare in the SAME transaction as pointer/ancestor publication, admission/cancellation/CAS races. v3 run is closed before transport; complete streamed planning and new-device read-only recovery remain future work |
| Old-format readers | Real source files in `app/e2ee/`, native `auth/E2eeNative*Source.kt`; Physis `app/e2ee/physis-legacy.ts` and native `security/E2eeLegacyPhysis.kt` | Complete private originals and queues, legacy AAD/password semantics, strict duplicate-name handling before key-opening requests, bound native capabilities, retained-key loss/recovery, no key output to JS/HTTP |
| Server exclusions | `server/src/e2ee-{policy,background,legacy-transport,personal-io-gate}.php`; `contracts/e2ee/{server-schema,legacy-transport,private-paths}-v1.json` | Every actual mutation/background path, persistent SQLite fences and cascade behavior, migration/active scope exclusions, correct owner/space/project predicates; inventory is not proof of feature coverage |
| Web/native boundary | `e2ee-336-service-worker.md`, `e2ee-336-operation-fences.md`, `e2ee-336-native-source-stream.md`, `e2ee-336-archives-native-jobs.md`; native `ui/NativeAuroraSourceRuntime.kt`, `ui/NativeBackupDialog.kt` | Old/uncontrolled tabs, service-worker lifetime, whole-operation permits, cancellation, account changes across both Main and renderer queues, bound reply adoption and intentional-reset exceptions, supported WebView gate, memory/stream budgets |
| Backup/retirement | `security-bridge-335-adr.md`, `e2ee-336-local-output.md`, `e2ee-336-retained-native-old-keys.md`, `e2ee-336-archives-source.md`, `e2ee-336-archives-local-capture.md` | Whole-system external-recipient encryption, independent private-key custody and restore drills, exact raw fragment/duplicate-name integrity, selected file/forms, personal archives/Drive/local-only scope, rights/credentials excluded from content import, retention of old server-readable copies |

Web HPKE uses exact `@hpke/core1.10.1` (MIT); native uses exact
`bcprov-jdk18on1.87` (Bouncy Castle licence) for HPKE/HKDF and the legacy Physis
PBKDF2 reader, with platform JCA for AES/ECDSA. No global JCA provider is replaced.
Legacy Physis PBKDF2-HMAC-SHA256/600000 is read compatibility, not a new password
vault design. A new low-entropy password wrapper would require a separately
accepted Argon2id implementation and measured limits.

Please assess nonce uniqueness/usage limits under fresh per-write DEKs, cloned
state, restores, concurrent writers and retries. Check that no raw new key or
private plaintext/hash enters HTTP, AAD, logs, analytics or crash output. Check
malformed authenticated plaintext as well as invalid ciphertext; successful
AEAD alone is insufficient to accept a legacy record.

## Reproducible material

- Immutable task requirements: `security-336-implementation-prompt.md`.
- Threat/design decisions and current limitations: `e2ee-336-contract-adr.md`,
  `e2ee-336-runtime-adr.md`, `e2ee-336-data-paths.md` and machine-readable contracts.
- Public synthetic interoperability fixtures: `tests/fixtures/e2ee/`; generators
  under `scripts/crypto/`. They deliberately contain public test keys and must
  never be used for user data. WebCrypto, Node/OpenSSL and native/JCA/BC vectors
  are distinguishable; a shared implementation is not an independent oracle.
- Regression sources: `tests/e2ee-*.test.mjs`, native JVM/instrumented suites and
  isolated PHP/browser runners under `scripts/qa/`.
- Native form spill: `e2ee-336-archives-form-spool.md` and `BackupFormSpool`.
  Review exact UTF16 framing, owner/epoch/view/blob/index AAD, authenticated
  count/hash/EOF, private no-backup storage, replacement/crash locators, quota
  failure and old-local-key loss. Source-only restart locators grant no replay
  authority. Full aggregate streaming and crash-remnant/new-root reconciliation
  are still required; ordinary preview tests cannot close those gates.
- Existing Android LocalCipher now uses bounded update/finalization on encryption
  and decryption after an actual API26 large-input authentication failure was
  isolated. Review unchanged format/AAD/nonce handling, no unauthenticated partial
  plaintext, failure cleanup and old-key-loss witnesses including the new spill
  root. The observed diagnostic matrix is distinct from final device acceptance.
- Per-value native archive retention: `e2ee-336-archives-values-transport.md`.
  Review field identity before the first chunk, exact raw UTF16 values, every
  pending/unselected candidate and acknowledged manifest, original provider
  strings across JSON/UTF8, historical file references, quotas and original
  account/job/freeze lifetimes. It still does not complete aggregate streaming,
  process-remnant collection or the archives migration adapter.
- Existing v1 independent-key backup compatibility: `backup-336-portable-aad.md`.
  Actual Android JSON solidus quoting differs from JavaScript/JVM. Review the
  canonical new writer and exactly two fully authenticated semantic-header
  encodings for reading old files. This is not fallback to an unverified key,
  weaker E2EE suite, omitted context, plaintext or restore authority.
- Native binary retention: `e2ee-336-archives-binary-spill.md` and
  `BackupStoredBinary`. Review reuse of the existing authenticated UTF16 spill,
  original descriptor/binary binding, strict small metadata, canonical Base64
  length/padding/unused bits and complete digest/footer/EOF before whole-file
  publication. Review pending reservations, original opaque session incarnation,
  cleanup ownership, shared physical quota and cancellation during final metadata
  readback. Window disposal and job-end must invalidate promptly while the whole
  operation still drains; source-only streams and locators grant no restore or
  replay authority. The selected24/51MiB probes do not close aggregate snapshot
  streaming, process-remnant capture or the complete archives adapter gate.
- Native original-form port lifetimes: `e2ee-336-archives-port-lifetimes.md`.
  Review original actor checkpoints through terminal field/manifest readback,
  window disposal outside the publication monitor and epoch retirement before
  waiting for inventory cleanup. The recorded startup-helper failure is distinct
  from product IO and its original59/60 report is retained. Complete streaming,
  pending-process provenance and old-cipher opening requirements are listed in
  `e2ee-336-archive-stream-requirements.md`; these are remaining gates, not an
  implemented source protocol or proof of all-account portability.
- Chronological evidence and failed-run limitations: `release-3.3.6.md` and its
  linked increment documents. Local logs/artifact hashes are under
  `output/release-3.3.6/`; they are not all tracked or externally distributed.
- Original48 system acceptance scenarios are in the retained local report
  `output/security-review-2026-11-17/security-e2ee-report-2026-11-17.md`.
  The final review package must include a sanitized copy and exact scenario
  disposition. It has not yet been exported or sent.
  The tracked `security-336-acceptance-matrix.md` now lists every original ID
  and the specific remaining system acceptance; none is silently marked passed.

Use synthetic owner IDs and the separate QA package
`ru.genesis.calendar.qa1103.debug`. Do not modify a personal installation, Play
track, production database or neighboring hosting directory during review.
When a fixture uses Android Keystore, delete only its uniquely owned fixture
alias. Do not request real Google sessions, recovery kits or production keys.

## Required closure before activation

Latest retained-archive component evidence,20 November: early original-context
locators and a bounded current-process source producer are documented in
`e2ee-336-archive-origins.md` and `e2ee-336-archive-inventory-stream.md`.
The latter explicitly separates failed drafts, the input03 JVM/functional
evidence and input04's androidTest-only repair with an identical Main APK.
Its24/17/10MiB input and independently checked greater-than64MiB source are not
a complete protected coordinator snapshot or large WebView reader acceptance.
Review the remaining integration in `e2ee-336-snapshot-stream-plan.md` as a plan,
not an implemented or reviewed stage protocol. Coverage remains9/20.

The eleven remaining source categories, full bootstrap/unlock/editor routing,
normal writes and whole-product fences, shared ACL-change/rotation transaction,
files/automation, archives/Drive/local-only backup, large-data/old-provider
acceptance, clean recovery, direct signed upgrades, all48 system scenarios and
14-language semantic review remain unfinished. Do not substitute current unit
counts, the nine-adapter count or a successful CI run for these gates. The owned
API26/WebView113 fixture proves selected compatibility paths; its publicly signed
development provider/overlay is not a production distribution or a security
certification of obsolete operating systems/providers. Runtime support and the
native/WebView capability boundary still require explicit review.

The review deliverable must identify reviewer/organization, scope, exact commit
and lockfile, threat assumptions, methods, reproducible findings and severity,
fix/retest disposition, residual limits and explicit remaining activation
blockers. Any critical data-loss or key-disclosure finding blocks activation.
The owner retains publication authority; this brief grants no permission to
send messages, distribute private evidence or enable production migration.

Existing-v1 file readback now has a bounded web/native API, sharing full private
manifest preflight with the batch reader. Borrowed plaintext expires after the
sink settles; complete metadata is returned only after every ordered chunk and
final actor check. Selected evidence: `e2ee-336-file-read-stream.md`, JS93/93,
JVM167/167, actual API26/API34 each5/5 and Chromium17/17. The native40MiB and
browser9MiB+7byte checks are primitive/provider/IO acceptance. They do not close
coordinator/content streaming, product recovery, source coverage or human review.

Original-device read-only capability is documented in
`e2ee-336-original-source-reader.md`. Review the original actor/generation/epoch
bounds, trusted public signer/root lookup, namespace restriction, callback/key-map
snapshot before IO and close/retirement guards through borrowed-byte delivery.
Capture/publication still require the separate active writable vault. Selected
evidence: JS105/105, JVM172/172, Chromium14/14 and actual API26/API34 each2/2 plus
5/5 coordinator and4/4 retained-source regressions. Every73,400,354-byte generated
original and both fresh JCA vectors were independently checked. This proves a
reader boundary, not authenticated product recovery handoff, key custody, whole
account coverage or authority to restore an old active signing identity.

The next bounded content-plan component is documented in
`e2ee-336-content-plan-stream.md`. Review reservation/part/receipt/final-marker
CAS, separate remote/local placement, complete-byte incremental SHA-256,
attempt inventory, original-source preconditions and the serialization-failure
cleanup repair. Selected evidence is JS120/120, JVM179/179, actual API26/API34
each3/3 plus5/5 file regressions, Chromium13/13 and public-signer-only JCA/web
interoperability. Each native80MiB and browser18MiB+14byte original is checked
in full. The native lint baseline precedes this increment and cannot be used
as its new lint result. Full Android lint on the release candidate is pending.
The component does not activate v3 run or establish product input provenance,
whole-account custody/recovery or source coverage. Integration requirements in
`e2ee-336-streamed-coordinator-integration.md` are a design, not implemented
functionality; they explicitly retain every mixed old ancestor/remote original
and require real native/WebView bounded input before whole-product acceptance.

The following bounded staged-reconciliation increment is separately documented
in `e2ee-336-staged-reconciliation.md`: synchronous complete callback preflight,
tracked current/history readers, actual EOF versus prefix, sticky invalid/sink
failures, per-emission native acknowledgement, NonCancellable all-reader cleanup
and primary-error preservation. Review those lifetimes and the caller-owned
authenticated history/custody boundary. JS66/66, JVM190/190, Chromium11/11 and
actual API26/API34 each2/2 new plus5/5 regressions support the stated component
scope. The complete4,194,408-byte composed output hashes and unchanged original
rows are independently checked. No new crypto format, complete coordinator run,
product adapters, remote-input provenance or human review is implied. New native
full lint remains pending; source/APK hashes are in that component document.

Bounded signed inventory/get and raw web response parsing follow in
`e2ee-336-readback-stream.md`. Review post-sink device checks, exact cursor/context
and directory headers, final empty pages versus FULL expected-inventory proof,
missing/duplicate replies, HTTP budgets/UTF8/error/cancellation semantics and the
unchanged prohibition on treating a callback envelope as authenticated plaintext.
Selected JS110/110, JVM195/195, Chromium17/17 and actual API26/API34 each2/2 new
plus2/2 staged regressions support component scope; native signed ports remain
synthetic callback fixtures, and actual backend/product migration is not claimed.
The full4MiB+6byte payload hashes are independently checked. This does not switch
the old coordinator to streaming, protect remote originals or enable v3 run.

The complete-plan verifier is described in `e2ee-336-content-plan-readback.md`.
Review the exact committed expected inventory and independent signature checks
(payload hashes omit signatures), swallowed/concurrent/late callback semantics,
bounded exact-get context/file authentication and whole original digests. Local
quarantine is re-authenticated after remote awaits; local-only records have no
remote fallback. Native's suspending fetch/ack shares the existing strict v1
reader and must retain cancellation/finally cleanup. Component peer fixtures do
not establish an actual backend migration, source provenance, coordinator CAS,
product recovery, new real adapter coverage or independent human review.
Selected JS133/133, JVM203/203, Chromium15/15 and actual API26/API34 each3/3 new
plus4/4 regression cases PASS. Full native lint0/208/8 has no new issue/file pairs;
complete9MiB+7byte file and regression hashes are independently checked. These
remain component fixtures with an inert reference receipt; all release gates
still apply.

Legacy local-state1/2 registry wrappers now have a separate bounded compatibility
reader, `e2ee-336-legacy-snapshot-stream.md`. Review exact ORIGINAL hash/size/part
provenance, the strict JSON/Base64 parser (duplicate/escaped fields, unused bits,
boundaries/BOM/EOF), repeated path scans versus complete source authentication,
per-reader cleanup ownership and pending reservations until actual IO drain.
Revoked cursors must also wipe raw parts returned by late pending reads. Original
records remain immutable and retained; source-stage-v1 is a different format.
The generic reader neither widens the original source-stage capability nor
establishes authenticated original custody, complete mixed history, nested
legacy key/AAD materialization, product restoration or activation. Exact native
provider acceptance must come from that component document; older APKs do not
prove it. Synthetic path counts never increase real source coverage9/20.

The original-actor legacy capability now has its own acceptance record,
`e2ee-336-original-legacy-source.md`. Review its two DISJOINT reader purposes:
stage/catalog versus exact bounded migrationId:source:index, serial1. Reference
validation precedes allowed-ID allocation and source lookups. Roots and PUBLIC
signer still require authenticated custody; the factory does not establish it.
Neither legacy nor stage handles can write or restore an old active private
signing identity. JS112/112, JVM219/219, Chromium14/14 and actual API26/API34
each2/2 new plus4/4 regression cases PASS. Independently checked original logical
hashes and fresh public-only JCA/WebCrypto vectors support component scope only.
The old synthetic Keystore alias remains deleted while a separate new identity,
draft and all encrypted rows survive. Full mixed history, old nested-key/AAD
materialization, coordinator publication and product recovery remain pending.

Same-original-actor coordinator history is being composed in
`e2ee-336-migration-history.md`. Review exact archive-chain prefixes, immutable
cancel-copy source bindings, raw duplicate/UTF8/size admission BEFORE projected
native JSON, all-role locator preflight before corresponding body lookup and
final metadata hashes/serials plus catalogue/locator rechecks. Discovery adds
two explicit original-role methods to the active vault; empty-prefix listLocal
and the original-stage/legacy private capabilities remain narrow. A complete
orphan stage cannot disappear from a source list. Every path must authenticate
actual EOF; caught prefix/busy/factory failures and escaped readers cannot yield
a successful source receipt. Cleanup owns/drains web chunk buffers and native
streams, without claiming erasure of caller-owned buffers or immutable strings.

This component REFUSES retained network-touched ancestors/copies, prior plans,
orphan uploads/private output and content-plan journals. Such data may be the
only surviving copy of a remote original; a new derived plan cannot be admitted
by simply ignoring it. Review future state4 reservation/provenance/CAS separately.
The current factory does not establish cross-device custody, reopen an old
active private signer, feed real bounded WebView process roles, materialize
nested legacy keys or activate a migration. Its source/read admission is not a
provider-wide storage inventory or reservation for new writes. Selected full
JS1951/1951, JVM249/249, actual Chromium16/16/console0 and API26/API34 each2/2 new
plus6/6 regression cases support the stated component scope. Full Android lint
has0 errors/208 warnings/8 hints and no new issue/file pairs. Native acceptance
must use that exact frozen02 component record and reports03, not superseded
native01 or the invalid abbreviated-class runner02. The cancelled-copy red
witness is explicitly retained. Real source coverage remains9/20.

Wire JSON hardening is recorded separately in `e2ee-336-transport-json.md`.
Review the shared44-case byte corpus and decoded duplicate-name refusals BEFORE
JSON.parse/Android JSONObject, fatal UTF8, fixed route/error budgets, strict
number/depth/node/key/member limits and native account-cancellation propagation.
The private-file parser's limits are unchanged. This does not authenticate an
envelope or protect a remote original durably. A memory acknowledgement port
cannot be cited as encrypted custody. Actual native
acceptance must use the final corrected session fixture/component input, not
the superseded fixture that failed before response parsing.
