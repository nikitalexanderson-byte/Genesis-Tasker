# Web backup: complete operation exclusion

20 November2026. Locally accepted JS/browser increment. This does not finish
`personal.archives`, product migration/recovery or the release. Coverage9/20.

The actual web BackupPanel now supplies the complete action with an explicit
operation-bound runtime. Its existing owner Web Lock covers local capture before
HTTP, safety encryption/storage, entitlement calls, decrypt/parse, restore
preview/current reads, server requests, file download and final history writes.
Nested HTTP uses the original opaque permit rather than acquiring another shared
lock behind an exclusive migration already waiting for this action.

Cloud backup ports bind account/session and owner. Workspace open/seal, recovered
task reads, personal document crypto/IO and held-state reconciliation receive the
same permit. Every runtime child, including file reads/downloads and pure crypto,
is tracked. An unawaited child invalidates the action, drains before the lock is
released, and cannot publish late data. Captured ports cannot be reused after
the job or for a different owner. No global/current borrowed permit is used.

Restart is requested within the operation but performed only after successful
cleanup and a final original-session check. A failed job/cleanup cannot trigger
it. Native BackupPanel passes its own bound runtime through the same explicit
callback interface; its composed bundle passed selected native JVM23/23 and
API26/API34 acceptance22/22 each. See `e2ee-336-archives-native-file.md` for the
exact source/APK hashes, final lint and limitations.
The existing read-only status bootstrap retains its ordinary guarded request.

## Evidence

-9 new web cases and23 existing focused backup/native-file/operation regressions:
  32/32 PASS. Initial focused run found a fixture missing negotiated backup
  generation support, so it performed3 rather than the expected4 requests. The
  fixture now negotiates support through the real bootstrap. The corrected case
  checks workspace, recovered-task and personal document requests under the
  same waiting migration; product boundaries were not loosened.
- Full JS1755/1755 PASS, failures/skips0; types02 and scoped ESLint PASS.
- Static web build PASS:98 HTML variants,14 languages, exact13 built locale
  dictionaries,280 gallery screenshots,173 required and433 visual offline assets.
- Actual Chromium157/React/File/WebCrypto/IndexedDB/LockManager:22/22 PASS,
  console errors/warnings0. The original14 capture/cold-unlock checks still pass.
  The8 added checks use actual cloud backup ports and Web Locks to prove waiting
  exclusion through safety crypto/download/final receipt and durable denial of a
  new job, plus exact invalid-UTF8 File bytes and original native provenance.
  The page's CSP forbids every network connection. Owner/data/key are synthetic.
  Original14 use the actual React panel with synthetic provider ports; the new
  whole-operation subtest exercises the actual web runtime/lock/storage modules.

Reports: `output/release-3.3.6/runtime/archives-web-job-{focused,full-js,types}-02.log`,
`archives-web-job-lint-01.log`, `archives-web-job-qa-lint-02.log`,
`archives-web-job-web-build-01.log`. Browser evidence:
`output/playwright/security336-archives-capture/results-whole-03.json`,
`before-detach-whole-03.png`, `after-cold-unlock-whole-03.png`.
Bundle SHA256 `7856ad08be09e66aad4b1dffd53c1736c217530ec324475c816f9a7e6b2d2955`.
Both screenshots were inspected; the own browser session and loopback listener
were closed. This is one headless Chromium desktop/light fixture, not the full
360/390/768/1440 light/dark matrix or authenticated provider acceptance.

Native mounted/detached archive form capture, nested archives under old account/
Keystore keys, portable content-only restore, retained key loss and clean recovery
remain unfinished. All11 remaining source categories, normal writers, shared ACL+
rotation and independent human crypto review remain activation gates.
Production3.3.5/149, floors0/pilot/cutover off, GENESIS_DEPLOY_ANDROID=false.
No Deploy, Play or personal device change occurred.
