# ADR: vault, recovery, signed directories and opaque storage

18 November 2026. Work in progress on `codex/security-336`. Production activation
is disabled. This document extends `e2ee-336-contract-adr.md`; it does not claim
that all existing data paths have already been migrated.

## Primitives and formats

Root delivery uses RFC 9180 base-mode HPKE with DHKEM(P-256, HKDF-SHA256),
HKDF-SHA256 and AES-256-GCM (wire suite `DHKEM-P256-HKDFSHA256-A256GCM`). Web
uses `@hpke/core` 1.10.1 (MIT, Web Crypto); native uses Bouncy Castle
`bcprov-jdk18on` 1.87 (Bouncy Castle licence, lightweight HPKE/HKDF, no global
provider replacement). Runtime dependency versions are exact. P-256 enc/public
keys are the RFC 9180 65-byte uncompressed point; private scalars are 32 bytes.
No application AES, ECDH, HPKE or HKDF arithmetic is implemented. API26 platform
acceptance and dependency scanning of these additions remain required.

Bounded content planning now preserves complete-byte SHA-256 without retaining
whole web plaintext via exact `@noble/hashes`2.4.0 (MIT, Node>=20.19.0; browser
ES2022 build). Native uses platform JCA SHA-256. Both full/runtime dependency
audits returned0 currently known advisories; exact lock integrity and selected
browser/JCA interoperability are recorded in `e2ee-336-content-plan-stream.md`.
AES/AEAD/keys remain on the established providers. The new local plan format is
inert and not wired into active migration. Its metadata has a separate strict
4MiB/250000-node budget; the old file manifest remains256KiB/10000 nodes. No
crypto suite, writer protocol, rollout floor or production state is changed.

A recovery authority has independent randomly generated signing and receiving
keys, separate from every device. A newly generated 32-byte CSPRNG recovery
secret protects the authority's portable private key bundle. HKDF info is
`GENESIS-E2EE-SECRET\0v1\0owner\0purpose`, salt is 32 random bytes. AES-GCM
nonce is 12 random bytes, tag 128 bits; AAD has a distinct BUNDLE prefix and the
same owner/purpose. The 64KiB maximum is checked before decryption. This is an
entropy-secret KDF, not a password KDF; no Google password, email or identity token
is accepted. Purposes `recovery-authority` and `device-vault` are distinct.
The recovery secret is returned to the user, never persisted with its ciphertext.

Each scope root is independently random. Devices and the recovery authority get
separate HPKE root capsules. HPKE info binds owner, scope, crypto epoch, key ID and
recipient. Private bundle import proves both key pairs match. Native JCA can
export 67-byte PKCS8 without the optional public point; Web Crypto can export
138-byte PKCS8. Both are accepted only through EC/P-256 platform key parsers and
possession checks. Cross-platform tests caught this real encoding difference.

## Authorization and durability

Signed commands bind owner/scope/device/action, directory revision AND previous
checkpoint hash, security epoch, operation ID and typed payload. Their canonical
encoding has explicit type tags, uint32 lengths, uint64 safe integers and sorted
ASCII field names, with depth/size/count bounds. Wire strings are technical ASCII;
private text belongs inside encrypted payloads. Empty objects are forbidden to
avoid PHP associative JSON empty-list ambiguity. Signatures use the existing
P1363 contract. Idempotency hashes exclude signature/selfProof fields to avoid
ES256 signature malleability changing operation identity.

The backend checks ACL, signature, current device, epoch, mandatory CAS and receipt
under one SQLite write lock. Envelopes are immutable retry artifacts. It never
decrypts an E2EE root, DEK or object. Enrollment challenges bind candidate keys,
owner, session, nonce and five-minute expiry, are single-use, and require both
candidate possession and trusted-device/recovery approval. Signed directory events
are chained; clients reconstruct trust from pinned authority keys and all events,
not the server's devices/approved flags. Root rotation requires new key ID/epochs
and fresh capsules for all survivors/recovery, excludes revoked devices and
invalidates account sessions for revoked owners. Existing history is not revoked.

Migration start takes a 15-minute lease/fence against an opaque HMAC revision token
of legacy private rows. Shadow writes require that exact lease/fence. Signed
verification seals the uploaded object manifest; atomic commit checks source
stability, verification and lease before switching to active. Cancel cannot move
an active scope backwards. No old generation/key is erased by this implementation.

An API boundary precedes early restore/private/shared handlers. Persistent SQLite
triggers fence legacy writes and raw account-key/generation changes for active
scopes (and private writes while a migration lease is live). This also protects
jobs/older server code. Identity, billing and provider consent remain separate
authorities; archives cannot mutate them. Expired leases allow legacy work to
resume; a new verified commit must reconcile a changed source. Runtime rollout
flags never remove fences from an active scope.

## Local data and attachments

Web storage uses a dedicated IndexedDB database with atomic compare-and-write
batches and strict durability. Only signed encrypted records are persisted;
keys stay in an unlocked in-memory capability. Lock/account switch invalidates
in-flight encryption before commit. There is no plaintext/localStorage fallback
and errors do not create an empty replacement database.

Files use an independent random file root and 256KiB chunks, each with a fresh DEK
and nonce. An encrypted signed manifest contains file key, filename/media type,
total size and ordered chunk descriptors with signature-free ciphertext hashes.
Context binds each chunk's position/object/operation and epoch. Truncation,
reordering, substitution and incorrect sizes fail before returning a file.
The current bounded implementation accepts up to 64MiB per file; larger streaming
artifacts need an explicitly tested staging implementation rather than relaxed limits.

## Signed history and normal synchronization

The pinned scope owner alone administers a directory, including shared scopes.
Enrollment signs the candidate's current server ACL role (`owner`, `writer`,
`commenter`, `reader`); the server rechecks that role under the write lock. An
owner role is bound to the pinned owner's immutable user ID. Writers cannot
enroll another device or rotate keys. Commenters may append revision-1
`shared-comment` objects, never replace an existing comment/project document.

Survivors retain their previous HPKE root grants on each rotation. Enrollment
must include a grant for every historical epoch; key IDs cannot be reused
anywhere in the signed chain. This preserves readable history on a newly
authorized client without forwarding future keys to a revoked device.

Migration commit signs the baseline opaque head hash/count; each rotation signs
the current complete heads before changing keys. The backend preserves these
snapshots in `e2ee_retired_manifests`. Clients verify their hash/count and apply
the latest signed head as a minimum revision/hash floor even for current-epoch
ciphertexts. Old-epoch ciphertext must match a sealed head exactly. A valid old
signature alone cannot authorize newly manufactured history. Saved per-object
floors and completed upload receipts advance in the same local transaction.

`scope-client.ts` and native `E2eeScopeClient.kt` store the encrypted draft,
exact ciphertext and retry plan before the first upload. A changed epoch
requires explicit rebase. Signed `cancel-put` resolves a pending operation under
the same server writer lock as `put`: it returns its accepted receipt or creates
an idempotency tombstone. Only then may the client replace its ciphertext.
Delayed originals cannot overwrite the replacement. The original job/draft is
retained, including its private filename/media type. A lost acknowledgement for
either a chunk or the final manifest does not cause a second logical write.

Online refresh persists verified signed heads encrypted with the saved directory.
Explicit `hydrateOffline()` reconstructs trusted roots and rosters without
network access. Reading an existing local draft needs only an unlocked device;
preparing a new draft uses saved authenticated floors and performs no network
requests. Network operations after offline hydration require a fresh directory
refresh. A failed/untrusted response never silently selects an old directory.
`editor-queue.ts` / `E2eeEditorQueue.kt` provide a separate durable latest-draft
queue: every acknowledged save has an immutable protected snapshot while an
earlier upload is unresolved. Intermediate uploads can be coalesced; the1024
retained snapshots are never silently deleted. Scope/device binding prevents
cross-scope reuse; CAS protects simultaneous editors. Authenticated remote
reconciliation advances the base only after explicit merge or clean-cache
acceptance. Completed older receipts cannot reduce that base.

Android additionally has a ciphertext-only CAS database in `noBackupFilesDir`.
Its database cannot be silently created during normal unlock or replaced on
corruption. Keystore protection of the separate portable device bundle requires
strong biometrics/device credential (300-second authorization; supported API26
fallback). Missing/invalidated keys preserve existing records. Instrumented
user-presence/invalidation and full product lifecycle acceptance are pending.

Lease renewal is signed, durable and source-checked. It resolves any pending
receipt before re-signing a proven uncommitted migration operation with a new
fence. Explicit restart archives the cancelled attempt and supplies every prior
protected snapshot to reconciliation; it cannot cancel an active generation.

Native `E2eeMigration.kt` implements the same snapshot/shadow/lease/readback/recovery
state machine as the browser. Both use distinct required coverage path IDs and
allowed crypto content domains from `private-paths-v1.json`. Missing adapters
block capture, incomplete paths block activation. Sources are copied, not mutated;
all previous attempts reach reconciliation. Input history and reconciled output
each have a128MiB aggregate limit in addition to per-file/object limits. Shared
local-work reconciles into authorized private objects; raw draft/outbox/legacy-key
metadata stays protected locally. Shared comments retain the normal immutable
64KiB envelope format rather than a file manifest.

`SignedMigrationTransport` / `E2eeSignedMigrationTransport` use authenticated
source/command routes and signed paginated readback. A short page does not mean
EOF: readback ends on an empty page, verifies cursor progress/checkpoint binding,
and is capped at8000 objects/256MiB serialized ciphertext. Android captures the
account generation and checks it before/after IO; web uses the existing account
abort channel. Low-memory device acceptance at these upper bounds is pending;
no streaming/unbounded storage guarantee is made.

Migration pagination uses the server's signed `read` action. Independent web and
native packets in `tests/fixtures/e2ee/migration-transport-v1.json` are replayed
against the real PHP/SQLite reader, avoiding a permissive transport mock contract.

Legacy background workers filter protected/live-migrating personal/project scopes
(including a protected parent space) before scan/claim LIMIT. They recheck under
the writer at execution and on acknowledgement after network IO. Deferral retains
the original payload and source/delivery rows; attempts are refunded only at the
unstarted entry gate. A corrupt private binding is quarantined with the retained
payload and a fixed diagnostic code, outside SQLite's read-only filter callback.
Database/configuration errors remain infrastructure failures. Advice selection
may own its own transaction; the later complete notification plan uses a separate
writer with a fresh scope check. These safeguards do not execute encrypted rules
on the server or replace the required client automation integration.

Schema disposition now compares all218 actual tables/columns, independently of
the fence inventory.106 private legacy tables include copied operation results,
backup staging/safety records and private notification state. Set-valued copy
predicates include multiple explicit project/space references and conservative
current author memberships; they are deny/source-token supersets, not read grants.
Private user preferences have a targeted column fence while billing/identity
remain independent. Shared housekeeping uses the same predicates atomically in
DELETE and isolates protected cascades with a savepoint, preserving bytes/counts
while unrelated legacy maintenance continues. Neither this inventory nor the
fences encrypt the existing legacy generation or replace actual content adapters.

## First real workspace source adapter

`PersonalWorkspaceSource` captures actual owner-scoped localStorage workspace,
sync base/metadata, device key and every workspace queue journal without invoking
the mutating `readPending()` helper. The cloud factory supplies real in-memory
key/base/metadata and requires a mounted-editor capture callback. Raw legacy keys
and HTTP queue metadata remain only in the protected local snapshot. Migrated
content contains the reconciled workspace and a separate encrypted historical
relational snapshot, never server identity/billing/ACL credentials. Old relational
rows are not unioned into a current encrypted workspace and cannot resurrect it.

Both coordinators pass immutable owner/scope/migration/fence/source/generation
context only after durable capture and the server lease. Both authenticated
transports sign `legacy-workspace` through the existing `/read` route. The backend
authorizes and reads under one short SQLite writer transaction. It accepts only
the personal owner/current trusted device, live matching lease/fence/source token
and current directory; active/retirement scopes cannot read this legacy source.
It never calls bootstrap/provider enumeration or `genesisEnsureWorkspaceKey`.
Only an already server-known OLD workspace key can be returned; a client-only
legacy key must come from the protected local capture. Missing/corrupt keys do
not trigger generation of a new key. Explicit selected row fields,10000 combined
rows and16MiB serialized response bound the read. Conservative guard ownership
supersets never authorize an export.

Reconciliation uses the existing three-way domain merger with explicit conflict
choices and tombstones. Strict validation rejects future writers/schemas, invalid
IDs, duplicate rows and event projections that would drop original fields. Changed
prior attempts, unscoped legacy attribution, different mounted/persisted bases
and legacy tracker conversion still require dedicated review before completeness.
They are retained and stop migration, rather than becoming empty data. The first
adapter is not yet wired into product enrollment/bootstrap/editor routing; durable
multitab fences and every remaining adapter remain required before pilot.

`E2eeNativeWorkspaceSource` now captures the real Room `cloud-base`, `structure`,
`habits` and `trackers` rows and their exact workspace outbox metadata. The
AuthController factory reads those rows under one Room transaction and uses the
existing LocalCipher without key creation. The protected snapshot contains both
original ciphertext and portable decrypted JSON; neither source nor queue is
acknowledged/cleared. Strict fragment validation precedes the existing conservative
WorkspacePatch merger. Missing queues/revisions, held queues, changed prior
attempts and a remote tombstone unknown to the local base stop reconciliation.
An explicit conflict decision is bound to the exact preview fingerprint. Native
achievement identities/clocks become canonical web IDs; unrelated web-only fields
survive. Event codec roundtrips must retain the original fields, and parser errors
are reduced to fixed codes without private values/causes. Selected real
Room/Keystore/source and storage-barrier scenarios have now passed on API26, as
described below. Full lifecycle/upgrade, vault user-presence and low-memory
acceptance are still pending.

Both adapters also capture accepted/pending restore generations and reject an
unreconciled reset, source generation mismatch or remote workspace rollback.
Web snapshot format2 adds explicit generation provenance; an older snapshot
without it requires review, not an assumed generation0. The server allocates a
shadow generation above the latest personal legacy data_generation even if a
restore happened after bootstrap/between attempts, and never reuses an abandoned
shadow generation. Reads/puts/verification require a lease whose target generation
still matches the scope and exceeds the legacy generation. Existing shadow data
is retained and same-attempt changed-source restarts are rejected.

## Native persistent legacy storage barrier

Room schema2 adds only `e2ee_legacy_fences`; migration1→2 preserves all original
tables, row bytes/ciphertexts, revisions and queued operation IDs. There is no
destructive fallback. A native barrier installs/retains SQLite guards for every
INSERT/UPDATE/DELETE of tasks, documents, outbox and reminders in the explicitly
bound storage scope. Both OLD and NEW scope are checked on moves. An active
deny row cannot be updated/deleted/replaced, including SQLite REPLACE with
recursive delete triggers disabled. Archive content APIs never import this table.
The application installs guards on open, and the fence also installs them in
the same Room transaction as a new preparing marker. No marker is created merely
by upgrading; all existing legacy accounts continue normally until an explicit
migration. No current product screen starts this migration yet.

The preparing marker commits before local capture/network and survives failures
and process death. A fresh protected cancelled status is read under the same
controller lock before release; an old Status object is not accepted. Independent
Room controllers for one configured DB/scope share the lock in the app's single
writer process; persistent SQL independently protects old writers across database
connections and process restart. Explicit retry/recovery is required after a
failed preparation; exceptions never automatically reopen writes. Active is
irreversible even when a stale preparing directory is passed to cancellation.

API26 instrumentation checked direct schema1→2, all4 table mutation families,
scope moves, REPLACE, unrelated writes, late cancellation across2 Room instances,
connection reopening and real host SIGKILL/force-stop during the preparing
operation. Exact original4 rows were checked in the new process. A separate
actual Room + AndroidKeyStore workspace-source test removed only a fresh QA key
alias and proved capture fails without recreating a key, empty workspace or
queue acknowledgement. The default legacy alias is unchanged.

The web's controlling worker now has a separate global permit for unidentified old
requests and reads persistent owner deny markers. Product migration preflight
requires its current controller's explicit protocol acknowledgement. See
`e2ee-336-service-worker.md` for tested streaming/bounds, cache packaging and the
remaining local/editor/uncontrolled-client limits. No force-reload or cleanup is
introduced, and complete product migration is still disabled.

The central personal AuthSessionClient now shares the storage fence's scope mutex
through complete IO, and the web API uses durable deny markers/Web Locks; see
`e2ee-336-legacy-transport.md` for actual tested boundaries. These are not a
completed product lifecycle route. Separate shared/external workers still need
explicit exclusion before plaintext external I/O and all new editors
need the protected queue. Exact shared child storage scopes require their own
approved binding; this root-scope barrier does not assert those adapters exist.
Web multitab fencing, full device-credential vault acceptance and all48 scenarios
remain required. Pilot/cutover and mandatory update floors stay disabled.

## Native Aurora source engine

The real Room Aurora source now delegates domain validation/merging to the same
packaged TypeScript source as web. A new owner/job-bound headless WebView has no
network/storage/file/vault/mutation port. Captured old keys stay native; new roots
and device private keys never enter it. Only bounded immutable captured documents
and native-authenticated legacy plaintext cross the chunked bridge. Cancellation
invalidates and drains operations before destroying it. The product account guard
and UpdateGate are connected; unlocked-device/vault lifecycle and the complete
migration/editor route remain the product coordinator's responsibility.

API34 tested actual Room, Keystore and packaged runtime with40 sessions and
immutable writer history, conflict refusal and account deactivation;3/3 PASS.
Focused JVM13/13 and JS15/15 pass, plus1454 full JS and2 real UI regressions.
Evidence/limits: `e2ee-336-aurora-source.md`. No direct upgrade/full product recovery
claim, production activation or update floor change follows from these tests.

## Native shared Aurora/Stoicheion source engine

The same isolated runtime now selects either the actual Aurora or Stoicheion
source. Native owns the selector and separately restricts output domain/object IDs;
a source cannot broaden itself by returning another content domain. The pure
Restoration merger has no HTTP/session/repository side effects. Native Stoicheion
capture includes actual encrypted Room day history and previous old-key copies;
the common source also validates practice journals, saved card replacements and
timeline history. Live quota, subscription and reroll rights are absent from
portable content. Details/evidence: `e2ee-336-stoicheion-source.md`.

The three source categories described above still require complete product routing,
unlocked-device lifecycle, source review and full upgrade/recovery acceptance.
Advice is described below; the remaining16 paths are mandatory. No production
activation follows from these focused tests.

## Native Advice source engine

The actual owner-scoped Room source captures exact current/history ciphertexts,
authenticated plaintext, proven v1 lookup bytes, generations and mounted work.
Unassigned historical hashes are neither assigned to this owner nor treated as
empty. The common validator retains rendered copies and notification/index
metadata inside new encrypted objects; dates and advice IDs stay out of new
remote object IDs. Captured and new key bytes never enter this JS source.

Advice has only a bounded public-byte port restricted to APK-pinned catalogue
paths. It has no legacy key-opening port. The native reader verifies SHA/length,
does not use the account client/cookie jar and refuses an inherited Java cookie
context. Actual TLS with the new deployed editions remains untested.

Preference/gateway/snapshot/reminder operations hold one owner permit before
controller/scheduler locks through offline fallback, writes and cleanup. Nested
IO borrows that permit. A process-local account-transition counter prevents
A→B→A from reviving old work; it is not a dataGeneration or crypto/security epoch.
Preference mutex release precedes scheduler restore. These scheduler mutexes
remain distinct; no prior same-mutex deadlock is asserted.

Actual source/retention/old-key-removal cases passed on API34 and final API35;
API26 passed storage/fence tests and all14-language old-provider fallback states.
The API35 run found a real provider difference: Java GMT is returned by WebView124
Intl as +00:00. The calendar contract now normalizes that unambiguous zero-offset
alias to UTC without changing device settings or accepting ambiguous/nonzero
shorthand. Full repeated API35 run31/31 and full JS1492/1492 pass. Evidence and
precise limits: `e2ee-336-advice-native-work.md`. Actual default global v1 inventory,
large histories, all product routing/recovery/upgrades and independent review
remain required; four real source adapters are not whole-product acceptance.

## Trust limits and remaining integration

The fifth real category, personal tasks, now captures actual owner cache, Room
rows, complete offline changes/deletions, revisions, detached recurrence and
recovered/creation history on both platforms. New object IDs are random and the
lookup index is encrypted; historical provider identities do not grant consent.
Raw HTTP queues/keys stay in the protected local snapshot. Native keys stay out
of the shared engine; its opening port accepts only exact captured old recovered
ciphertext and purpose. A bounded task JSON preflight rejects duplicate decoded
field names instead of accepting JSON.parse's last value. Native task sync holds
the owner capability through decrypt/IO/ack, acquired before controller locks.
Source/coordinator/new-root56 JS cases, actual IndexedDB14 checks and API34/35
43 cases pass; see `e2ee-336-tasks-client-source.md`. This is5/20 real sources,
not full product enrollment/recovery/consent/shared integration or activation.
The producer-state follow-up increased these to57 JS source/migration cases and
1510 full regressions; the actual target fingerprint passed additional native
new-root reads. A newly found server-side provider snapshot is outside the current
SQL source token. Its inventory and owner/file-operation lock boundary remain a
release blocker, documented in `e2ee-336-provider-cache.md`;5/20 counts adapters,
not complete account inventory. No activation follows from that count.

The web transport owner is now established only by a validated session reader.
Owner changes retire old capabilities before accepting a new login receipt;
quota failures cannot retain an old editor under a changed cookie identity.
Whole-operation permits extend the owner Web Lock through local journaling and
cleanup. Nested IO borrows the gate's opaque live permit, avoiding reentrant lock
deadlock behind a waiting migration. The actual diary writer is connected; other
feature writers and migration-time protected editing remain mandatory. Evidence
and exact limits: `e2ee-336-operation-fences.md`.

A saved trusted checkpoint detects rollback below that checkpoint and conflicting
extensions; completely new devices need a trusted-device exchange or independently
held recovery kit. No external witness/anti-fork service is claimed. A malicious
same-origin script running while unlocked can use memory capabilities; Web Crypto
non-extractability is not an XSS defence. Group epoch distribution uses signed
membership and RFC9180 capsules; it does not promise MLS/ratchet/forward secrecy.
Existing message history retains its current protocol.

Required next work: complete adapters for every actual personal/shared/local
queue/draft path and their shared writer fences; product bootstrap/editor routing,
lifecycle/service worker/multitab routing;
recoverable archives/Drive adapter; ACL change-and-rotation transaction; all 48
acceptance scenarios, native API26 and actual authorized upgrade/restore/channel
drills, 14-language semantic acceptance. External independent cryptographic review
of the composed protocol is mandatory before pilot/cutover. It has not occurred.
No global `supportedCryptoProtocol`, update floor or production flag is raised here.
