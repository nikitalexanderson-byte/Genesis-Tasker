# Legacy Physis readers —19 November2026

This increment adds read-only conversion primitives for the original independent
password/recovery vault and account-v2 wrapper. It does not yet implement the
Physis source adapter, memory/editor capture, new normal writes or product
migration. Source coverage remains7/20; no version/floor/pilot/cutover is changed.

## Original formats and refusal rules

`app/e2ee/physis-legacy.ts` checks exact versioned fields and safe positive
integers, canonical standard base64,12-byte GCM IVs and bounded sizes before
opening a key. Independent v1 uses only its own original password or PHY1
recovery code. PBKDF2-HMAC-SHA256 is fixed to the original600000 iterations and
16-byte salt; missing/wrong/cancelled secrets do not fall back to account access
or an empty source. Canonical32-byte recovery codes are required even when an
older decoder would accept nonzero unused base64 bits.

Account-v2 opens only `physis-vault:v2:<original-keyVersion>` under the old
account AAD. Record AAD remains
`genesis:physis:v1:<owner>:<id>:1:<keyVersion>`. A vault and its original epoch
are snapshotted before any asynchronous prompt/KDF so caller mutation cannot
change the object being opened. The WebCrypto key returned by the new reader
is nonextractable and decrypt-only.

Raw `vault_json`/`envelope_json` and authenticated record JSON pass the shared
strict decoded-duplicate-name/prototype/bounds parser. Plaintext is preserved
without projecting unknown/empty private fields away. Category schema validation
and exact record-ID binding are still a separate mandatory adapter step; valid
AEAD is not sufficient to accept arbitrary record content.

Limits match the old record writer:256KiB including the16-byte authentication
tag, plaintext up to256KiB−16. A valid ID has the existing UUID shape. Unsupported
formats, unknown fields, substitution, bad UTF-8 and oversize input refuse while
leaving source ciphertext intact. Errors contain technical codes, not content.

## Native boundary

`security/E2eeLegacyPhysis.kt` uses existing BC1.87 for old PBKDF2 and platform
JCA AES-GCM. It does not add a dependency or replace a global provider. PBKDF2
runs on `Dispatchers.Default`, copies a borrowed CharArray before suspension
and clears its own mutable credentials/key/plaintext buffers on completion,
cancellation and failure. Internal library copies and immutable strings remain
subject to normal runtime memory limits; process-wide zeroization is not claimed.

The password encoder explicitly matches WebCrypto TextEncoder's UTF-8 replacement
of unpaired UTF-16 with U+FFFD. Java's default replacement can otherwise derive
a different key. Recovery trimming matches ECMAScript whitespace, including BOM
and nonbreaking space. Account wrapper plaintext must be the original exact
46-byte quoted canonical base64 payload, not permissively parsed JSON.

An owner/epoch-bound decrypt-only Reader has no export/bootstrap/rotate/write
method and a redacted `toString`. Close or owner-guard failure invalidates it and
clears its private DEK bytes. It returns original strict UTF-8 text to the common
parser; returning JSONObject would lose duplicate fields on some Android versions.

This native primitive accepts already structured vault/envelope objects. It is
not a replacement for strict raw JSON validation. The future shared source must
validate retained raw names **before** requesting a native opening capability,
and the native adapter must restrict that capability to exact captured originals.
Neither the Physis packaged port nor that complete source adapter exists yet.

## Verification and remaining work

`scripts/crypto/physis-legacy-fixture.mjs` generates only public synthetic keys
through the actual `app/physis/crypto.ts` legacy writer. The retained fixture is
`tests/fixtures/e2ee/physis-legacy.json`, including independent passwords/recovery,
account-v2, Unicode/unpaired UTF-16, original unknown fields and maximum safe
keyVersion. It is not production key material and must never be used as such.

The focused WebCrypto reader suite passes11/11, including canonical recovery,
owner/ID/epoch/schema/nonce/cipher substitution, malformed KDF claims before any
prompt, duplicate decoded JSON names, invalid UTF-8, exact size limit and late
owner changes and credential-provider error redaction. Full JS passes1599/1599;
typecheck and scoped ESLint pass. Logs:
`output/release-3.3.6/runtime/physis-legacy-web-reader-04.log`,
`physis-legacy-full-js-02.log`, `physis-legacy-typecheck-03.log` and
`physis-legacy-lint-03.log`.
Static web build also passes (`physis-legacy-web-build-01.log`), including the
existing98 public HTML variants,14 languages, exact locale dictionaries,
280 gallery images and offline precache. This is build/regression evidence;
the new Physis helper is not yet routed into the public product.

Native full build01 succeeded in15m57s with both isolated APKs, JVM and lint:
1196 cases in216 suites,1188 passed,8 opt-in real-HTTP cases skipped,0 failures;
all12 new Physis JVM cases pass. Lint has0 errors,206 existing warnings and8 hints,
with no finding in the new reader. After the final web-only error redaction,
assembly02 succeeded in39s and both APKs were byte-identical to build01. Their
new source identity was recorded before instrumentation, including the fixture
assets which the native QA hash now explicitly covers.

Actual API26/API34/API35 each passed4 new Physis cases plus2 existing envelope
provider cases:6/6 per device,0 failures/skips. These use the real WebCrypto
fixture and platform/BC reader, including both old vault modes, unpaired UTF-16,
late account changes, canonical recovery, substitution, full256KiB record and
original duplicate JSON text. No raw key is returned by the Reader API. These
are native primitive tests, not a successful Physis packaged-source migration;
API26's old Chromium69 remains an unsupported provider for that separate engine.
All three task-owned emulators were stopped. No UI copy changed in this increment.

Native evidence under the same runtime directory:
`physis-legacy-native-build-01.log`, `physis-legacy-native-jvm-summary-01.json`,
`physis-legacy-native-lint-summary-01.json`,
`physis-legacy-native-build-identity-02.json`,
`physis-legacy-native-artifact-comparison-02.json` and
`physis-legacy-native-instrumentation-summary-01.json`. Raw device reports:
`output/qa/security336-physis-api26-34-01/` and
`output/qa/security336-physis-api35-01/`.

Next integration must capture the actual PhysisMemoryStore keys/confirmed wire
records/pending changes/uncertain rotation and mounted form drafts under an owner
fence before IO, preserve all four signed server table families, reconcile
conflicts/tombstones, newly encrypt content and verify with new-root readback.
`openPhysisAccount()` mutates/bootstrap/rotates and is not a read-only source
reader. Native's missing Physis editor is not evidence of an empty server vault.
Full lifecycle, recovery/upgrades, archives/Drive, remaining sources/shared/files,
all48 system scenarios,14-language semantic checks and external independent
cryptographic review remain mandatory.
