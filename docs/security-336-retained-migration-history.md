# 3.3.6: retained migration ownership and restart (candidate)

22 November 2026. This is uncompiled implementation source, **not acceptance or
final crypto review**. No tests, compiler, typecheck, lint, build, CI, push or
release has run for this pass. Accepted coverage stays **9/20**. Production
3.3.5/149, the accepted Paddle website, floors0, cutover off and
GENESIS_DEPLOY_ANDROID=false are unchanged.

## Exact interrupted capture replay (22 November continuation; candidate)

Both source-stage implementations now reopen a capturing journal with its
original actor, target and CAS serial. A separate custody proof authenticates
every stored part, its size/hash/immutable serial and the unchanged journal and
catalogue. It deliberately exposes no logical reader, content-restore port,
raw portable JSON, invented suffix or path EOF.

The actual staged capture first authenticates all existing complete/prefix
material, then replays every recorded path from the current fenced producer.
Completed paths must match exactly through real producer EOF. On an unfinished
path, all old part hashes must match before appending new immutable parts.
A recorded short final part may only be followed by EOF; it is never rewritten
or followed by a new part that would break canonical chunking. Truncation,
changed bytes, extra bytes on a completed path, missing roles, concurrent CAS
or changed catalogue keep the barrier and originals.

The account-wide catalogue now understands this explicit prefix-only custody
role, allowing the real product prepare flow to reach resume. This is not a
namespace exception or admission of a partial source to reconciliation. Every
published source reference still requires the full ordered registry, real EOF
of every path, complete manifests and the same transactional catalogue CAS.
The last resumed journal is reused as the current full source, avoiding a
duplicate full snapshot on each interruption. Earlier complete/orphan sources
remain ordered history.

This handles unchanged-source interruptions and the final-marker crash window.
Changed-source prefixes still need explicit preservation/review rather than
automatic completion; divergent-domain review and ambiguous legacy cancellation
remain separate code work. No tests/compiler/typecheck/lint/build/CI ran.
Required consolidated checks include every part/EOF/manifest crash boundary,
complete-path extra/truncated input, stored short tails, wrong actor/target,
quota/CAS/process death, multiple orphan journals and web/native byte parity.

## Account-wide proof

Web `migration-ownership-catalogue.ts` and native
`E2eeMigrationOwnershipCatalogue` enumerate the actual device-vault migration
states and saved signed directories. Each state/ancestor is attributed to its
own owner, target, original actor and historical directory checkpoint. They
check archive ordering, cancellation copies/receipts, original state3 preparation,
state5 adoption, reserved plans, legacy source parts and coordinator-role
remnants. An unknown/corrupt/missing role is not an empty source or permission
to remove a barrier.

Original responses authenticate their signed reservation and exact registration.
Their recorded complete body or explicitly incomplete prefix is consumed to EOF.
A stored completion cannot be replaced by prefix proof. Content-plan inspection
checks complete and writing attempts, including an interrupted encrypted file
suffix without inventing its missing file key or plaintext completion.

The added retained-plan proof reads old v1/v2 logical files, inner signatures,
plaintext hashes and device-only parts as well. Historical root capsules open
only for the original device recipient. Control packets validate their particular
action, source/fence, pending identity/hash and directory binding; signatures
alone do not authorize a different action. This reader has no transport/replay,
key recovery, signing or deletion API.

Global inventory also encounters ordinary product outboxes. They now have
explicit decoders: signed file groups and exact protected plaintext drafts,
job/cancel/rebase/completed headers, checkpoint-bound product services, enrollment
self proof/capsules, Aurora references, membership batches/rotations and typed
advice/Stoicheion cells. Unknown entries still refuse the whole catalogue.
Pre-index file groups lacking only an overwritten mutable job header require a
complete signed file and byte-identical protected draft. This proves inert
content, never acknowledgement, absence of migration or permission to retry.

Both normal writers now preserve the exact completed job header before replacing
it. Aurora packet renewal also preserves the old packet. Per-row metadata/byte
counts are unique; helper re-reads do not charge the same row repeatedly. Producer
limits and actual provider quota remain authoritative; the sum of all retained
scopes is not given a new smaller plaintext byte ceiling.

## Composition

The actual web/native product sequence invokes authenticated staged preparation
both for first capture and for a cancelled attempt. The cancelled raw state is
retained verbatim as its immutable ancestor. Full proof runs before capture and
again before publication; complete orphan captures are checked too. Existing
remote originals and plans are retained under their real generations.

The new source-history handles consume the real source tuples after complete
ownership authentication. They do not manufacture state3 bytes from state4/5 or
filter foreign prefixes. One live coordinator cell is checked against its exact
serial/hash; after the coordinator's own explicit CAS the graph is authenticated
again while source/ancestor bindings remain fixed. Each supplied path must reach
EOF. Account lock/change, a foreign mutation, an abandoned reader or an unknown
role prevents completion. Legacy standalone source-only APIs retain their strict
original refusals.

The actual content-only backup capture on both clients includes completed user
values from retained plans, including completed records of a writing attempt.
They enter the existing portable inert-history format with stable cross-client
IDs and verified original size/hash/metadata. Local-only values stay local until
this explicit user export. The archive excludes key bundles, source-opening
records, raw HTTP originals, signed controls, pins, grants and incomplete encrypted
suffixes. These entries cannot restore identity, rights or execute old commands.
Typed restoration into normal repositories remains separate implementation work.

## Known remaining implementation and acceptance

- A legitimately interrupted **source-stage capture** still retains its barrier.
  Its missing EOF must not be invented. Implement explicit preservation/review of
  partial local source material before treating that path as recoverable restart.
- Old legacy cancellation with an unresolved start/no lease needs an explicit
  resolved transition; a phase label must not silently discard its pending packet.
- Some domain reconcilers still refuse divergent previous/current captures and
  require the intended explicit conflict/history workflow. This pass does not
  claim those domain decisions or typed restore are complete.
- The conservative live-cell verification rereads the graph. Measure realistic
  and maximum multi-scope file histories during consolidated acceptance; any
  proof-cache optimization must preserve raw record/inventory change detection.
- Verify compiler/API integration, all five journal protocols, mixed scopes and
  product outboxes, lost journals, orphan outputs, wrong owners/roles, revocation,
  incomplete prefixes, cancel/resume/adopt/restart races, process death and
  same-UID relogin/restore. Keep all unknown-role refusal assertions.
- Verify portable history semantics, byte equality and file metadata across
  web/native, local-only handling, archive limits and account/lock/expiry races.

Source inspection while implementing is not a test PASS. All consolidated release
conditions, 14-language/UI/device/upgrade checks and the final internal review of
the exact candidate remain outstanding. External human review is not required by
the owner's updated instruction.
