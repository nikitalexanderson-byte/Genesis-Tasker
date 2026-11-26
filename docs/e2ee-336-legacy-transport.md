# Personal legacy transport barriers — 3.3.6 preparation

18 November 2026. Inactive migration preparation on `codex/security-336`.
No production activation, new version floor, publication or personal-device update.

## Contract and server

`contracts/e2ee/legacy-transport-v1.json` classifies personal content routes and
private preference fields. PHP, TypeScript and Kotlin use 45 common independent
route/payload vectors. Billing catalog/orders, identity and signed E2EE transport
remain separate; paid modeling **results** and advice history are private. Shared
scopes and existing messaging retain their independent boundaries. This is a
content classifier, never an endpoint allowlist or external-processing consent.

Unknown preference keys are protected. The actual account-preference API checks
the body under its SQLite writer transaction, including live migration leases and
no-op patches; technical language/theme/date preferences remain usable. After
active/retirement, `/session` and other profile replies omit retained legacy
advice preferences, UI layout/visibility and category routing rather than return
plaintext or silently rewrite them as empty defaults. `privatePreferencesMode`
is a deny-only hint, not device approval or a key-delivery credential.

New private requests carry `X-Genesis-Account-Id`. Middleware rejects a mismatched
live cookie owner before dispatch. Missing headers remain compatible for old
non-migrated clients, and cannot bypass active-scope policy/SQLite fences.

Deploy ships `server/`, not repository-root `contracts/`. PHP loads its exact
checked byte copy from `server/resources/e2ee-legacy-transport-v1.json`; a test
executes the real loader with only this deployed layout. Missing/invalid policy
fails closed. QA source fingerprints now include actual contract assets.

## Android

`NativeLegacyTransportGate` and `NativeLegacyScopeFence` share the same per-DB,
per-storage-scope mutex across controllers/Room instances. The central
`AuthSessionClient` acquires its personal permit before connection creation and
keeps it through response parsing and disconnect. Preparation waits for a complete
earlier request, commits the persistent deny row, then captures sources. Waiting
and future private requests cannot open a socket after this point. Failure or
process death retains the row; verified cancellation is explicit, active is
irreversible. Identity/technical preferences/E2EE routes do not wait on this
personal content lock, avoiding a signed-migration deadlock.

The current app/WorkManager writers use one process. Room storage triggers remain
independent across processes; the in-process transport mutex does not assert
support for a future separate worker process. Network inside a Room transaction
is rejected before lock inversion. A live authenticated profile binds the owner;
cookie/owner publication is atomic. A missing binding or changed account stops IO.
Mutable `JSONObject` input is copied before classification, so a later private
field cannot enter a request classified as technical metadata. A protected server
profile also denies legacy IO on a clean client with no local marker.

## Web

The main `cloud-sync.ts` API client uses the same personal classifier, live owner
binding/header and deny-only profile hint. `WebLegacyTransportGate` holds an
origin-wide shared Web Lock through complete response parsing/cleanup; migration
takes the exclusive lock and waits for all older IO. Ordinary web requests retain
their parallelism. Missing Web Locks
or IndexedDB stops private IO; identity remains available. A separate IndexedDB
database, `genesis-e2ee-legacy-transport-v1`, contains **only technical deny
markers**, outside legacy cleanup/import/cache paths. Strict durable CAS forbids
active marker replacement/deletion. Corruption/storage errors do not select an
empty or plaintext fallback.

`WebMigrationTransportFence` commits the marker before its callback, preserves it
on failure/tab closure, and requires a freshly read cancelled coordinator status
before release. Factory creation does not start a migration. This is the transport
half of a local barrier: synchronous legacy storage/editor exclusion and old
JS/service-worker handling still MUST be combined before product migration.

## Verified and remaining

- 133/133 JS tests (`runtime/js-legacy-transport-verified.log`); focused deployed
  packaging test repeated after cleanup-path validation. Typecheck/ESLint PASS.
- 11/11 backend regression suites, plus 3/3 focused transport/modeling/billing
  suites (transport overlaps), isolated SQLite/config; transport suite has
  299 cumulative assertions. No provider mail/curl or production data.
- 478/478 JVM auth/security tests, 77 XML suites, 0 failures/errors; APK and test
  APK build PASS. QA metadata remains 3.3.5/149, **not a 3.3.6 release**.
- 8/8 instrumented API26 checks on task-owned emulator5574: real Room ordering,
  reopen/storage preservation, and the actual AuthSessionClient with a counted
  synthetic connection factory. Fenced requests create zero connections; signed
  discovery and identity work; private request-body mutation cannot bypass the
  classification. Only unique QA databases/preferences/Keystore aliases used.
- 22/22 real Chromium checks through Playwright CLI: multiple tabs/real Web Locks,
  strict IndexedDB, complete response ordering, zero private probe requests,
  active immutability, reopen/new tab, closing a tab during preparation, plus
  the real application API client/owner header and clean-client protected hint.
  Stored null/undefined deny records are corruption, not absence: neither IO nor
  a new migration may silently replace them with an empty scope.
  Local allowlisted loopback fixture only; evidence `runtime/browser-transport-verified.log`.
- `npm run build:web` PASS, including existing gallery/document/locale/precache
  verifiers. This is a build check, not visual or semantic i18n acceptance.

Evidence root: `output/release-3.3.6/runtime/`. Final native log/identity:
`native-transport-instrumented-complete.log`, `native-transport-identity.json`.
Earlier failures retained: synthetic Android HTTP response omitted Content-Type
and was correctly rejected; fixture fixed without weakening product validation.
An initial CLI code argument lost quoting (use `--filename`); the expanded browser
fixture initially lacked React/process build defines. Neither failed attempt is
counted as a pass. A harmless favicon404 is separate from checks.

Still required: old tabs/SW and all local writers, all private feature adapters,
shared scope transport/ACL/rotation, direct external spelling/AI/provider consent,
product bootstrap/editors/enrollment/recovery, complete attachment/archive flows,
direct release upgrades, low memory/biometric lifecycle, other browser engines,
14-language semantic/visual acceptance, all48 scenarios and independent crypto
review. The server still retains legacy keys/history. These barriers do not make
the whole system fully E2EE and do not authorize production cutover.
