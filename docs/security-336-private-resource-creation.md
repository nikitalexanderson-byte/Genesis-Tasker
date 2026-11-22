# 3.3.6: fresh private resource creation (implementation in progress)

22 November 2026. Candidate source only, no compilation/QA/publication. Accepted
coverage remains9/20. Existing production3.3.5/149/Paddle website, floors0, cutover
off and GENESIS_DEPLOY_ANDROID=false are unchanged.

## Implemented preparation

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
first checkpoint. Its local phase is only `draft`/`prepared`, never completed.

Read-only outbox custody explicitly verifies the new service and nested initial
directory/self proof; it is not an ignored service prefix. Content-only archives
can retain the creation document as inert history. Imported history cannot
execute it or restore its requested invitation permissions. The bootstrap self
proof verifier also now removes the proof from a detached mutable outer payload,
rather than attempting to delete a field of the deeply frozen snapshot.

## Required next composition

This is **not wired as the finished create button**. Do not report a new space
ready after preparation or route an active private account through legacy create.

1. Generalize the existing personal migration controllers for shared targets and
   the matching signed source catalogues, preserving each target/actor/fence.
2. Migrate both the space and its technical inbox through the actual source,
   recovery/readback and product-bootstrap sequence. The encrypted input supplies
   the intended initial title/description/cover without overwriting sources.
3. Write/read back initial private domain values; then apply the explicitly
   intended invitation/membership workflow under current rights and quotas.
   A keyless Google account is not an approved recipient.
4. Add new **project** preparation under the real parent/space topology. Current
   source/body contracts bind each project to its own crypto resource. It cannot
   be stored as a different project inside a space or parent's crypto scope.
5. Compose actual web/native create/resume UI and local pending-input registry,
   with foreground/IO dispatch, lock/background clearing and current request
   ownership. Preserve existing UI/defaults and all fourteen languages.

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
