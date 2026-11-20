# Streamed coordinator integration: remaining design constraints

20 November2026. Design for the next increment, not implemented/accepted
functionality. Current v3 `run()` still refuses before transport. Source
coverage remains9/20 and every release/recovery/human-review gate remains.

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

Remote legacy inputs also need durable original provenance. The pre-network
local snapshot does not magically contain later server responses. Materialize
each authenticated remote page/fragment and necessary old key material into
protected local quarantine before destructive normalization or dropping an
in-memory response. Retain it across cancelled/partial attempts: a later server
source may have changed or been deleted. Do not assume that every partial
content plan is disposable derived data unless its complete reproducible
original input is demonstrably protected. Old raw metadata/queues stay local
and grant no replay, identity, billing or ACL authority.

The complete content-plan reference must be bound to the exact source catalogue,
source histories, original actor, target scope/generation, directory checkpoint
and server lease/source token. Its own final marker is inert. Coordinator
publication uses the existing local CAS and source-catalogue guard after every
capacity/key/source await. A lost CAS preserves every losing source and plan.
Read back a newly published/reopened plan before beginning upload; missing or
corrupt plan/source records cannot become successful empty input.

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
