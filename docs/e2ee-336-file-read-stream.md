# Existing-v1 bounded file readback

20 November2026. Selected component acceptance. Not a complete streamed
coordinator/content planner, product source, enrollment or recovery acceptance.
Production3.3.5/149, coverage9/20, floors0 and pilot/cutover off remain unchanged.

The existing v1 writer can persist encrypted file chunks without holding the
whole original. Its matching readback must have the same bound: routing the
result through the old whole-file reader would allocate the entire plaintext
again. Web `openE2eeFileStream` and native `E2eeFiles.openStream` now share their
platform's private-manifest preflight and chunk authentication with the legacy
batch reader. The v1 format, crypto suite and64MiB per-file limit are unchanged.

The entire authenticated private manifest and ordered descriptor set are
validated before the first chunk fetch or sink call. Each fetched chunk must
match its ciphertext hash, original context, trusted signature, AEAD and exact
ordered plaintext length. The caller's original-actor guard surrounds fetch,
crypto and sink boundaries. Web options/context/manifest/callbacks are captured
before the first asynchronous boundary.

Plaintext is borrowed by the asynchronous/synchronous sink and wiped after that
callback settles, including on sink refusal or actor retirement. Only protected
local quarantine may retain a prefix. No restore, active product write, upload
or replay authority follows from a prefix or sink acknowledgment. The reader
returns only filename/mediaType/size after the entire file and final guard
succeed. A later missing/corrupt chunk, no-space refusal or actor retirement
returns no complete metadata receipt. An authenticated empty file produces no
implicit chunk or sink call.

The batch API delegates to the same core and retains its whole-array result.
Its aggregate allocation starts only after manifest preflight; failed output is
wiped. This compatibility API is still aggregate and must not be used to claim
bounded coordinator planning.

## Accepted local evidence

- Selected JS93/93 PASS, runtime `file-read-stream-js-draft-02.log`.
- Scoped ESLint/types PASS after browser-harness additions,
  `file-read-stream-lint-draft-02.log` and `file-read-stream-types-draft-02.log`.
- Native input01 frozen as
  `F3D6AB03EB13FCFB91ECF5DBDCCCD7336DB635C8F2F67EEEBF95D41D53F9C22D`.
  Build SUCCESS19m13s, selected JVM167/167,0 failure/skip. Lint0 errors,
  208 warnings/8 hints, no new issue/file pairs against staged-coordinator03.
- Actual API26/API34 each pass5/5,0 failure/skip. The40MiB fixture now cold-reads
  all160 chunks through the bounded reader, independently hashes all original
  bytes and checks borrowed-buffer expiry before the next fetch and at EOF.
  Native late missing/tampered-chunk, sink failure and actor-retirement cases
  return no metadata receipt; the retained writer/tag and strict preflight
  regressions also pass. Each report's two extracted artifacts match their
  hashes. Host checks independently reconstruct the entire generated40MiB and
  open each fresh9-byte JCA vector with both WebCrypto v1 readers.
- Actual Chromium157 passes17/17: cold IndexedDB bounded readback, buffer wipe,
  both v1 readers/public web and fresh JCA vectors, late failures, option
  mutation and authenticated empty-file cases. All9MiB+7bytes/37 chunks are
  checked through a new IDB connection. Existing batch interoperability and
  the shared4valid/25invalid lexical corpus are retained; six malformed later
  descriptors cause zero fetch/sink calls in both readers.

Native large-file elapsed10,652/16,164ms(API26/API34), Java max heaps512/192MiB.
These are selected fixture durations and configured maxima, not peak-memory
measurements, product capacity or an SLA. Runtime tests began after fresh
assembly while lint completed independently. The provisional assembled APK
identity is retained separately; its two hashes equal the final successful
build identity, and the current frozen input was checked again afterward.

Main APK:
`0B94E2FCA06D51F7AD6ECEB725F799FE2A2E4B7EBACB98A707EAA41129764536`.
Test APK:
`D150E75EA603E983F57F8F9E9B3CE51B1F65649A1CFCF2A8331A4BF125A78113`.
Exact evidence uses `file-read-stream-*-01` under
`output/release-3.3.6/runtime/`, the draft02 JS/lint/type logs named above and
`output/qa/security336-file-read-stream-api{26,34}-01/results.json`.
The previously pushed source-publication9af1f6b3 has Android CI PASS; its
web/API CI44727123730 was still running at this checkpoint. This reader's full
remote CI has not run yet and is not inferred from the preceding commits.

Synthetic public keys, generated source bytes and isolated QA app only. No
customer ciphertext, account/device key custody, physical devices, payment,
production configuration or release publication are exercised by these cases.
Full stage/content reconciliation and common-reader input, all20 real sources,
direct upgrades, product recovery,48 scenarios,14-language semantics and
independent human crypto review remain release gates.
