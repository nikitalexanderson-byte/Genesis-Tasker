# Private data paths and activation coverage

18 November 2026. Canonical machine-readable inventory:
`contracts/e2ee/private-paths-v1.json`. Web imports that file and Android packages
the same file as an asset; there is no separately maintained native category list.
`app/e2ee/migration-sources.ts` and native `E2eeMigrationSources.kt` enforce its
required path IDs. Missing adapters fail before the first partial capture. The
registry does **not** mean that feature adapters have been implemented.

Status19 November: nine real source categories are implemented on web/native;
the remaining eleven and full product integration are required. Physis and
reminders now have retained-source capture/reconciliation and new-root readback. The system
acceptance remainder is tracked in `security-336-acceptance-matrix.md`.

| Required path | Existing source, format and current reader | Target / migration evidence still required |
| --- | --- | --- |
| personal.workspace | Web localStorage JSON/base + account-key AES-GCM workspace; native LocalCipher Room documents; backend can open legacy workspace key | Real web/native adapters and native SQLite barrier implemented; selected actual Room/Keystore/API26 process-death cases pass; product routing, web multitab fence, older-format review and full upgrade/lifecycle acceptance remain |
| personal.tasks | Web task cache/mutation journals; native encrypted tasks + Room outbox; server tasks/links/deletions/creation receipts | Real web/native source and signed owner-only read preserve all7 server task/history tables, exact offline edits/deletions, recurrence/detached identity, recovered content and inert creation history. Actual source/coordinator/new-root JS, Chromium IndexedDB and API34/35 Room/Keystore/packaged-engine cases pass. Raw queues/keys stay local, new record IDs are random, external copies need new consent. Product editor/review/consent routing, full authenticated inventory, API26 compatible-provider and direct-upgrade/recovery acceptance remain |
| personal.diary | LocalStorage encrypted notes/drafts plus settings/deletions/dream metadata; native DiaryRoomStore; server diary tables | Real web/native capture and shared strict reconciliation/readback preserve all6 tables, current/dangling chunks, old pending notes, private local-only placement and mounted drafts. Actual Chromium coordinator/recovery/retry and API34/35 Room/Keystore/packaged-engine cases pass. Product lock/cutover/editor routing, normal writes, explicit conflict UI, older formats, archives/local-only backup and full upgrade/lifecycle acceptance remain; see e2ee-336-diary-implementation.md |
| personal.mindmaps | LocalStorage maps/cache/view/conversion/request journals; encrypted native documents; server map/version/deletion/receipt rows | Real web/native capture and reconciliation preserve all retained versions, images, closed-tab drafts, pending requests, view/conversion journals and mounted edits. Chromium coordinator/recovery/readback, API34/35 large histories and source recovery after late old-key loss pass; see e2ee-336-mindmaps-implementation.md and e2ee-336-retained-native-old-keys.md. Product routing/review/normal writes, larger local captures, supported-provider API26, clean recovery and direct upgrades remain required |
| personal.physis | Legacy password vault and account-v2 vault; retained web memory stores/forms/queues/rotation; server records/IDs/receipts. Current Android has no Physis editor/repository; its local unavailability never means empty server data | Real web/native source preserves all4 server tables, exact uncertain requests, old/both rotation keys in protected input only, 44 mounted/detached form readers, tombstones and all conflicting variants. Chromium forms/IndexedDB/signed-coordinator/cold-recovery and API34/35 Room/Keystore/packaged-source/large local history readback pass; see e2ee-336-physis-source.md. Bootstrap/unlock/first reload now share an owner permit. Full product freeze/review/normal new-format editors, restored forms, supported-provider API26, archives/clean recovery/direct upgrades and maximum aggregate sizes remain |
| personal.aurora | Encrypted cache/base/pending document, personal learning and removed sessions; native documents; server workspaces/model results | Real web/native capture and shared validator/merger implemented; actual Room/Keystore/packaged WebView cases pass with immutable sessions/results and writer history; product routing, source conflict UI, older-format review and optional assistant disclosure remain required |
| personal.stoicheion | Encrypted restoration workspace plus draw/timeline records and local pending choices; native documents; server draw/session/card rows | Real web/native practice journals and draw/timeline history adapters implemented; shared validator and actual Room/Keystore/packaged runtime cases pass. Product routing/source review/older-format acceptance remain; billing and live reroll authority are never imported |
| personal.advice | Saved personal advice/selection state and metrics in memory/cache/server rows | Real web/native adapters and signed owner-only history read implemented. Actual Room/Keystore/packaged source cases pass on API34/35, storage fences on API26; raw v1/current/history/mounted copies and all exact public-language editions are retained. Unknown v1 provenance blocks reconciliation; default full inventory review, account-entry private copy, large histories, product routing and recovery/upgrade acceptance remain. Public art/catalogues remain public |
| personal.local-work | All owner-scoped localStorage/IndexedDB caches, shared editor drafts, conflict choices and pending mutations | Enumerate unmounted editors too. Snapshot first; retain every prior migration attempt; reconcile content without restoring sessions/rights |
| personal.reminders | Exact web owner keys/worker receipts/forms; native Room reminders/5 registries/raw moon settings; all6 retained server schedule/history/preference tables | Real web/native source preserves history/forms/uncertain actions under the new root as device-local inert history, with private shared preferences remote. Chromium29 checks, API34/35 packaged source and bootstrap/reminder22 cases each, API26 guards17 cases pass. Fresh delivery consent, product routing/restore forms, true push, API26 compatible provider and full lifecycle remain; see e2ee-336-reminders-source.md |
| personal.archives | Encrypted safety/held copies, personal export/import staging and history; native backup documents | Signed owner-only retained server reader and bounded 1MiB row fragments implemented for all3 backup tables; this is not a source adapter. Web/native local capture/transport/reconciliation/new-root readback, current-generation archives, clean recovery/Drive and content-only import remain; see e2ee-336-archives-source.md |
| project.content | Server-readable encrypted projects/tasks/checklists/comments/labels/dependencies/review/planning; native/web caches | Signed project roster with per-role checks; private fields encrypted for approved participants; client queries/merge preserve existing features |
| project.files | Shared task images/attachments and derived previews/filenames | New file keys/chunks/manifests in actual file paths, not only a standalone cipher test; truncation/pending upload/recovery/orphan cleanup |
| project.mindmaps | Shared map versions/conversions/deletions in project + space inherited ownership | Preserve images/history/tombstones and correct scope ownership; no cross-scope cached client |
| project.automation | Series/instances, automation rules/run payloads, workflow definitions/history | Private rule execution on an authorized client, deterministic durable jobs; legacy server workers must exclude active/migrating scopes |
| project.history | Activity, plans/reports, trash, bulk/import/transfer/template-source snapshots | Encrypt content/history without importing ACL; preserve dependencies/source IDs and explicit retention |
| project.local-work | Project editor journals in localStorage/IndexedDB and encrypted native documents/outbox | Durable repeated edits, exact immutable uploads, encrypted conflict resolution; feature adapters remain required |
| space.content | Space content/covers/labels/categories/templates/fields/history/views/imports and personal UI records | Correct space/project/personal ownership, signed grants and role enforcement; atomic ACL change plus all affected rotations |
| space.mindmaps | Space-owned maps and associated versions/files/conversion/deletion journals | Distinguish project-owned maps; preserve all inherited references/history |
| space.local-work | Unmounted space editors, templates/fields/workflow/planning/import drafts | Explicit inventory and adapters; no reliance on currently mounted React components |

The newly discovered server-side Google files now participate in the exact
owner-scoped source token and signed task read/reconciliation on both clients.
Current and retained snapshots preserve tasks/list history without credentials;
historical provenance requires explicit review. Product review/deletion lifecycle
and streaming acceptance remain incomplete; see
`e2ee-336-provider-cache-implementation.md`. Nine real source categories do not prove every
account's complete data inventory or permit product activation.

The JSON lists the concrete repository sources and SQL table families. Native
source paths in the inventory are relative to
`android/app/src/main/java/ru/genesis/calendar/`; server entries are table names.
Cross-owner rows require all relevant scopes, as reflected in the backend guard
inventory. A project cutover does not silently assert that its parent space or
another participant's device has migrated.

The first actual `personal.workspace` web adapter is `app/e2ee/workspace-source.ts`,
supplied by `createPersonalWorkspaceMigrationSource` in cloud-sync. It captures
persisted/unmounted workspace queues and actual cloud memory before network;
the caller must capture mounted editor memory and supply the coordinator fence.
Its output is a canonical workspace plus encrypted historical relational content,
never a raw-key/HTTP bundle. The legacy source reader explicitly selects only
owner rows, requires the signed current device and exact live migration lease,
and cannot read an active scope. It does not reuse bootstrap/Google enumeration.
Unattributed sources, changed earlier attempts, conflicting mounted/persisted
bases, unsupported old/future tracker formats and lossy event projections still
block this adapter. Its presence does not mean product cutover or native Room
acceptance is complete. The native source/factory now reads4 real Room document
kinds and their exact outbox under a transaction, includes portable plaintext in
the protected snapshot and never acknowledges old work. Accepted/pending reset
generations, base revisions, deleted IDs and explicit conflict choices are checked
on both platforms. The real Aurora adapter also captures all writer histories and results on both platforms; see `e2ee-336-aurora-source.md`. The real Stoicheion practice/draw-history source is also implemented on both platforms; see `e2ee-336-stoicheion-source.md`. Advice, personal tasks, diary, mindmaps, Physis and reminders also have real sources on both platforms; see their implementation documents. Nine real categories are implemented; all11 others and full product integration remain mandatory.

Native Room now has an additive schema1→2 migration and technical deny table.
Persistent triggers cover I/U/D of all4 legacy data tables in each explicit
bound storage scope, including moves and REPLACE. No account is fenced merely
by upgrading. The owner/session/unlocked-device factory can provide the barrier
to the migration coordinator; product activation is still absent. Old network
workers must also be excluded before external I/O, and shared child scopes need
their own bindings. Instrumented API26 evidence includes real Keystore key loss,
exact source retention after migration and host process kill, never a personal
device update or full system acceptance.

The source registry captures local bytes without network writes or deletion.
`E2eeMigration.prepare()` is responsible for durably protecting that complete
snapshot before any reconciliation/network call. Reconciliation receives all
previous protected snapshots, rejects duplicate output object identities and
restricts each adapter to its declared content domains. The server cannot prove
plaintext completeness: actual adapter validation, manifests, recovery/readback
and acceptance tests remain mandatory.

Coverage path IDs (`personal.tasks`, etc.) are distinct from crypto domains
(`workspace`, etc.). Both coordinators use `requiredCoverage` for exact path
completeness and `allowedContentDomains` for encrypted output. A full registry
regression reaches active and then reads a migrated shared comment through the
normal scope client on web and native. Canonical `remoteDomains` are checked
against actual PHP policy. Shared local-work emits normalized authorized content;
its `localDomains` identify protected local queues, not new server permissions.
Each snapshot is capped at64MiB; previous input and output each have an
aggregate128MiB budget checked before copying.

Local legacy keys needed for conversion may exist only in the protected local
source snapshot. Content adapters must emit newly encrypted user content, not
upload session cookies, provider tokens, billing evidence, device approvals,
shared ACL or raw legacy-key bundles. The registry has no restore-authority API.
Old keys/copies and offsite backups are retained until a separately approved
retirement plan and successful restore drills.

Existing private messages keep their independent protocol/history. Their
non-exportable browser CryptoKeys cannot be serialized as JSON and called a
recoverable backup. Migration and lifecycle handling for their local key store
remain a separate explicit integration task; forward secrecy is not claimed.

`contracts/e2ee/server-schema-v1.json` separately classifies all218 actual SQLite
tables through migration127, including every column. Acceptance checks the whole
actual schema, so an undeclared table/column cannot disappear outside an already
declared fence list.106 legacy-private tables have persistent INSERT/UPDATE/DELETE
fences. This is schema disposition, not proof of complete feature integration.

The copied-content inventory includes backup stages/safety snapshots/receipts,
advice notification days/deliveries, shared preferences, bulk definitions and
automation/template/custom-field/planning/mutation receipts. Multi-project copies
use set-valued predicates: every explicit historical reference and a conservative
superset of the author's current project memberships. They never choose one
arbitrary project. This superset is only a deny/source-revision boundary; it must
NEVER authorize reading/exporting another project's content. Former-member view
receipts retain explicit spaceId/space_id and parents of resolved project refs.
Legacy retirement remains a separate reviewed plan; missing purged historical
provenance cannot be presented as newly encrypted history.

Six private preference/reference fields in users have targeted fences/source
hashing. Identity, billing and technical columns remain independent authority.
Member-category titles are mixed with authoritative permissions; archives must
whitelist content. Existing messenger conversation titles are explicitly marked
as pending content integration, separate from the existing message ciphertext
protocol. VK/Yandex copies remain explicit external boundaries. Modeling checkout
requests contain payment metadata/result IDs; their content solution is in the
separately classified private results table.

Scope-aware housekeeping uses the same predicates as persistent fences. Protected
staging/history/metrics are retained, legacy rows expire normally, and a protected
shared cascade rolls back only its own item and counts. Corrupt historical receipt
JSON is retained for investigation, never treated as an empty ownership binding.

Controlled legacy pages are additionally protected by the service-worker private
transport boundary and product controller-version preflight, with a conservative
global deny for unidentified requests. The common bundle/policy are checked and
precached; `e2ee-336-service-worker.md` records the13 real-worker checks and pending
uncontrolled/restored-page/local-writer lifecycle. It does not grant source reads.

Personal legacy transport classification/guards are now connected to the actual
web and Android HTTP clients, with per-owner durable deny markers and a checked
deployable PHP policy resource; see `e2ee-336-legacy-transport.md`. No marker alone
claims full writer coverage: old tabs/SW, non-Room sources, shared transports and
direct external spelling remain explicit integrations, not hidden exceptions.

All feature adapter rows above are pending product integration. Current focused
registry tests prove missing-path/forked-source/duplicate-output/incomplete-path
rejection and snapshot preservation; they do not replace the original 48
acceptance scenarios or establish full content coverage. Production flags/floors
remain disabled.

The actual web diary, mindmap, Aurora and independent restoration repositories
now use owner-scoped operation permits through their local encryption/journals,
borrowed HTTP and response cleanup. Mindmap immediate staging is a separate
completed operation from its queued upload; migration between them retains the
draft. The native Aurora bridge holds an exact native capability across RPC and
Room calls, invalidating/draining on close. Shared map owner permits protect the
member's local work, not the project's or space's own fence/ACL. Other sources,
other feature draft inventories and full adapters still need integration. Aurora
and the independent restoration archive now have append-only per-writer journals,
closed-tab reconciliation and portable backup copies of every retained snapshot;
different archived writer heads require an explicit restore choice. See
`e2ee-336-operation-fences.md`; this is writer exclusion, not complete diary
product routing or migration-time protected editing.
