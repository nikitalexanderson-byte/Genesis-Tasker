# Whole-scope source streaming: coordinator integration plan

20 November2026. Proposed integration, NOT an implemented storage format or
accepted migration. Keep the existing32/48/64MiB gates, coverage9/20,
floors0 and pilot/cutover off until the complete replacement is accepted.
Requirements: `e2ee-336-archive-stream-requirements.md`.

The local stage module was accepted separately in `e2ee-336-source-stage.md`.
The coordinator SOURCE-publication increment is accepted separately in
`e2ee-336-staged-coordinator.md`: explicit local state3, complete registry
capture and atomic catalogue/pointer publication. Its v3 run refuses before
transport until the complete streamed planner/common reader is implemented.
Neither increment completes this plan or raises real product source coverage.
The matching bounded existing-v1 file writer/reader are accepted separately in
`e2ee-336-file-stream.md` and `e2ee-336-file-read-stream.md`. They are now available
for content planning, but neither current coordinator uses a complete streamed
planner/common-reader path. Their presence does not remove the run gate.

## Source and storage boundary

The retained-inventory writer is only a producer for this process's views.
It must feed encrypted quarantine. Passing its larger output back into
`ByteArrayOutputStream`, JSONObject, JSON.parse, a Base64 tree or the old
coordinator capture would reintroduce the aggregate problem.

Use the established signed AEAD local vault and local-snapshot domain for
bounded source records. No alternative cipher/KDF, raw localStorage key or
server-controlled key is needed. Stage IDs, path IDs and chunk indices are
technical metadata; original texts, provider names and plaintext digests stay
inside encrypted records. Persist and re-open independent new device/root key
material before capturing input or reaching a transport capability.

The stage binding must include target owner/scope/kind, original device actor,
stage ID and the complete required-path registry. A shared scope's content owner
can differ from the device actor: do not assume that the device vault's owner
is the project owner. Per-path producers carry their own original data
generation/session/actor checks; none of these replace crypto/security epochs.

## Durable staging and publication

1. Create an authenticated inert stage journal before acknowledging its first
   input chunk. Append each bounded chunk and its journal advance in one
   existing vault CAS transaction. Return backpressure before accepting another
   chunk. Failed/losing/crashed stages retain their original binding and data.
2. Record ordered chunk lengths/digests and exact required path identities in a
   final encrypted manifest. Check count, context and complete source EOF for
   every producer. Do not infer completeness from a JSON closing bracket,
   declared length, a partial reader being closed or a server boolean.
3. Re-open all sealed chunks through the independent new root and validate the
   manifest before publishing the coordinator pointer. Publish that pointer and
   the complete stage state together under CAS, after the final original actor
   and source-version checks. No transport is available before this succeeds.
4. Discover unfinished stages after restart and retain them as inert source
   history. Unknown old remnants block for explicit reconciliation. Do not clear
   another stage, overwrite its context, or silently prepare an empty attempt.

Capacity admission must use actual available storage/record/provider limits and
preserve accepted input on refusal. A finite disk cannot provide unlimited
history; document refusal/recovery behavior instead of enlarging Java heaps or
claiming capacity from a single fixture. Persisted record metadata remains
bounded even when the private byte stream is large.

## Coordinator and common reader

Add a stream/reference source contract, with bounded compatibility readers for
existing small adapters. Continue to require every registry path before prepare;
the retained-view producer is not the personal.archives adapter. Preserve old
snapshot-state readers and every cancelled ancestor while introducing a new
explicit state version for staged references.

Reconcile one authenticated path/record at a time and seal resulting content as
it is produced. Keep only bounded descriptors/duplicate identities and coverage
metadata in the plan. Do not collect all content/history ByteArrays before
writing a plan. Distinguish remote content from device-only originals, old
queues, receipts and retained keys. No source stage grants identity, billing,
device-directory, membership or replay authority.

The actual native/WebView shared reader needs bounded source reads through the
same protected stage; a large JSON/Base64 bridge argument is insufficient.
Incremental parsing must preserve raw code units, duplicate-name/number
semantics and all original descriptors. Validate nested content before treating
it as an active record. Per-record bounds still apply and must correspond to
the real product/file/provider limits.

Before declaring an archive source portable, open ALL nested old LocalCipher,
safety, held and independent/provider archives using original AAD and retained
old keys. Quarantine large legacy AEAD plaintext under the new root until its
final tag authenticates. Copying an opaque old cipher into a new encrypted
record does not meet this requirement.

## Concrete composition constraints after the accepted source-stage increment

These are composition requirements for the whole integration. SOURCE-only
state3/publication has the separate local acceptance cited above; remaining
planning, recovery and reader requirements are not claims of implementation.
Review both actual `migration.ts` and native `E2eeMigration.kt` together.

- Introduce an explicit local state version3. Keep strict readers for1/2.
  Represent the source as a discriminated staged reference, with its original
  actor/vault identity and exact required-path registry. Do not encode a staged
  source as legacy `snapshotParts:0`/empty bytes or silently reinterpret an old
  snapshot hash. Crypto/writer protocol versions remain independent.
- Current `openSourceStage` deliberately derives the capturing vault's actor.
  The accepted cold tests reopen that same synthetic device identity, not a
  newly enrolled device. A recovery path needs an explicitly authenticated,
  read-only capability for the original vault/roots/signers. It must not rewrite
  the original actor, import an old active signing identity as the current device,
  restore old membership/billing/session authority, or rely on a backend boolean.
  Selected read-only original-source capability evidence is now available in
  `e2ee-336-original-source-reader.md`: public original signer/independently
  unwrapped roots, strict original context and revocable bounded path readers.
  It does not implement the authenticated handoff, custody or complete product
  recovery ceremony; those remain required integration work.
- `SourceStageReference` grants no source lease or network permission. Publish
  the complete immutable stage reference into the coordinator record under its
  existing CAS and original-source fence. A lost CAS leaves its stage inert.
  Only the committed coordinator pointer plus independently reopened keys/source
  may allow the existing lease/prepare command. Check actor/source versions both
  before and after capacity/key awaits and durable publication.
- Register streaming path adapters separately from bounded legacy adapters.
  Check **all** required registry paths before calling any producer or durable
  key callback. A missing stream-only adapter cannot be replaced by a successful
  empty legacy capture. Bound old per-path compatibility reads by their actual
  old limits; never funnel the combined staged output back into64MiB JSON.
- Complete stages that lost publication are still original history. Cancelled
  coordinator ancestors may contain1/2 or3 states and must retain their exact
  formats and source hashes. A new attempt must discover/reconcile every known
  original, not only references in the caller's conveniently supplied array.
- The current stage inspector makes incomplete attempts explicit but exposes
  no incomplete-prefix recovery reader. Do not silently omit those markers from
  a successful migration. Add an explicit inert-prefix/history mechanism with
  original journal serial/hash and per-part authentication, or refuse for
  reconciliation. A physical prefix EOF must never be labelled whole-source EOF.
- Extend the content planner too. Both current coordinators still gather
  `MigrationContent[]`/ByteArrays and `sealE2eeFile` still receives whole files.
  A reference-only prepare followed by that same aggregate planner is not
  streaming completion. Accept one bounded semantic record or file chunk at a
  time into encrypted local quarantine; keep only bounded descriptors, coverage,
  duplicate identities and receipts in the plan. Publish `planned:true` only
  after every required path, nested old tag and resulting record/file manifest
  has authenticated and read back successfully. No upload while planning.
- Preserve remote versus device-only placement. Plaintext hashes and old keys
  remain in encrypted local metadata; wire receipts/manifests expose only the
  allowed technical/ciphertext information. A streamed file still needs the
  existing independent file-key/chunk-context/authenticated-manifest guarantees.
  Use established AEAD implementations, including for legacy large-input reads.
- Add an actual bounded pull/ack port to the native shared reader. The current
  common engine cannot consume a huge new snapshot through one JSON/Base64
  bridge argument. Preserve the existing Main/renderer adoption fences, original
  actor, view/operation nonce and cancellation across every read and terminal
  adoption. A returned handle is read capability for inert bytes, not restore.
- The complete process collector cannot simply call `retained()` with the
  default form metadata reader on every directory: value/manifest/binary roles
  have different raw bodies. Authenticate original locators first, strictly
  decode their length-framed owner/epoch/view/role binding, filter the selected
  owner before opening private bodies, and use the corresponding bounded reader.
  Unknown roles/bindings/old remnants refuse. Active jobs/current views must be
  fenced and deduplicated against process directories without dropping input.
- Actual admission must include metadata, prior attempts, source parts and
  content-plan records. The current bounded storage key query can refuse at
  10000 local records before the per-stage allowance is exhausted. Do not claim
  all-account capacity from one51MiB fixture, raise a heap or truncate a list.
  Record refusal/recovery behavior, and preserve accepted originals on failure.

The composed acceptance must fault-inject after journal/part/stage completion,
before/after the coordinator CAS, during legacy mixed-ancestor reads, during
record/file plan publication and at account retirement. Assert that no transport
can observe an unpublished/partial plan, all losing originals remain recoverable
and direct old-version upgrades require no intermediate APK. These cases and
independent human review remain release gates beyond the local stage evidence.

## Acceptance and review

Use actual combined retained forms, selected/unselected file histories and a
24MiB file beyond the old aggregate gates. Exercise process loss at journal,
chunk, final-manifest and pointer boundaries; no-space, conflicting CAS,
truncation, changed source and account retirement. Demonstrate no network before
the complete protected snapshot and no partial record becoming restore content.

Cold-read the ENTIRE protected input/content after removing only the synthetic
old alias/key. Check actual API26 and API34 at their supported heaps and the
real browser/WebView path, not just a generated digest sink. Cross-platform
vectors, direct upgrades, all20 sources, the48-scenario product matrix,
14-language semantics and independent human crypto review remain separate
mandatory acceptance work. This plan does not satisfy or waive those gates.
