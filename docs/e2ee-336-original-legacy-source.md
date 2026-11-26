# Original-actor read-only capability for legacy snapshots

20 November2026. Bounded read-only component accepted within the scope below.
Production remains3.3.5/149, coverage9/20, floors0/pilot/cutover off
and GENESIS_DEPLOY_ANDROID=false.

Web `openOriginalLegacySnapshot` and native `E2eeOriginalSource.openLegacy` accept
independently unwrapped original roots, a trusted PUBLIC original signer and
authenticated original actor coordinates/bounds. They do not accept/import an
old private signing key or open an old active signing vault. The returned handle
contains only paths, the exact original reference, openPath and close. It has no
storage, roots, signer, write, replay, identity, restore, billing or ACL authority.

The supplied coordinates, keys, public signer, target and reference must come
from authenticated recovery/handoff. This factory does not establish that trust;
Google identity or a server's metadata claim is insufficient. It proves only one
specific retained original, not full history or whole-account recovery.

The private original reader now has TWO explicit, disjoint purposes. Existing
source-stage handles retain their source-stage/catalog read namespace and their
exact discovery prefix. The new legacy purpose reads only the exact bounded
`migrationId:source:index` set, serial1, and discovers only that exact source
prefix. Stage/legacy roles cannot read each other's records, another attempt,
outbox or other domains. The legacy reference shares the generic reader's strict
preflight before any allowed-ID allocation or body lookup: exact fields,
technical ID, canonical SHA-256, old64MiB/256-part limits and exact part count.

Every source record still verifies original owner, device scope/device ID,
generation, schema/serial, epoch bounds, supplied trusted root ID and original
signature/AEAD. No key or signer is trusted from ciphertext fields. Metadata,
callbacks, root maps and references are captured before IO. Closing invalidates
the original reader before pending continuations and closes the generic legacy
stream, wiping its owned raw/decoded buffers. Caller-owned key objects and
previously returned native output buffers keep their existing ownership; no
whole-heap/key-object zeroization is claimed.

The generic legacy reader remains separately tested; its original raw hash,
strict JSON/Base64/EOF, per-reader ownership and reservation/drain rules are
unchanged. No crypto/writer/file format is introduced. Existing state1/2/3
readers and closed v3 run remain unchanged. Original records and the independent
new device's identity/pending work are never rewritten by this capability.

## Current evidence

- New missing-export red01 is retained. Selected actual JS112/112,0 failure/skip,
  `original-legacy-source-js-final-03.log`: six new authority/lifetime cases,
  original-stage/generic legacy/content-plan/staged/migration regressions.
- Owned types `original-legacy-source-types-draft-02.log` and scoped ESLint
  `original-legacy-source-lint-final-03.log` PASS. Full `build:web`
  `original-legacy-source-web-build-final-01.log` PASS: public gallery/documents,
  all locale dictionaries/variants and offline precache preserved.
- Actual Chromium157/WebCrypto/encrypted IndexedDB14/14, console0,
  `original-legacy-source-browser-final-01.json`: cold source rows, independently
  protected/unwrapped root and imported public signer, every original byte,
  unchanged new identity/draft, private-signer/wrong-generation/missing-root/
  wrong-reference refusal, close/retirement/pending lookup and no writable API.
- Diagnostic native JVM21/21/build6m48s PASS. Full build01 reached JVM219/219 but
  failed Android test-fixture compilation: a nested Rig could not access the
  outer save helper. The fixture was fixed before input02; no01 runtime/APK
  acceptance is claimed.
- Frozen native input02:
  `238AD76062D44324990C09DA0765F344457B4EA5552380922F610317943FF4DE`.
  Build SUCCESS1m47s, JVM219/219 across31 suites,0 failure/skip. Actual API26/API34
  each passed2/2 new cases,2/2 original-stage and2/2 generic-legacy regressions.
  Reports: `output/qa/security336-original-legacy-source-api{26,34}-02/results.json`.
  Main APK SHA-256:
  `639B8997D293D74FF257F0085C26EED9484469333CDA6C90578EF91FD1FEFA24`;
  test APK:
  `028E6723CB8A72B08A0F18AE4DAD965B9D1DC6553AC87F2FD01CED20DA0902DD`.
  Source/build identity was independently rechecked after both provider runs.
  No new full Android lint was run for this input; final-candidate lint remains
  required. The preceding complete-plan full lint is not this input's result.
- Host checks `original-legacy-source-host-api{26,34}-02.json` verify every
  extracted artifact hash and all1,048,598 decoded original bytes/six logical
  hashes using independent bounded Node construction. The raw wrapper is
  1,398,438bytes/six parts; its original raw digest is checked by the reader,
  not independently reconstructed by the host (native JSONObject field order
  is not assumed). Both fresh JCA public-only vectors open through the actual
  WebCrypto original capability:18bytes/six paths per API, seven exact gets.
- Regression host checks `original-legacy-source-stage-regression-host-api*`
  independently match both35MiB+17byte paths,73,400,354bytes total, and fresh JCA
  vectors. `original-legacy-source-legacy-regression-host-api*` additionally
  matches the exact12,583,247byte original wrapper/49parts,9,437,206 decoded
  bytes/six hashes and both fresh JCA vectors. No whole-heap/peak-heap or SLA
  measurement is claimed.

The new actual device fixture deleted only its owned synthetic old LocalCipher
Keystore alias, independently recovered a root, imported PUBLIC SPKI only and
read every original path. The old alias stayed deleted; the separate new active
identity, its draft [9,8,7] and all encrypted rows stayed unchanged. The encrypted
old private-key bundle was never supplied to this read API. This proves a
specific read-only provider boundary, not a real user's authenticated handoff,
all nested old LocalCipher/AAD materialization or complete product recovery.

All11 remaining real sources, source/plan/coordinator publication and complete
mixed-history validation, protected remote originals, real bounded native/
WebView process-role inputs, normal writers/unlock/enrollment/recovery, shared
ACL+rotation, attachments/Drive, signed direct upgrades,48 product scenarios,
14-language semantics and independent human crypto review remain mandatory.
