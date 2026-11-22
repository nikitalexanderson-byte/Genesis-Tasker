# 3.3.6: fresh private resource creation (implementation in progress)

22 November 2026. Candidate source only, no compilation/QA/publication. Accepted
coverage remains9/20. Existing production3.3.5/149/Paddle website, floors0, cutover
off and GENESIS_DEPLOY_ANDROID=false are unchanged.

## Existing chaos-status source compatibility (candidate source fix)

While composing fresh projects, source inspection found both fixed-row body
readers rejected the existing system chaos status positions -2/-1. They now
admit exactly the matching `chaos-open:<resource>` / `chaos-done:<resource>`
project rows with is_chaos1, matching is_done and exact reserved position.
All ordinary positions keep their nonnegative integer rule; all status flags
must be0/1. No negative technical control number or arbitrary negative ordering
was admitted. This is needed for both existing149 projects and new factory
baselines. No compilation/QA result is claimed.

## Read-only project recipient preview (subsequent candidate)

Added signed personal-owner `project-create-preview` and both real scope-client
ports. They validate a technical selection separately from its proposed members.
The same pure server inspection verifies current pinned-head coordinates,
placement permissions, ancestor graph and inherited roles for preview and for
actual preparation. Preview creates no placeholder, receipt, membership, scope
or capability. It carries no body or device key. The client verifies its
personal checkpoint, exact fresh resource ID, complete shape, same-scope anchor
coordinates and unchanged selection; it returns only the proposed topology.

Only later explicit preparation compares the reviewed list again under the
writer lock and may mint the technical factory capability/materialize FKs.
The response property name `reviewedMembers` is a wire proposal, **not UI
consent**: the pending project journal/UI must store an independent explicit
review step. Both actual create/resume journals, independently pinned/decrypted
anchor composition, private root/status writes and normal UI remain next.
No compiler/typecheck/lint/tests/build/CI ran.

## Signed project preparation/factory (subsequent candidate pass)

`resource-create-prepare` now has a project branch with the same active personal
owner/device/recovery/bootstrap proof and semantic intent receipt as spaces.
Its extra `topology` is technical only: space/parent/category/board IDs,
project/task-list kind, layout, current space/parent/category/status anchors and
the exact sorted reviewed inherited user/role list. Anchors bind scope, entity,
generation, directory checkpoint, root revision and payload hash. No user name,
title, description, tags, cover, key or content definition enters preparation.

`GenesisE2eeProjectCreation` can be minted only after that topology is checked
inside the caller's writer transaction. Space create permission, parent write
access, current undeleted metadata2 ancestor topology, no cycle/inbox/archive,
private category/status lineage and the exact inherited-role review are required.
Only technical ancestor routing is inspected internally; this adds no route for
unread ancestor content or keys. The existing project factory still enforces
feature/space-owner quota, creator ownership, parent/kind rules and defaults.
The internal capability is tied to the same PDO connection and consumed after
fresh inheritance; ordinary request input cannot pass it to the legacy factory.

Restricted inheritance follows nearest explicitly enabled descendant grants
and exclusions for this new child. Existing project memberships, assignments
and projection links are untouched. The creator stays the new owner; inherited
space owners/admins are managers as in the factory. Neither these routing rows
nor the reviewed list approves a device or issues a root capsule.

The project, three normal status rows, two technical chaos statuses, fresh
memberships, independent bootstrap and preparation receipt share the enclosing
transaction. All user-facing technical row labels are placeholders. A lost
response repeats the same signed semantic intent. The project receipt binds
the topology hash, reviewed members, exact status IDs/isDone/isChaos, project
placement, first checkpoint and created time. Negative status positions are
not inserted into the technical control wire; ordered status entries preserve
their distinct roles.

Fencev8 adds the space project-category table to exact row admission. Current
private category/status heads can materialize missing relational-ID placeholder
rows, preserving FKs without publishing their actual title/colour/order.
Existing rows must have the same lineage and are retained untouched. This is
not legacy plaintext creation or a general ACL exception.

Matching web/native technical topology contracts and service-custody readers
are added. This is still NOT the ordinary project create/resume UI: the next
client work must retain full project input before IO, obtain/independently verify
anchors and the read-only recipient preview, require explicit review, preserve the
fixed preparation packet across response loss, migrate the project, finish its
real baseline, write/read back intended root and localized status values, and
only then return a normal project. Add the pending project journal/UI/account
resume path alongside spaces. The preview endpoint/low-level ports now exist;
the normal creation journal/UI has not yet composed them.
Remaining normal invitation/member/device review and multi-scope reparent/
delete/restore lifecycle also remain code work. No compilation/QA ran.

## Project topology and exact physical-row foundation (candidate)

Added matching web/native/API project metadata2: space, parent project, project
category, board placement, project/task-list kind, layout, inbox and archive
state. New authenticated project bodies derive this exact metadata; readers
compare body/header values. The existing protocol1 project header is an explicit
historical reader with no topology assertion, so old retained jobs/versions
stay readable. It must never be promoted to live topology authority merely
because a legacy SQL row happens to exist.

The persistent fence moves forward to v7. Only shared_projects and
shared_project_statuses have a narrowly scoped exact physical-row admission.
A dedicated connection-local WeakMap/SQL callback matches the complete table,
verb and before/after values, including all real schema defaults/affinities.
It is valid only inside the verified caller's existing transaction and is
removed in finally. The SQL callback cannot query the database; it has no
request boolean or namespace wildcard. No writer currently obtains permission
merely from this helper's existence. All other legacy fences stay deny-only.

The four-table membership request allowlist and its separate all-scope
rotation capability are unchanged. Technical row admission does not grant
membership, approve devices, distribute capsules or authorize reparenting.

The actual normal project-root commit now validates this tuple and mirrors
only signed category/board/layout/archive fields under exact full-row admission.
It verifies private category/status heads, parent write access and restoration
quota where applicable. A drifted metadata2/SQL projection is refused; changing
parent/kind/inbox identity requires the complete affected-scope operation.
Names/descriptions/tags are never mirrored into SQL. A current-root topology
reader requires active product bootstrap, an undeleted exact root, metadata2
and matching technical projection; it cannot substitute an old SQL row/header.

This is foundation source, not completed project creation. Next: implement the
signed preparation/factory/inheritance composition and both real create/resume
clients. Parent changes still require complete affected-scope membership handling.
Project delete/restore quota/trash semantics remain in the parity pass; this
foundation does not claim that entire lifecycle is complete.
No compiler/typecheck/lint/tests/build/CI ran and coverage remains9/20.

## Implemented preparation

The subsequent composition below is now also candidate source: normal web/native
create-space actions retain their complete input, open the existing independent
recovery dialog, transition BOTH space and inbox, finish their actual repository
baselines, write/read back the intended private root at immutable revision2 and
issue/read back the explicitly requested pending invitations. Journal phases
advance through `draft/prepared/migrated/values/invitations/complete`; response
loss repeats the same protected IDs/commands. Account panels enumerate unfinished
creation inputs and resume them after a process restart. Pausing preserves the
input and existing barriers. Shared covers use decrypted values in the normal
projection and accept the existing0..100 position range.

New signed invitation issue/revoke services and state read operate on routing
metadata only. Issued IDs are fixed in the signed payload; creation uses the same
deterministic IDs on both clients. Semantic intent receipts and readback bind the
email, requested role/permissions and creator. No membership row, approved device,
root capsule or trust decision is created by sending an invitation. Consumed
invitations cannot be disguised as revoked access: actual access revocation still
requires the membership/rotation protocol. New service controls have explicit
web/native custody validation. Normal standalone invitation/accept/member-edit
UI composition remains separate code work.

The signed personal-scope service `resource-create-prepare` accepts only an
immutable owner/recovery-signed bootstrap and an intent ID. It requires an active
personal owner scope, a live approved owner device, matching device keys and the
same independently pinned recovery authority. A new resource/scope ID cannot
replace an existing resource. This first branch supports **spaces only**.

Technical space/inbox/status/owner rows use the existing shared-space factory and
its feature/quota invariants. The supplied title is an ID placeholder; no user
title, description, cover or invitation is sent in this operation. Existing
system defaults remain the migration source. The factory and bootstrap now
respect an enclosing transaction: the personal command, technical rows, initial
scope/directory and semantic intent receipt commit together. A nested component
cannot commit or roll back its caller. Existing standalone callers still own
their transaction. No schema135/table or new crypto suite was introduced;
`e2ee_service_intents` already has the explicit technical-contract disposition.

Web `E2eePrivateResourceCreation` and native `E2eePrivateResourceCreation` retain
the complete user input in an encrypted device document **before network IO**.
That document contains no recovery secret, private key or bootstrap packet.
Scope setup retains its separate immutable signed bootstrap and independent
random root. Independent recovery material is copied only for the operation and
cleared afterwards; account/device lifetime checks surround local/network steps.
The returned receipt binds the exact intent, resource, scope, inbox, statuses and
first checkpoint. Preparation alone leaves its local phase at `draft`/`prepared`;
only the subsequent product composition advances the later phases.

Read-only outbox custody explicitly verifies the new service and nested initial
directory/self proof; it is not an ignored service prefix. Content-only archives
can retain the creation document as inert history. Imported history cannot
execute it or restore its requested invitation permissions. The bootstrap self
proof verifier also now removes the proof from a detached mutable outer payload,
rather than attempting to delete a field of the deeply frozen snapshot.

## Required next composition

Create-space buttons now use the new composed path. It is still uncompiled and
untested candidate code. Preparation alone is never reported as a finished space;
an active private account is not routed through legacy plaintext creation.

1. Finish normal invitation acceptance/member-edit and recipient/device review
   under the current all-scope membership/rotation protocol. A pending invitation
   or keyless Google identity is not an approved content recipient.
2. Add new **project** preparation under the real parent/space topology. Current
   source/body contracts bind each project to its own crypto resource. It cannot
   be stored as a different project inside a space or parent's crypto scope.
3. Extend the composed web/native create/resume path to projects and inherited
   recipients, preserving foreground/IO dispatch, process-death custody, existing
   UI/defaults and all fourteen languages; then perform consolidated acceptance.

Important existing constraints for project creation:

- `genesisSharedCreateProject` inherits members, checks parent/category/board
  placement and applies the space owner's quota pool. Preserve those invariants.
- Persistent `e2ee-fence-v6` rejects ordinary content INSERTs under an active
  space. Do not turn that off or add a request boolean bypass. If technical fresh
  rows need admission, use an exact verified before/after capability scoped to
  the one transaction, like the existing membership `WeakMap`/SQL callback.
- `genesisE2eeAclTriggerJson` currently has a four-ACL-table allowlist. Any
  extension for exact fresh technical rows must keep membership route table
  validation and the complete device/role rotation requirements intact.
- No old rows, journals, originals, snapshots, receipt namespaces or keys may be
  removed to make a fresh controller succeed. Interrupted local source-stage,
  ambiguous legacy cancel and divergent-source review remain separate work in
  `security-336-retained-migration-history.md`.

Consolidated acceptance must cover atomic rollback, unknown/lost HTTP outcomes,
exact semantic retry across checkpoint renewal, ID collision, key/authority
mismatch, quota/billing changes, parent/inheritance concurrency, process death,
same-UID relogin/restore, both clients and all required UI/language/device states.
No test/compiler/lint/build/CI result is claimed by this document.
# Normal project composition continuation, 22 November

`private-project-create.ts` / `E2eePrivateProjectCreation.kt` now hold complete
encrypted input before network activity, retained topology/review history and
fixed setup/service intent. `project-create-selection.ts` and the native
counterpart compose actual independently pinned scopes and decrypted chosen
heads, verifying the directory frame, head hashes and pins again after reads.
Normal web/native create and account resume open a participant/role review before
recovery submission. Routing consent is separate from cryptographic device
approval and capsule distribution. Both remain necessary before recipient access.

Actual project migration/baseline precedes a single normal immutable transaction
for the intended private root and all five localized statuses. Exact bodies and
revision2 are read back, then the ordinary project result is loaded before the
creation journal completes. Content-only exports preserve inputs as inert
history, never as restored replay authority. A missing preparation receipt is
replayed even when setup had already completed from a directory read after a
lost response; its bootstrap hash must match the retained exact setup packet.

This is candidate source, not acceptance. No compiler/tests/lint/build/CI ran.
The started/preparation topology-change case still needs semantic resolution,
permanent cancellation of the old attempt, and explicit fresh review without
retargeting its packet. Full member/device/rotation integration is also pending.

