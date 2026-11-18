# Private data paths and activation coverage

18 November 2026. Canonical machine-readable inventory:
`contracts/e2ee/private-paths-v1.json`. Web imports that file and Android packages
the same file as an asset; there is no separately maintained native category list.
`app/e2ee/migration-sources.ts` and native `E2eeMigrationSources.kt` enforce its
required path IDs. Missing adapters fail before the first partial capture. The
registry does **not** mean that feature adapters have been implemented.

| Required path | Existing source, format and current reader | Target / migration evidence still required |
| --- | --- | --- |
| personal.workspace | Web localStorage JSON/base + account-key AES-GCM workspace; native LocalCipher Room documents; backend can open legacy workspace key | Client-only workspace objects, complete three-way merge for every habit/tracker/timer/history/reward collection |
| personal.tasks | Web task cache/mutation journals; native encrypted tasks + Room outbox; server tasks/links/deletions/creation receipts | Preserve all GENESIS tasks, recurrence, detached occurrences and tombstones; separate Google/Yandex copies and unsent external operations |
| personal.diary | LocalStorage encrypted notes/drafts plus settings/deletions/dream metadata; native DiaryRoomStore; server diary tables | New root for notes/dreams/references/settings/files; test offline drafts, conflicting edits, deleted advice notes and disabled sync |
| personal.mindmaps | LocalStorage maps/cache/view/conversion/request journals; encrypted native documents; server map/version/deletion/receipt rows | Maps, images, complete history and conversion-task references; no omission of unmounted maps |
| personal.physis | Legacy password vault and account-v2 vault; active web memory store includes unsent queue/rotation; native encrypted documents; server records/IDs/receipts | Independently unlock every source, reconcile rotations and deleted IDs, re-encrypt account-known descendants; a locked source cannot be called empty |
| personal.aurora | Encrypted cache/base/pending document, personal learning and removed sessions; native documents; server workspaces/model results | Preserve immutable sessions/results; explain optional assistant disclosure separately |
| personal.stoicheion | Encrypted restoration workspace plus draw/timeline records and local pending choices; native documents; server draw/session/card rows | Private selections/history move with content; billing/reroll quota authority cannot be imported or forged |
| personal.advice | Saved personal advice/selection state and metrics in memory/cache/server rows | Private selection/preferences need a deliberate content adapter; public art/catalogues remain public |
| personal.local-work | All owner-scoped localStorage/IndexedDB caches, shared editor drafts, conflict choices and pending mutations | Enumerate unmounted editors too. Snapshot first; retain every prior migration attempt; reconcile content without restoring sessions/rights |
| personal.reminders | Local schedules/Room reminders; server habit reminder profiles/devices/deliveries | Preserve private local state; explicitly allowed minimal technical schedule/push projection contains no titles/notes/values |
| personal.archives | Encrypted safety/held copies, personal export/import staging and history; native backup documents | Current-generation encrypted archives, recovery on clean client, loss-of-key UX and Drive adapter; archive import never changes identity/billing/ACL |
| project.content | Server-readable encrypted projects/tasks/checklists/comments/labels/dependencies/review/planning; native/web caches | Signed project roster with per-role checks; private fields encrypted for approved participants; client queries/merge preserve existing features |
| project.files | Shared task images/attachments and derived previews/filenames | New file keys/chunks/manifests in actual file paths, not only a standalone cipher test; truncation/pending upload/recovery/orphan cleanup |
| project.mindmaps | Shared map versions/conversions/deletions in project + space inherited ownership | Preserve images/history/tombstones and correct scope ownership; no cross-scope cached client |
| project.automation | Series/instances, automation rules/run payloads, workflow definitions/history | Private rule execution on an authorized client, deterministic durable jobs; legacy server workers must exclude active/migrating scopes |
| project.history | Activity, plans/reports, trash, bulk/import/transfer/template-source snapshots | Encrypt content/history without importing ACL; preserve dependencies/source IDs and explicit retention |
| project.local-work | Project editor journals in localStorage/IndexedDB and encrypted native documents/outbox | Durable repeated edits, exact immutable uploads, encrypted conflict resolution; feature adapters remain required |
| space.content | Space content/covers/labels/categories/templates/fields/history/views/imports and personal UI records | Correct space/project/personal ownership, signed grants and role enforcement; atomic ACL change plus all affected rotations |
| space.mindmaps | Space-owned maps and associated versions/files/conversion/deletion journals | Distinguish project-owned maps; preserve all inherited references/history |
| space.local-work | Unmounted space editors, templates/fields/workflow/planning/import drafts | Explicit inventory and adapters; no reliance on currently mounted React components |

The JSON lists the concrete repository sources and SQL table families. Native
source paths in the inventory are relative to
`android/app/src/main/java/ru/genesis/calendar/`; server entries are table names.
Cross-owner rows require all relevant scopes, as reflected in the backend guard
inventory. A project cutover does not silently assert that its parent space or
another participant's device has migrated.

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

All feature adapter rows above are pending product integration. Current focused
registry tests prove missing-path/forked-source/duplicate-output/incomplete-path
rejection and snapshot preservation; they do not replace the original 48
acceptance scenarios or establish full content coverage. Production flags/floors
remain disabled.
