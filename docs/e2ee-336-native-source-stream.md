# Native mindmap migration result stream — 19 November 2026

This increment removes the old single-message result limit for the packaged
mindmap source reconciler. It does not activate E2EE, change the crypto suite,
raise update floors or publish Android 3.3.6. Production remains 3.3.5/149.

## Transfer contract

`app/e2ee/native-source-stream.ts` sends one result part at a time and waits for
the native acknowledgement before sending the next part. Both remote content and
device-only work have explicit placement. The Kotlin receiver validates exact
fields, owner-bound source object types, consecutive object/part sequence, stable
metadata, declared length, explicit end and a SHA-256 checksum before publication.

- Existing chunk size: 256 KiB.
- Maximum logical object: 64 MiB; aggregate result: 128 MiB; objects: 10,000.
- Filename and media-type limits: 512 and 128 characters.
- Empty objects still require one explicit empty part and its checksum.
- The checksum stays inside the local native/WebView bridge. It is not a new
  HTTP field or a public plaintext hash. The existing vault/file encryption,
  independent file keys, chunk authentication and signed manifests remain in use.
- Old keys stay native. Streaming adds no key, HTTP, storage or mutation bridge.

The receiver never exposes an incomplete transfer. Publication and cleanup share
a monitor; a declined publication or failed owner check wipes captured result
buffers. A late part or repeated completion cannot wipe bytes already handed to
the migration coordinator. JavaScript wipes buffers after the entire transfer,
including failure, so legitimate aliased views are not destroyed before sending.
Legacy source bytes are never modified or deleted by this protocol.

The mindmap input limit is explicitly 128 MiB; other source engines retain their
48 MiB input and old bounded result protocol. The minimum WebView check occurs
before bulk input serialization as well as before constructing the isolated view.

## Verification

Evidence is under `output/release-3.3.6/runtime/`.

- `source-stream-full-js-01.log`: 1587/1587 PASS, including four streaming cases
  covering output above 17 MiB, hashes/backpressure, empty and aliased buffers,
  account changes, negative acknowledgements and pre-transfer refusal.
- Typecheck and scoped lint passed in `source-stream-typecheck-01.log` and
  `source-stream-lint-01.log`.
- `native-source-stream-jvm-summary-02.json`: 1180 tests in 215 suites;
  1172 passed, 8 opt-in real-PHP HTTP tests skipped, zero failures. All six new
  receiver cases passed, including incomplete/tampered output, duplicate finish,
  failure zeroization and exact remote/local placement.
- Build attempt 01 failed compilation because the input-size expression mixed
  Kotlin Int and Long. The explicit Long comparison is corrected in attempt 02.
  `native-source-stream-build-02.log` completed BUILD SUCCESSFUL in 18m8s:
  main/test QA APKs, JVM tests and lint. Lint has zero errors, 206 existing
  warnings and eight hints. The assembled APKs were tied to the unchanged
  native source hash before device tests; the full build was then allowed to
  finish without changing its inputs.
- `native-source-stream-instrumentation-summary-02.json`: API34 74/74, API35
  74/74, API26 18/18 PASS, zero failures/skips. The large-history case passed on
  both API34/35 with 17,644,546 result bytes and the normal 201,326,592-byte Java
  heap limit. All 25 versions and the final exact note were retained and read
  after erasing the old key/alias; the legacy source remained byte-for-byte intact.
- API26's original Chromium69 is below minimum111. Its 18 cases cover key
  lifecycle, actual JCA vectors, the existing localized UI fallback and direct
  early refusal of the mindmap source before legacy opening. This is not API26
  migration acceptance with a supported provider. The fallback again checks 14
  languages × two schemes × three modules. Its 84 PNGs and hashes are retained
  in `native-source-stream-api26-artifacts-02.json`; the English light and Russian
  dark Aurora images were visually inspected at font scale 1.3. Other images are
  machine-checked captures, not a claim of full semantic/visual review.
- Source/APK identity is in `native-source-stream-build-identity-02.json`.
  All three task-owned emulators were stopped after their parsed acceptance.

## Remaining large-source limits

This change is result framing, not full large-account acceptance. Native local
snapshot capture still has a 16 MiB cap, legacy Room maps remain in one document
subject to CursorWindow limits, and remote source/input serialization is still
aggregated. Raising a bound does not prove acceptable heap use on a real device.
Per-page native source delivery and large local captures need separate acceptance.

The dedicated device case uses 25 valid synthetic map versions, each below the
existing 2,000,000-byte document cap, and a result above 16 MiB. It must preserve
all versions and exact content, leave the old source unchanged, and read the
final version with only the new root. A passing case would not prove the maximum
40,000,000-byte history or a large native local snapshot.

Full product routing/unlock/freeze/normal writes, source review, old-key loss
after preparation, clean-device recovery, direct signed upgrades, other source
categories, shared ACL rotations, archives/Drive, the original 48 scenarios,
14-language semantics and independent crypto review remain release gates.
