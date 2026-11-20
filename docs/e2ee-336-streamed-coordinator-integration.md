# Streamed coordinator integration: remaining design constraints

20 November2026. Design for the next increment, not implemented/accepted
functionality. Current v3 `run()` still refuses before transport. Source
coverage remains9/20 and every release/recovery/human-review gate remains.

The following component now exists separately: full synchronous reconciler
preflight and bounded current/history -> per-record protected-plan streaming,
`e2ee-336-staged-reconciliation.md`. Its browser/JS evidence does not open the
coordinator run gate. Native acceptance is recorded in that component document
with its frozen-input build/provider checks, not inferred from older APKs.

The accepted local state3 publishes a source reference only. It deliberately
rejects injected leases, plans and receipts. Preserve that strict reader. A
complete source-and-content integration should use a new explicit local state
version (proposed4), with exact staged-source and complete-content-plan
references. This is independent of crypto protocol1 and writer protocol9.
Never reinterpret a staged source as zero legacy snapshot parts.

Preflight all required reconciliation adapters before changing local state,
obtaining a lease or fetching remote contents. Capture/publish all local source
paths under the existing whole-job fence first. A missing streamed reconciler
cannot fall back to a successful empty compatibility capture. Small legacy
adapters need explicit per-path AND history bounds and must run one at a time.
Archives and the native shared reader need real bounded inputs/outputs.

Keep strict readers for local states1/2/3 and every cancelled ancestor. Legacy
snapshots contain a technical JSON/Base64 path wrapper, not the new source-stage
wire. Conversion must authenticate their entire original bytes/hash/actual EOF
with the original actor/root/public signer, then retain that exact provenance.
It cannot relabel an old hash as a new manifest hash, import an old active private
signing identity or silently omit an incomplete/unknown prefix. A new device
still needs authenticated handoff/custody; Google identity is insufficient.

The old-registry JSON/Base64 wrapper now has a separate bounded reader in
`e2ee-336-legacy-snapshot-stream.md`. It retains the exact original reference/
hash, preflights full syntax/inventory/EOF and rescans the original for each
selected path. Its platform evidence and pending native gates are explicit.
It does not widen the existing original-source-stage capability, authenticate
old custody or discover omitted ancestors. Coordinator history/publication and
all nested legacy key/AAD materialization remain mandatory.

A separate narrow original-actor legacy capability is now implemented in
`e2ee-336-original-legacy-source.md`. It uses roots plus a PUBLIC original signer,
without reactivating the old signing identity. Stage and legacy purposes have
disjoint read/discovery rules. Its current exact platform gates are documented
there; it still does not establish authenticated custody or a complete history.

The actual coordinator now has a SAME-original-actor bounded read scope,
`withStagedSourceHistory`, described in `e2ee-336-migration-history.md`. It
composes original v1/v2 wrappers and v3 stages, validates archived/cancelled
metadata roles/bindings and includes complete orphan stages. Every declared
path must really authenticate EOF; final raw metadata, locator and catalogue
rechecks precede callback return. This is read-only input, not state4 planning
or publication. Network-touched history, retained plans/orphan output and any
content-plan journal explicitly refuse pending provenance review. A consumer's
new journal also refuses: future composition must reserve/bind the EXACT owned
attempt and protect its originals, never install an arbitrary ignore-list.
Its exact native/provider/lint scope must come from that component record.

Remote legacy inputs also need durable original provenance. The pre-network
local snapshot does not magically contain later server responses. Materialize
each authenticated remote page/fragment and necessary old key material into
protected local quarantine before destructive normalization or dropping an
in-memory response. Retain it across cancelled/partial attempts: a later server
source may have changed or been deleted. Do not assume that every partial
content plan is disposable derived data unless its complete reproducible
original input is demonstrably protected. Old raw metadata/queues stay local
and grant no replay, identity, billing or ACL authority.

Remote-original quarantine needs a distinct authenticated purpose/catalogue.
Do not append a partial remote path set into the complete local-registry
source-stage catalogue for the same target: its strict current/orphan readers
require the entire original path registry. Bind remote observations to their
original owner/actor, request role, lease/source token, offsets/EOF, old-key
provenance and exact raw bytes before normalization. Capturing an observation
does not manufacture historical authenticity against a malicious old server.

The real web/native authenticated E2EE HTTP readers now reject ambiguous raw
JSON before projected objects reach these ports. Exact admission, common44-case
corpus and platform evidence are in `e2ee-336-transport-json.md`. Native's E2EE
error path preserves account cancellation instead of swallowing it through
runCatching. This is parser hardening only: an in-memory parsed response is NOT
the required durable remote original. Capture must precede UTF8 decoding/JSON
projection and bind the exact raw EOF, request/lease role and original actor.

The complete content-plan reference must be bound to the exact source catalogue,
source histories, original actor, target scope/generation, directory checkpoint
and server lease/source token. Its own final marker is inert. Coordinator
publication uses the existing local CAS and source-catalogue guard after every
capacity/key/source await. A lost CAS preserves every losing source and plan.
Read back a newly published/reopened plan before beginning upload; missing or
corrupt plan/source records cannot become successful empty input.

Bounded signed `forEachEnvelope`/`getEnvelope` ports now exist separately;
`e2ee-336-readback-stream.md` records exact evidence and limits. Web raw E2EE
JSON responses also have native-parity byte budgets before parsing. The old
coordinator still collects remote ciphertext through `readAll()` and opens full
file arrays. Do not route a streamed plan through those aggregate paths. Reuse
the bounded ports with pinned directory/checkpoint and exact planned contexts/
hashes; a new permissive server route is unnecessary. An empty page/header alone
cannot prove completeness against an untrusted server: compare the entire
expected inventory and reject extra/missing/duplicate objects, then verify every
complete content/file digest. Metadata may remain bounded in memory; whole
ciphertext/file arrays may not.

The complete-plan bounded verifier now has a separate implementation/evidence
record in `e2ee-336-content-plan-readback.md`. It verifies the whole expected
inventory (including signatures independently of payload hashes), then exact
gets and complete original digests, and reopens the protected local reference.
Native uses the shared strict v1 reader with suspending fetch/ack. Its component
receipt is inert; coordinator publication/history/custody remain to be composed.
Native/provider acceptance must be taken from that document, not old APKs.

Do not recreate an aggregate planner after a reference-only prepare. Reconcile
one semantic record/file stream at a time into `ProtectedMigrationContentPlan` /
`E2eeContentPlan.Writer`. Keep only bounded descriptors, duplicate identities,
coverage and receipts in memory. Preserve remote versus local-only placement
and use bounded readback for both. The complete original-byte digest remains
SHA-256. Hash complete raw metadata bytes against its saved reference; do not
regenerate JSON and assume native/web string escaping or property order matches.

Lease management remains signed/durable/source-checked while planning may take
longer than one lease. Resume any pending receipt exactly before replacing a
proven uncommitted operation. A changed legacy source requires reconciliation
with every saved original, not renewal against an invented current hash. No
content upload while planning, no activation from a partial receipt and no
automatic return to account-key mode or database rollback.

Native/WebView input needs an actual bounded pull/ack port, not a huge JSON or
Base64 argument cut into transport pieces and reassembled whole. Bind each pull,
ack and terminal adoption to original actor, renderer/view/operation nonce,
sequence and cancellation. A returned handle reads inert original bytes only.
The original role-aware process collector must filter authenticated owner/epoch/
view/role locators before opening corresponding bodies; unknown roles refuse.
All nested old LocalCipher/safety/held/provider archives must open with original
AAD and retained keys before semantic completeness. An opaque old cipher inside
a new envelope is not portable recovery.

Normal writers/unlock/enrollment/recovery routing, the11 remaining real sources,
shared ACL-change plus rotation, files/Drive, direct signed upgrades,48 product
scenarios,14-language semantic acceptance and independent human crypto review
remain separate work. A synthetic registry/plan or a passing CI cannot close
these gates. Source/plan metadata, all retained attempts and the provider's
record/free-space limits must enter admission; explicit refusal preserves
originals and needs a usable product recovery path.
