# Controlled legacy pages and service-worker transport

18 November 2026, preparation after `a055025a`. Production is unchanged; migration,
pilot and mandatory-update floors remain disabled.

## Implemented

The production `public/sw.js` dispatches personal private API requests, including
POST/PUT/DELETE, to a generated classic worker module. Other requests keep the
existing path. In particular, OAuth/navigation, identity, billing, existing
messaging and signed E2EE transport are not intercepted by this private handler.
Potential preference writes are inspected under a64KiB bound; malformed/unknown
content is private rather than technical metadata. Shared transport is separate.

The worker reads the same persistent technical deny database as the application:

- A request carrying the new owner header is checked against that owner's marker.
  The header grants no read/session/device authority; the backend independently
  checks its cookie owner. The worker never reacquires the page's owner lock:
  doing so could deadlock behind a queued exclusive migration while the page is
  waiting for its own fetch.
- An old request without an owner binding takes a shared origin-wide `unbound`
  lock. With any marker present, it fails before the backend sees the request.
  This is a conservative deny superset, not a permission to read another scope.
  Without markers, an ordinary non-migrated legacy request remains compatible.
- Preparing a scope takes the exclusive `unbound` lock before its own exclusive
  owner lock. All earlier unidentified transfers finish before source capture.
  Identified current clients retain parallel shared owner permits.
- Only unidentified old responses are buffered to completion, capped at64MiB.
  Interruption/oversize never becomes a successful partial response. One growing
  buffer also bounds overhead from tiny fragments. Current clients keep streaming
  and the full response-parse permit in their application API.
- Corrupt markers, missing storage or unavailable Web Locks fail closed. Neither
  worker initialization nor its status handshake provisions keys/a vault.

The real product factory requires the currently controlling worker to acknowledge
the transport protocol through a dedicated MessageChannel before the migration
marker or snapshot callback. Missing/old/replaced controllers fail explicitly.
This check does not approve a device, provide keys or activate migration.

`scripts/export-e2ee-legacy-worker.mjs` builds the classic bundle from the same
TypeScript and policy. `build:web` rejects bundle drift; the helper's bytes enter
the existing precache fingerprint, and offline verification requires its import
and cached asset. No CI/deploy workflow was replaced. Existing install/activate
behavior remains: no forced skipWaiting, reload, cache purge or storage cleanup
is introduced by the migration capability check.

## Evidence and limits

- 139/139 JS tests, including6 new worker/preflight scenarios:
  `runtime/js-legacy-worker-final.log`. Includes complete/chopped/interrupted
  responses, tiny fragments, unknown preference bodies, ownership separation,
  no nested lock, missing/replaced worker and no snapshot after preflight failure.
- 13/13 real Chromium service-worker checks:
  `runtime/browser-legacy-worker-final.log`. Three physical JS execution contexts
  (worker and2 pages) share the real lock/IndexedDB. A deliberately delayed HTTP
  body blocks capture; after the marker, old private requests and preference
  patches create zero server calls. Identity, technical preferences and signed
  discovery remain available. Direct identified bypass requests and corrupt
  markers are independently denied by the worker.
- Existing22 browser transport checks still pass with the global barrier:
  `runtime/browser-transport-after-worker-final.log`.
- Typecheck/ESLint and `build:web` PASS, including exact generated-bundle and
  mandatory offline asset checks (`runtime/web-legacy-worker-build-final.log`).

All browser data/endpoints are synthetic and allowlisted on loopback. The QA-only
worker claims its test pages immediately; the production worker's full cache
installation/waiting/BFCache lifecycle is not claimed as device acceptance here.
Android/PHP code and previously checked artifacts are unchanged by this web step.
No real account, personal device, production service or release channel changed.

Still mandatory before pilot: all local/editor writers and sources, unmounted
drafts, client quiescence including uncontrolled/restored pages, encrypted editing
during migration, full product routing, shared ACL/transport/rotation, independent
crypto review and the original48-scenario acceptance. This is controlled network
protection, not complete E2EE migration or permission to activate it.
