# Device-only migration content

19 November 2026. Diary `local_only=1` retains the device copy while removing
the server copy; it is not a deletion. Unsent drafts are device work, not implicit
permission to create a cloud copy.

Reconciliation returns remote `content` and optional device-only `localContent`.
Both placements share adapter-domain/identity/count checks and a 128 MiB byte
budget. Local output and its encrypted journal are stored atomically in the
unlocked device vault before verification/commit: 256 KiB encrypted
`local-snapshot` parts, at most 64 MiB/file. Private identities, filenames and
plaintext hashes exist only inside the encrypted device journal. No local entry
has a transport representation.

Journal protocol 2 adds `local` and `planned`. Protocol 1 remains resumable;
older readers reject protocol 2. `planned` also represents a finished zero-upload
plan. Both platforms revalidate local parts before pending verify/commit replay
and activation. Missing/corrupt parts refuse safely. `readLocal` requires an
active migration and unlocked vault; no cloud fallback. Backend zero-object
manifests retain all signed owner/device/lease/source/proof/CAS checks. Client
registry/feature validation remains necessary to establish content completeness.
Native bridge/wrappers preserve placement/filename/media type and clear both
output lists on errors.

## Recovery boundary and remaining work

Local bytes use the device vault separately from the scope root. Recovery needs
saved recovery authority **and retained device-vault ciphertext**. A recovery
secret cannot recreate device-only content lost with the device. Cloud recovery
is not a local-only backup. Product backup/export, editor routing and complete
vault lifecycle integration remain release requirements. Diary adapters and
independent crypto review are still pending.

## Evidence

Under `output/release-3.3.6/runtime/`:

- `local-output-web-runtime-04.log`: 69/69 focused JS PASS.
- `local-output-full-js-05.log`: 1528/1528 JS PASS.
- `local-output-web-build-04.log`, `local-output-typecheck-final-03.log`,
  `local-output-lint-01.log`, `local-output-browser-typecheck-final-06.log` and
  `local-output-browser-lint-02.log`: PASS.
- `local-output-backend-02/`: 6/6 PHP suites PASS.
- `native-local-output-build-01.log`: main/test QA APK, JVM and lintDebug PASS,
  16m10s. JVM 1162 tests: 1154 passed, 8 skipped, failures/errors 0; skips are
  opt-in real-PHP HTTP cases. Migration 13/13, registry 7/7, no skips. Lint:
  0 errors, 206 existing warnings, 8 hints.
- `native-local-output-api34-01.log` and `native-local-output-api35-01.log`:
  48/48 instrumentation cases each PASS. These are not the original whole-system
  48 acceptance scenarios.
- `local-output-browser-report-04.log`: 20 checks PASS in Chromium 157 (including
  repeated packet bindings), console 0 errors/warnings. Real IndexedDB/WebCrypto,
  saved recovery unwrap, multipart readback, ambiguous commit retry and cold
  vault unlock/read. No `put`, local content, filenames or plaintext hashes in
  transport. Screenshot `output/playwright/local-only-migration-336.png`.

Retained failures: runtime 03/typecheck 02 found a native-entry variable collision,
fixed to `outputPackets`; backend 01 expected wrong malformed-command error tags,
corrected to actual strict parser errors; browser reports 01–03 incorrectly used
an HKDF root as AES in a QA recovery probe, corrected to real envelope seal/open
derivation. Final report 04 passes. No failed evidence was deleted.

Production remains 3.3.5/149; floors 0, cutover off,
`GENESIS_DEPLOY_ANDROID=false`. This foundation is not full account coverage.
