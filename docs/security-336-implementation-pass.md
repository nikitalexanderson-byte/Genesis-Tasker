# 3.3.6: implementation pass before consolidated acceptance

Latest owner instruction,21 November: final crypto review is performed by this
implementing agent after completing code, consolidated QA and repairs. The owner
explicitly removed a separate external report as a release/activation gate.
Record the result as internal AI review of the exact final commit/artifact;
never call it independent human assurance. Historical human-review gates below
are superseded. Full coverage/recovery/upgrade and all technical acceptance stay.
Plan: `security-336-final-review.md`. The original prompt bytes are unchanged.

## Scope setup, real editor capture and product controllers (22 November; candidate)

### Native dream and tracker input continuation (uncompiled candidate)

Dream journal/list and editor now register the current records, raw form,
baseline/revision, voice partial and pending final phrase, spelling state and
view controls. Dictation exposes whether patches are still pending. Mounted
unsettled inputs refuse local-work capture; detached originals remain inert
history even if a gesture or asynchronous operation was interrupted.

Sleep/mood and abstinence screens now capture their loaded workspace/revision,
open editor/action state and all five editor forms. Raw time/zone/score strings,
custom mood/emoji input, schedules/rules, original records and the in-progress
Today craving slider are retained. These forms use personal.local-work with
`execution: history-only`; they are not replayed as saves, deletes, scores or
reminders. Saving/loading or an active slider gesture blocks a mounted capture.
The owner is resolved from the authenticated UID and checked against the exact
hashed repository scope; it is never inferred from that hash. Sleep/mood state
is now keyed to the repository lifetime so an account switch cannot attribute
the preceding account's forms to the next owner.

This is source implementation only. No private-candidate tests, compilation,
CI or deployment ran. Accepted coverage stays9/20. Later consolidated QA must
check owner switches/disposal, raw invalid input, voice callbacks, loading/save
races, slider interruption and retry/cancel after E2EE_SOURCE_NOT_SETTLED.
Remaining native inventory includes embedded Aurora/Gno and advanced shared
forms; SAF lifecycle/generation custody and streamed cancellation remain open.

The separate urgent public website release is prepared in the
`paddle-web-20261122` worktree, PR42. Its CI checks the stable public/main source,
not this uncommitted security candidate. Do not credit those results to3.3.6
and do not publish this security diff with the public release. Preserve the
accepted international storefront and `/ru/` when integrating the new main.

Main `c29b76e33cc42160616b2df6f5eca61af94f6c63` is now integrated locally
into the security branch. Conflicts from the earlier public-language prototype
were resolved in favor of the checked public storefront and its routes/copy;
security entrypoints, recovery controls, service worker and bundled advice
assets remain. The integration is uncompiled and is not published by the
separate website Deploy. Its source checks do not validate this combined branch.

The static `web/main.tsx` now mounts the same product boundary, vault gate and
migration host as the alternative runtime. The explicit `genesis-app-content`
container allows the migration dialog to fence legacy editors and remount the
product only after successful cutover. This fixes missing real entrypoint
composition; it does not activate a pilot or a scope.
Only a migration for the same owner can suppress the web vault gate. The native
host remains a separate secure Dialog above the existing locked Surface; the
locked product tree stays unmounted during cold resume.

Native credential delegation now owns a one-shot in-memory request bound to
owner, UI instance and attempt, with an elapsed-time admission limit of two
minutes. It captures an independent recovery-kit copy and32-byte secret before
launching the system activity; no secret is placed in Intent or saved state.
ON_STOP clears editor input and active migration material while the explicit
system-credential request can return once. Expiry, cancellation/disposal and
owner changes revoke pending bytes. A resumed callback must claim the same
request and pass the foreground guard; stale callbacks cannot close a newer
controller. Memory wiping is best effort, not a guarantee about JVM copies or
execution while the OS suspends a process.

These changes are code candidates only. Consolidated acceptance still needs
credential cancellation/expiry, callback-before-resume, process death, same-owner
relogin, background during preparation/run and concurrent UI attempts, plus SAF
save/read lifecycle and generation attribution. No private-branch tests, builds,
CI, device actions or security publication were run. Accepted coverage stays9/20.

Added paired initial-scope setup with a durable immutable bootstrap packet,
independent recovery-authority verification, device self-proof, signed-directory
readback and preserved cancellation on native directory requests. Added a real
AEAD recovery probe, using the exact candidate root and separately supplied
kit/secret, before content-plan adoption/activation.

Web workspace captures now include current forms without changing ordinary
backup content. A typed registry connects diary, maps, Aurora/Gno, Stoicheion,
draws and advice/settings. Every mounted instance and detached input is retained
in personal.local-work as inert history. Blob/File/byte values are materialized;
unsupported values and moving sources refuse instead of silently serializing
to empty objects. The complete web factory composes all nine actual personal
source adapters plus archives and local work. Typed domain reconciliation does
not execute captured forms or external-copy intents.

Added web/native product migration controllers composing setup, source registry,
original-response capture/replay, streamed plan, shadow upload/readback, recovery
verification and persistent legacy denial. Cold web resume can inspect the
authenticated local journal without a legacy network bootstrap. Added a
synchronous public technical web write marker to the workspace, legacy task
journals/cache, document sealing, Physis mutation and shared-draft writes. The
service worker can attest that the migration tab is the only same-origin window;
the controller checks this at write-fenced phases and before migration commit.
Other tabs are never closed or reloaded by the agent/application.

Native now composes the actual personal source factories, closes a prepared
migration capability on background/logout and captures native task/diary/map
input through an owner/repository-bound registry. Additive SQL triggers also
deny legacy writes in account child scopes, including retained shared-map caches.

These are uncompiled implementation candidates. Remaining setup work includes
actual web/native setup/resume screens, final binding of every native editor
(especially embedded Aurora/Gno, dream/voice, trackers and shared advanced forms),
conflict/independent-Physis-key review UI, fully verified streamed cancellation
and original-device/revoked-device replacement. Single-window/preparation races,
marker lifecycle, cold resumes, all parser/crypto parity and descendant triggers
need consolidated acceptance. No tests, typecheck, lint, build, CI, push, deploy,
provider requests or device changes ran. Coverage remains 9/20, production
3.3.5/149, pilot/cutover off, update floors 0, Android deployment false.

## Explicit Google copy path (candidate, no QA)

Added web/native new-root retained copy intents, exact content/account/provider
review and one-use external consent for Tasks/Calendar. Personal editors and
shared task details use the separate copy path. Added a bounded backend service
and metadata-only receipts (migration133), independent of private-content reads
and legacy Google product IO. Calendar uses one deterministic external event ID;
uncertain Tasks outcomes reconcile the saved marker and never blindly insert
again. No real provider call/grant/config change was performed. Full boundaries
and unresolved provider/semantic/UI/translation acceptance:
`e2ee-336-external-google-copies.md`.

No tests/typecheck/lint/build/CI/push/deploy/device actions ran. This is candidate
code, not completed external integration, accepted coverage or a release.

## Shared aggregate queries, histories and maps (candidate, no QA)

Added a common web/native aggregate model for global task queries, saved-view
filters, civil-week/calendar-month relative dates, private/shared saved views,
view options and space search. Personal view content seeds only from its own
immutable migration table. Removed the duplicate shared_space_ui source from
space.content: that owner-only content remains in personal.local-work and must
not be encrypted under a space-member key.

Added immutable migration-original reads bound directly to the signed original
manifest, plus historical proof origins (actor/action/operation) on web/native.
Project notification feeds compose old audit content and verified new business
histories. Aggregate overview/unread counts derive actual content/read state;
read flags and watch overrides are a separate encrypted personal document,
seeded from bounded owner-only old technical read/watch metadata. Device-only
feed caches support offline reads after a successful authenticated capture.
Notification preference parity, due/approval-generated events and external
delivery remain unfinished; do not claim those channels work.

Added shared map model upserts/history and the actual web/native editor adapters.
Scope resolution distinguishes space-owned maps from project-owned maps; cross-
scope changes refuse until the reviewed transfer transaction is implemented.
Full new map intents, views and conversions persist under the new device root.
Old native conversion journals remain inert retained history, never auto-replayed.
Map-to-task conversion retains its source association and uses a deterministic
content identity for idempotency; an existing verified conversion is returned
without fabricating another creation. Native map quick approval now displays
an exact proposal review before signing. Shared conflict resolution, old local
draft projection, all advanced surface parity and transfer acceptance remain.

All changes are uncompiled candidate code. No tests/typecheck/lint/build/CI,
push/deploy/device actions ran. Accepted coverage9/20, incumbent3.3.5/149 and all
rollout gates are unchanged. The complete original scope is still outstanding.

## Content archives and native SAF continuation (candidate, no QA)

Added a web/native content-only archive codec with read-back verified new-root
safety copies, inert import retention and reopening retained archives. Local
snapshots remain explicitly partial. A separate remote capture enumerates every
active trusted/unlocked scope, materializes full file bytes rather than exporting
DEK-bearing manifests, retains immutable migrated/product histories, compares
catalogues before/after capture and refuses format overflow without truncation.
The catalogue is checked against protected observations and retirement floors;
it does not solve unseen-object omission on a fresh device. Other devices' unsent
drafts and migration input custody are not a portable content archive.

Native backup UI now uses a host above the vault gate. SAF persists only an
opaque selected URI or an already independently encrypted backup. Picker results
bind exact jobs; encrypted exports resume only against an exact destination
prefix and require full readback. Recovery keys/plaintext inputs are not spooled.
Process-death/provider permissions, size/capacity, account changes, parser parity,
all histories and local-capture concurrency remain consolidated QA targets.
Typed normal-repository restore, binary history browsing and Google Drive are
still unfinished. No tests/typecheck/lint/build/CI/push/deploy/device action ran.
Accepted coverage remains9/20;3.3.5/149 and all rollout gates are unchanged.

## Shared history, exact completion review and real files (candidate, no QA)

After ac386416, added a signed bounded product-history read on PHP/web/native,
reusing bootstrap/command/attestation proof verification. It reads immutable old
versions without changing live heads. Historical migrated table versions still
need composition with these new normal-operation histories.

Completion proposals now have actual web/native preview/review UI and a durable
exact-version decision before signing. Native task review uses the same product
model; the separate native mindmap quick-toggle path still needs explicit review
composition. Proposal counters with concurrent proposals remain a QA target.

Shared task attachments/images are now references inside the task's encrypted
signed body, so an approval binds the exact files. Association/source joins on
both clients preserve migrated bytes. New files use deterministic per-request
object coordinates and immutable encrypted queues, before the task transaction.
Explicit downloads use authenticated client decryption; the browser's decrypted
image URLs are ephemeral and revoked on lifecycle lock. Native file downloads
use the same model/Keystore channel. Full native image presentation, new-device
offline download caching, cancelled/process-death transfers and orphan retention
still require composition/acceptance.

Added a common bounded private task-query/sort implementation and custom-field
criteria. Cross-project/global query/overview, saved views, reports, group
creation, notices, policies/membership UI, bulk/cross-scope work and client jobs
are still unfinished. This is not accepted shared coverage.

No tests/typecheck/lint/build/CI/push/deploy/device actions have been run in this
implementation continuation. Production3.3.5/149 and all gates remain unchanged.

## Continued recovery, shared editors and consent (21 November, candidate code)

Still implementation-first: NO tests, typecheck, lint, builds, CI, push, deployment,
or device actions were run. Production remains3.3.5/149; accepted coverage9/20,
pilot/cutover off, update floors0 and GENESIS_DEPLOY_ANDROID=false are unchanged.

- The inherited uncommitted message-key/local-cell, assistant consent, independent
  messaging-route and random-key recovery-copy changes are preserved. They remain
  uncompiled candidate code, not accepted results.
- Android now retains a separately owner-secret-protected exact device bundle.
  Explicit hardware-key recovery uses a resumable new slot, preserves the old
  encrypted files/aliases/queues and retains original-root custody. It does not
  reinstate a revoked device. Shared provider capacity includes recovery/slot
  files. Credential invalidation, partial atomic files, concurrent slot changes,
  revocation and process-death acceptance remain required. Existing devices with
  no independently protected copy cannot be recovered by inventing a new root.
- Shared reads now compose durable local transaction batches in revision order,
  preserving offline edits without flushing during reads. Divergent branches
  require review. Web and the bundled native model use the same overlay.
- Added actual common workflow/planning/sprint, automation/template and discussion
  record paths; sprint completion retains exact unfinished-task outcomes in one
  batch. Custom-field preview binds the complete decrypted snapshot and input;
  a type change archives the original definition and keeps its values. Added
  bounded domain validators. Full advanced-domain parity, inherited definitions,
  quotas, histories, reports, cross-scope CRUD and client jobs remain unfinished.
- Fixed project-label source composition: association rows belong to the project
  body, rather than pretending that each association is a separately titled label.
- Added web/native fingerprint comparison and signed baseline-resume UI under
  account settings. Discovery verifies chain consistency but never accepts its
  own server-provided authority as a user trust decision. The comparison field
  is never prefilled. The14-language catalogue is candidate copy awaiting review.
- Optional dictated-phrase spelling now binds each disclosed external copy to
  the exact unlocked account and phrase; saved content/imports cannot recreate
  consent. The existing explicit spelling option remains the UI decision.

Next implementation work: finish shared advanced reads/history/proposals, real
file/map paths, roles/membership review and multi-owner coordination, creation,
client automation and cross-scope transactions; compose setup/migration/resume
with all captures; full content-only backup/import/Drive; private reminders and
background/deep-link behavior; explicit revoked-device replacement with retained
original custody; remaining Google-copy consent. Only then consolidated QA and
repairs and the final internal crypto review required by the owner's latest decision.

## Continued shared composition (21 November, uncompiled candidate)

- Added the actual common web/native shared content model and foreground
  gateways for project/space snapshots, tasks, comments, statuses, categories,
  labels, project lists and task lists. Authenticated product-context reads
  contain only identity/ACL metadata, independently of encrypted bodies.
- Complete user requests and prepared edits are retained under the new device
  root before upload. Repeated staging verifies the existing transaction rather
  than replacing its ciphertext identity. Explicit offline saves retain these
  requests. Shared API/cache/queue routing bypasses retired legacy storage;
  automatic flushing never interprets the captured old shared queue as new work.
- Shared baseline discovery/resumption can adopt already signed parts on a
  different trusted owner device. Each part is checked against the immutable
  migration sources and its actual encrypted version. An active baseline also
  requires its owner's signed complete manifest. Partial/missing/out-of-order
  sources remain explicit errors, without deleting local or remote originals.
- Space sources now include member-category titles. Historical permission JSON
  remains inert content; actual policy changes still require the independent
  signed membership/rotation transaction. The source catalogue has 62 tables.
- Rotation checks now include protected per-object observations of new objects
  and chunks, plus retained writer plans predating that catalogue. An unfinished
  writer plan blocks rotation. This concurrency boundary remains a QA target.

No tests, typecheck, lint, browser/native builds, CI, push, deploy or device
actions were run. Accepted coverage remains9/20; this section is code inventory,
not acceptance evidence. Production remains3.3.5/149 and all rollout gates stay off.

Remaining shared integration includes advanced filters/saved views, membership
and fingerprint UI, group creation, completion/review UI/policies, real file
previews, shared maps, planning/sprints/reports/templates/custom fields, bulk and
cross-scope transactions and client automations. Finish these and the remaining
backup/import/Drive, external-copy/message-key and lifecycle/recovery paths
before consolidated QA. Check offline read overlays, lost receipts/process death,
scope revocation, large inputs, native bridge and context freshness during QA.

## Shared domain/baseline composition following9d05e2f3 (candidate, no QA)

- A shared web/native record-body contract now binds exact source columns,
  project/space lineage, related task/comment records, file references and
  business metadata. Domain constraints cover tasks/checklists/statuses, custom
  fields, map parsing, dates and workflow metadata. History/import/standalone
  custom-field-value source rows do not become executable imports. Task custom
  values remain part of the validated task body. These parsers still need the
  full consolidated semantic/parity review across ALL advanced feature models.
- Added actual encrypted shared record repositories and source-to-index readers
  on both platforms. Every declared source table must be present with exact count
  and revision1; absence is an error. Existing source authors and trash state are
  retained; baseline deleted records are tombstones, not resurrected live tasks.
- Migration132 and the signed bootstrap protocol now stage bounded owner parts
  and atomically activate their complete technical index. Only a signed complete
  part manifest authorizes baseline heads. Both clients verify the corresponding
  historical owner signatures. Normal business mutation/index reads require a
  completed baseline. Historical completions are baseline content; new actions
  still use current roles/policies and fresh exact-version approvals.
- Web/native baseline coordinators retain all local parts before mutation,
  upload immutable ciphertext, verify real stage receipts, and commit only the
  complete expected count/part list. Preparation can resume from protected parts;
  no source or older plan bytes are deleted. Account factories cache the same
  scoped record/baseline capabilities and reopening a trusted scope no longer
  invalidates existing editors' scope clients.
- Reserved migrated table/path/file originals are now immutable. The original
  signed migration manifest has a verified client read capability; a new server
  list is not independently promoted into a trust anchor. Command response
  budgets now accommodate bounded signed bootstrap receipts on both platforms.

Still required before shared coverage can be accepted: actual legacy-compatible
UI/gateway CRUD composition across the full shared surface; dedicated shared-map
source bootstrap (its lineage source is not an ordinary relational table);
member-category private titles/source inventory; detailed review/policy/quota,
file preview, client automation and cross-scope transaction behavior; source
capacity/preflight and proof-storage growth; resumed baseline recovery from a
lost originating device. Owner/multi-owner membership review UI is still pending.
No tests/typecheck/lint/build/CI/push/deploy or device actions were run.9/20 is
still the accepted coverage, and production is still3.3.5/149 with gates off.

## Second continuation, 21 November — candidate infrastructure, no acceptance

Owner resumed the paused task and required continuation to the authorized3.3.6
release. Implementation-first ordering remains in force. No tests, typecheck,
lint, web/native builds, push, CI, deployments or real-device actions were run.
The public editorial metadata pin was authored from existing public sources;
that generation is not a build or an acceptance check.

- Added bounded checkpoint-bound active-head reads and web/native owner rotation
  builders. Each builder verifies the immutable current heads, signed historical
  device authority, remembered floors and the explicitly reviewed FULL recipient
  roster. Future roots are random, HPKE-wrapped only to survivors/recovery, zeroed
  after preparation, and never sent raw. Old capsules/history remain intact.
- Added web/native membership coordinators and real authenticated transports.
  Plans precede preview/crypto, complete expected scope sets are caller supplied,
  previews cannot silently approve recipients, and all affected rotations plus
  the owner's authorization are persisted before a membership mutation. Unknown
  outcomes repeat the exact batch; receipt confirmation follows the signed
  directory chain. This still needs the real shared membership review UI,
  multi-owner signature collection and complete trusted ACL/scope composition.
- Added technical Stoicheion state/grant service and migration130. Seeds/cards
  stay in immutable client ciphertext; the server separately checks feature
  access, original periods/attempts, per-card reveal windows and Elite+ rights.
  Existing legacy rows seed only existing technical limits, while their content
  opens from migrated encrypted history. Both web and native actual draw/timeline
  entrypoints now use the private product. Native avoids writing new private
  seeds/cards into the old Room draw document. Prepared intents survive unknown
  outcomes and have an explicit saved-operation retry.
- Added the public editorial metadata asset/pin, shared local advice selector,
  technical advice policy/issue service and migration131. Selection runs locally
  with category/topic affinity, lunar preparation, source/theme alternation,
  unseen rounds and existing editorial/age rules. The server enforces day/slot/
  collection caps against immutable ciphertext references, including existing
  usage; no private score, selected advice ID or body enters those commands.
- Added common web/native Advice product ports and actual gateway composition.
  Native uses the bundled common engine in a newly constructed network-disabled
  WebView with domain-limited native ports. Keys remain native. The UI cache and
  advice preference save path now use new-root storage after activation rather
  than being blocked by the retired legacy wrapper. Historical caches are kept.
- Added explicit pending-operation banners on web/native Advice and Stoicheion,
  using a shared14-language catalogue. Their discovery reads local protected
  plans; only a click retries a saved operation. No new independent reroll is
  inferred from a network failure.

All of this is UNCOMPILED/UNTESTED candidate code. Required consolidated acceptance
includes quota/time/translation parity, source/history projection, full lifecycle
lock behavior, the native headless runtime/bridge, lost receipts/process death,
membership CAS and real product entrypoints. New metadata is3.45MiB public data,
downloaded without account credentials; only its pin is added to the APK.
The9/20 accepted coverage boundary,3.3.5/149 production, disabled pilot/cutover,
update floors0 and GENESIS_DEPLOY_ANDROID=false are unchanged. Independent human
crypto review remains outstanding. The original prompt has not changed.

## Resumed implementation in the continuation chat, 21 November

Owner resumed after the handoff and a short pause and reaffirmed the full original
prompt: complete all infrastructure/product code first, consolidated testing and
repairs second, then the authorized releases. No subagents, Daybreak, tests,
typecheck, native/web builds, push or deployment have been started in this pass.
All additions below are candidate code, not new accepted coverage.

- Async domain validators now finish before a document is stored or returned.
  The aggregate baseline/explicit-review format has a native counterpart.
- Web and bundled native Aurora use that format and the same async session/result
  validation. New paid results use immutable signed client-ciphertext references;
  independent server payment/plan checks remain in the billing path. Migration128
  adds the reference table without reopening the retired legacy-result endpoint.
- Web Physis has a foreground private model using existing health validators,
  durable queues/tombstones and device-root form history. Its existing page opens
  through the private account instead of the account-key vault. Independently
  keyed local content export reuses the existing backup codec and consent/key UI.
  Public reference catalogue administration has a separate narrow service route.
- Workspace sources on both clients now retain the previously omitted private
  visibility/category-routing fields. Raw originals are preserved. New private
  preference projections cover advice, layout and routing without changing
  identity, subscription or linked-account authority. Persistent server fence v5
  includes all routing fields. The native public profile cache uses a separate
  metadata scope and excludes these decrypted preferences.
- Enrollment renewal verifies the signed directory first, renews login-bound
  challenges and retains prior exact packets. A lost successful receipt is
  recovered by checking the same enrolled device keys; device/local-root identity
  is not regenerated. Cancellation remains cancellation.

These paths have NOT been compiled, tested or release accepted. The9/20 accepted
boundary, production3.3.5/149 and disabled gates remain unchanged. The remaining
implementation still includes shared authorization/CRUD/rotation/automations,
Stoicheion/advice live paths, setup/migration/resume UI, external-copy consent,
message-key lifecycle, content-only import/backup/Drive, reminders/background,
native-key invalidation recovery and the retained-history/archive growth policy.

Further candidate infrastructure in this continuation (still NO QA/build):

- Shared business versions now have an immutable ciphertext namespace, a durable
  local multi-entity intent and an independently authorized server commit.
  Migration129 contains technical indices/history/proposals/attestations/intent
  receipts. Completion approvers sign the proposed exact ciphertext version.
  Both clients verify the index against historical signed directory checkpoints,
  original business commands and all required approval signatures. This still
  needs real per-domain readers/editors, source-to-index initialization, full
  review-policy/quota behavior, automation and cross-scope operation composition.
- Explicit group-authority fingerprint decisions live inside the member's
  personal vault and can open only that verified group. Native account scope
  capabilities and web clients clear their retained roots on lifecycle lock.
- Editor state2 replaces the fixed total1024-snapshot stop with authenticated
  linked history pages. Every potential prepared upload has a durable origin
  claim before crypto. Coalesced intermediate content remains accessible through
  history pages; no old draft bytes are pruned. This is a growing retained history,
  bounded by actual provider storage, not a promise of infinite disk space.
- Membership infrastructure is being composed: exact-row SQL guard capabilities,
  owner metadata preview, signed complete affected-scope batches and a distinct
  rotate-membership directory event. Persistent fence v6 includes this stricter
  path and the private routing fields. Client generation/custody/entrypoints,
  device recovery and end-to-end role/rotation acceptance remain required.

The source prompt, accepted coverage and production state have not changed.

21 November 2026. Owner instruction: finish the remaining code across web, API
and Android first, then run consolidated acceptance, then repair its findings.
Do not restart a complete test/build cycle for each helper or small edit.

The original implementation prompt remains the specification. Current production
is 3.3.5/149; no activation, update floor or deployment is justified by this pass.
The completed custody build04 has the same main APK as build03. Its device cases,
cross-platform vectors and final native lint are deferred to consolidated QA.

Implementation order:

1. Finish personal archives, materializing old local/account ciphertext while
   its authenticated opening capability is available. Preserve retained variants,
   forms, selected files and uncertain receipts as non-executable history.
2. Implement the remaining personal/project/space source adapters, including
   unmounted work and actual file transport. Bind reads to exact authorized scopes.
3. Connect full source registries, staged planning, normal readers/writers,
   enrollment/recovery and shared membership/rotation to the product.
4. Complete backup/import/Drive and client execution of private automations;
   retain explicit consent boundaries for external providers.
5. Run the release acceptance matrix once against the composed implementation,
   repair real defects, then perform the authorized separate releases.

Coverage counts are updated only for composed source scenarios. Passing primitive
tests does not close a category. Missing key/source/provenance is a blocking error,
never an empty category. No dummy adapters or silent legacy fallback are permitted.
Review performed by this agent is internal AI review, not independent human review.

Code added in this pass (NOT yet tested or release accepted):

- Personal archive source composition on web and native, authenticated old-key
  materialization and keyless native/common reconciliation. Native forms retain
  selected file bytes while recovery input is excluded from portable output.
- The remaining ten source paths share an explicit61-table schema catalogue,
  exact backend read grants, signed1MiB row fragments, complete EOF/hash checks
  and real attachment conversion into the existing new-key file protocol.
- Read-only web localStorage/IndexedDB and native Room/SharedPreferences/journal
  collectors, including expired caches and closed editor records. A registered
  source is composed with staged capture/reconciliation; no placeholder adapters.
- Journal protocol5 adopts a complete state4 plan by CAS, retains the original
  state/ownership, and implements upload plus bounded shadow readback and commit
  on both clients. Crypto/writer protocols and production gates are unchanged.
- Product migration controllers and captured-response replay ports compose the
  existing feature adapters with that path. Normal product document/table services
  use the existing encrypted editor queue and preserve explicit conflicts/offline
  copies; they never fall back to legacy HTTP after an online error.

Still to implement before consolidated QA: bind controllers/repositories and
recovery/enrollment to actual product entrypoints/editors, finish per-resource
local draft ownership/materialization, archive Physis opening and import files,
client automation execution, shared approval/role/rotation flows, backup/Drive,
and lifecycle routing. Review partial HTTP read recovery when composing the driver;
partial source originals must remain retained without becoming completeness proof.
The9 accepted source categories are not relabeled20 accepted by these code edits.
No new tests, lint, native builds, push/CI or deployments were started in this pass.

## Product integration continuation, 21 November (candidate code, untested)

Owner reaffirmed: the remaining code comes first, consolidated testing second,
then repairs. The following additions are not acceptance evidence and do not
change the9/20 accepted boundary, production3.3.5/149 or any activation gate.

- Corrected the table/index domain for project/space mindmaps consistently in
  web, native reconciliation and native bridge result validation. The original
  shared-project choice was incompatible with those paths' mindmap domain.
- Read-only editor inventory aborts creation of an absent IndexedDB database.
  Selected File/Blob and byte values now have bounded portable content instead
  of JSON.stringify's empty File objects. Relational server paths no longer each
  duplicate the whole local-work inventory. Native scope lookup also checks the
  actual nested payload/project/space metadata of expired offline caches.
- Archive materialization distinguishes Android's native mindmap array and
  diary object from the web's frozenStorage key map. The archive/Physis changes
  retained from the previous checkpoint remain part of this untested pass.
- Added the web foreground account capability: verified scope discovery,
  independently entered secret, durable device unlock, owner recovery enrollment
  with exact challenge/self-proof, retained signed request before HTTP, signed
  directory verification and lifecycle locking. Added a matching native account
  capability using the existing authenticated channel and system credential key.
- Connected the web identity observer, workspace bootstrap, tasks, workspace
  persistence, timer/history actions and ordinary polling to the private product
  channel. A protected account cannot load the old plaintext workspace as its
  active view. Actual destructive handlers await encrypted persistence.
- Added a common personal-product-live-v1 CAS document for workspace, tasks and
  tombstones. Initialization requires both authenticated migrated seed documents;
  it never creates an empty account after a failed read. Existing migration task
  records remain history; a separate live task seed is now emitted by both source
  runtimes. Normal private task writes do not execute old Google projections.
- Added root-level web/native unlock surfaces and one shared14-language recovery
  copy catalogue. Native protected scopes are remembered by hashed local scope;
  old workspace content stays unmounted before system unlock. Android lifecycle
  background/sign-out retires its capabilities. No new UI acceptance has run.
- Native task/project/list/habit/tracker repositories now have real product
  readers/writers using the existing model codecs and business mutations. The
  private account sync branch bypasses old HTTP permits. Retired native mutation
  paths fail closed instead of writing the old store for a protected scope.
- The actual web personal mindmap repository now routes current content, saves,
  tombstones, history, views and conversion journals through new-root storage.
  A clean-device content reader explicitly distinguishes absent device history
  from an empty journal; it does not replay old conversion receipts.

Remaining implementation includes: complete setup/migration/resume UI wiring,
offline/expired-identity acceptance, expired enrollment challenge renewal, invalidated-keystore
recovery/custody integration, explicit conflict review, the other feature editor
routes (including diary/Physis/Aurora/stoicheion/advice), shared transaction and
approval/role/rotation semantics, external-copy consent, content-only backup /
import / Drive, complete per-scope draft attribution and nested archive pins.
Native reminders/background/deep-link projections must be composed with the new
repository routes before acceptance. The aggregate product documents also need
the consolidated concurrency, history-growth and quota scenarios. They are not
asserted to pass those scenarios or to replace shared multi-table semantics.

No tests, typecheck/lint, builds, push/CI, device installation or publication were
run for these additions. Compilation and the complete acceptance matrix remain
deferred until the full implementation pass, as the owner requested.

Local checkpoint `ddaa43e3` saved the foreground/product integration above. It
was not pushed. Subsequent candidate code adds explicit saved-copy offline unlock
on both clients. The locator is encrypted in the device vault; cached identity
is display metadata, not a recreated HTTP session or authority. Online errors do
not select the offline path automatically. Pending edits remain in the existing
new-root queues until an explicit online unlock. New offline labels/explanations
were added to the same14-language catalogue; their acceptance is still pending.

The native foreground entry now starts private queue flushing independently of
the old Room outbox/Google connection. The web task poll likewise runs for a
private GENESIS account without external-calendar sync. Vault-ready events refresh
existing observers. Device-unlock attempts are bound to a native lifecycle epoch:
backgrounding cancels even an in-progress, not-yet-registered capability.

Product writers reload the durable editor queue after acknowledgement rather
than retaining its pre-ack serial. Divergent local content is an explicit conflict.
The native domain codecs use a separate contentRevision; a network receipt's
journal update must not make an unchanged project form appear edited. Context
object revision, directory epochs and local journal serial stay distinct.

Added a product-only reader for active migration local contents, validating the
exact staged scope, owner/device, generation and planning ownership. It distinguishes
a clean device from a corrupt/missing part of an existing journal. Diary and other
history consumers still need composition with this reader.

Until private reminder projections are composed, native startup/resume scheduling
does not open the retired protected workspace. This is a temporary unaccepted
implementation boundary, not a claim that private reminders are complete. Also
finish the remaining optimistic web editor closures so that acknowledgement
requires durable encryption before dismissal/backgrounding. No additional category
is marked accepted by these edits. No tests/builds/CI/deploy were started.

## Diary integration continuation, 21 November (candidate code, untested)

Continued the owner's implementation-first order. This checkpoint is code, not
acceptance: accepted source coverage remains9/20, production remains3.3.5/149,
all cutover/update gates remain unchanged. No tests, typecheck, lint, build,
push/CI, device installation or deployment have run for this continuation.

- Connected actual web and Android diary repository entrypoints to the same
  `personal-diary-live-v1` document/schema. Device-only notes, drafts and promotion
  tickets use a separate new-root document with no transport/flush capability.
  The original local migration journal is validated against owner, scope, device,
  source registry, generation and planning ownership before opening its contents.
- Disabling sync requires online review, durably copies active notes and drafts
  locally first, pauses device uploads, then tombstones the remote active notes.
  Explicit re-enabling persists new promotion IDs before sending and retains the
  source until acknowledgement. Existing migration originals remain history.
  Retention of historical server ciphertext is not a promise of physical erasure.
- Native saved editor state now references a new-root local draft, including
  blank in-progress forms, instead of the retired account cache key. Form changes
  schedule encrypted staging; close/save still await durable storage. A locked
  saver can retain a previously staged pointer, not start legacy encryption.
- A shared14-language notice distinguishes local history absent on this device
  from empty content. The original device's incomplete/corrupt history blocks
  initialization; a clean device can read committed remote notes explicitly.
- Added narrow authenticated read-only private-service endpoints for dream clock
  and voice entitlement. They accept no diary text/key/settings and do not reopen
  the retired diary content route. Payment/identity authority stays outside imports.
- Added a bounded64MiB device-document format with256KiB ciphertext chunks, digest,
  authenticated manifest and atomic root/slot CAS on both clients. Fixed slots
  bound disk growth across edits instead of retaining a new orphan part set for
  every form change. Concurrent reads/edits fail explicitly rather than overwrite.
- Normal product reads recover a previously sent operation by its exact receipt
  identity, without sending an unsent write. Unchanged acknowledged reads no longer
  append redundant editor history on each poll. Actual edits retain their history.
- Web diary views are recreated after unlock and guarded against late callbacks
  from a previous repository/account. Native private mutations bypass the legacy
  owner permit and still use the account/lifecycle capability and repository mutex.

Still pending in this code pass: complete explicit conflict-review actions for
aggregate product documents (including prepared upload cancellation/replacement),
native mindmap product routing, remaining Aurora/stoicheion/Physis/advice/preferences
entrypoints, setup/migration/resume composition, shared business transactions and
authorization, external-copy consent, content-only backup/Drive/import, remaining
per-scope local-work attribution, reminders/background/deep links and enrollment /
invalidated-keystore recovery. Do not treat the new diary route or metadata tools
as accepted scenarios before the consolidated end-to-end review and repair pass.

## Explicit pause and handoff, 21 November

The owner asked to stop work and continue in a new chat. Implementation is paused;
no background work, testing, builds, push, activation or release was started.
Resume only after a new instruction. Handoff: `docs/security-336-handoff-2026-11-21.md`.

Local checkpoint `cbd1cef9` contains the diary continuation above. The subsequent
untested code checkpoint adds native personal mindmap routing (current documents,
authenticated migrated image bytes, versions, views and new conversion drafts),
explicit preservation of conflicting maps as copies, and durable reviewed-merge
intent in both editor queues. Cancel/replace retains the old packet identity;
read-only receipt recovery does not upload an unsent edit. These new conflict
and migration paths still need consolidated concurrency/process-death review.

Also added `E2eeFeatureDocument`, storing the exact baseline of the first pending
edit within its encrypted document, and connected the actual web restoration
repository to its migrated stoicheion workspace seed. Aurora integration was
only inspected when the owner paused: no Aurora/private-result bridge was added.
`validateDocument` for Aurora is async; do not pass it as the current generic
feature driver's synchronous validator without adapting the implementation.

The code remains uncompiled and untested. No additional category is accepted;
production remains3.3.5/149, accepted coverage9/20, activation gates unchanged.
