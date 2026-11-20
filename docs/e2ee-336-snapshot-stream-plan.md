# Whole-scope source streaming: coordinator integration plan

20 November2026. Proposed integration, NOT an implemented storage format or
accepted migration. Keep the existing32/48/64MiB gates, coverage9/20,
floors0 and pilot/cutover off until the complete replacement is accepted.
Requirements: `e2ee-336-archive-stream-requirements.md`.

The next local stage module is now under separate acceptance in
`e2ee-336-source-stage.md`. It implements encrypted quarantine/catalogues,
not this plan's coordinator pointer, complete source registry or common-reader
integration. Keep those distinctions when composing the following steps.

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
