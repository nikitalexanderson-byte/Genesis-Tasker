# GENESIS 3.3.6: brief for independent cryptographic review

Prepared 19 November 2026. **Draft review material, not an audit result or release
approval.** No reviewer has been appointed or contacted through this task. The
owner must arrange a qualified independent human or organization; model review,
unit tests and dependency scanners do not satisfy this gate.

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
| Files | `app/e2ee/files.ts`, native `security/E2eeFiles.kt` | Independent file keys, chunk order/context/size, authenticated manifest and truncation, ciphertext-only hashes, resource ceilings and staging requirements |
| Migration | `app/e2ee/{migration,migration-local,migration-sources,migration-transport}.ts`, native counterparts | Snapshot before IO, protected old keys, local-only placement, prior attempts/conflicts/tombstones, lease/fence/source stability, download/decrypt verification, atomic commit and no downgrade |
| Old-format readers | Real source files in `app/e2ee/`, native `auth/E2eeNative*Source.kt`; Physis `app/e2ee/physis-legacy.ts` and native `security/E2eeLegacyPhysis.kt` | Complete private originals and queues, legacy AAD/password semantics, strict duplicate-name handling before key-opening requests, bound native capabilities, retained-key loss/recovery, no key output to JS/HTTP |
| Server exclusions | `server/src/e2ee-{policy,background,legacy-transport,personal-io-gate}.php`; `contracts/e2ee/{server-schema,legacy-transport,private-paths}-v1.json` | Every actual mutation/background path, persistent SQLite fences and cascade behavior, migration/active scope exclusions, correct owner/space/project predicates; inventory is not proof of feature coverage |
| Web/native boundary | `e2ee-336-service-worker.md`, `e2ee-336-operation-fences.md`, `e2ee-336-native-source-stream.md`; native `ui/NativeAuroraSourceRuntime.kt` | Old/uncontrolled tabs, service-worker lifetime, whole-operation permits, cancellation and bridge admission/output binding, supported WebView gate, memory/stream budgets |
| Backup/retirement | `security-bridge-335-adr.md`, `e2ee-336-local-output.md`, `e2ee-336-retained-native-old-keys.md` | Whole-system external-recipient encryption, independent private-key custody and restore drills, personal archives/Drive/local-only scope, rights/credentials excluded from content import, retention of old server-readable copies |

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

The thirteen remaining source categories, full bootstrap/unlock/editor routing,
normal writes and whole-product fences, shared ACL-change/rotation transaction,
files/automation, archives/Drive/local-only backup, large-data/old-provider
acceptance, clean recovery, direct signed upgrades, all48 system scenarios and
14-language semantic review remain unfinished. Do not substitute current unit
counts, the seven-adapter count or a successful CI run for these gates.

The review deliverable must identify reviewer/organization, scope, exact commit
and lockfile, threat assumptions, methods, reproducible findings and severity,
fix/retest disposition, residual limits and explicit remaining activation
blockers. Any critical data-loss or key-disclosure finding blocks activation.
The owner retains publication authority; this brief grants no permission to
send messages, distribute private evidence or enable production migration.
