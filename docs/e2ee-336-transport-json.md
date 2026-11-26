# E2EE authenticated HTTP JSON: web and Android

## Boundary

`readE2eeJsonResponse` now checks strict JSON syntax and decoded duplicate names
before `JSON.parse`. The real `AuthSessionClient.requestOverHttps` E2EE branch
uses `E2eeHttpResponseJson` before Android `JSONObject`, for success AND HTTP
error responses. Native previously accepted platform-lenient syntax, replaced
malformed UTF8 and projected duplicate fields; web already rejected malformed
UTF8 but still projected duplicate fields. This could select a different
`sourceHash`, owner/epoch or migration error from the same wire observation.

The preflight is dependency-free; it does not import the legacy backup parser,
change its private-file limits or recreate the earlier coordinator import cycle.
Only allowlisted E2EE routes are changed. Other existing non-E2EE native JSON
parsers are outside this increment and must not be described as hardened by it.

## Wire admission

Both clients require application/json, fatal UTF8, a single object root, strict
JSON syntax, no decoded duplicate property names at ANY depth, and finite
numbers. One initial UTF8 BOM is accepted, including when split across reads;
double/embedded BOMs outside strings refuse. Surrogate UTF8 byte sequences
refuse; JSON's escaped string grammar is not expanded into a normalization
policy for private text.

Unchanged wire byte budgets are16MiB for `/read`,32MiB for `/directory`,256KiB
for the other allowlisted routes and8KiB for HTTP errors. Declared oversize and
actual oversize refuse before any projected JSON can reach the caller. Empty
progress refuses, EOF is required and cleanup closes/releases the owned stream.
Decoded syntax budgets are250000 total values, depth40 with the root at0,
10000 members per object,1024 UTF16 code units per decoded key and128 characters
per number token. Value strings remain bounded by the route byte budget, not
the private-file parser's512-character policy. Tests admit each exact boundary
then refuse one over it. A representative2048-event directory, the existing
directory event-count limit, is admitted; this is not proof that every possible
large directory fits. A larger valid shape may explicitly refuse under the
resource budgets without losing its prior durable state.

Invalid successful responses expose only `E2EE_INVALID_RESPONSE` or
`E2EE_RESPONSE_TOO_LARGE`; response snippets are never included. An invalid HTTP
error body becomes a generic HTTP failure and cannot mint a last-duplicate
`E2EE_MIGRATION_FENCED` instruction. Valid existing public error codes survive.
Account guards run before/after reads and parsing; native no longer wraps the
E2EE error reader in cancellation-swallowing `runCatching`.

Native uses a bounded growing byte accumulator, wipes replaced/finished raw
buffers and validates UTF8 with a reusable4096-character scratch buffer before
constructing its immutable String. It does not allocate a second whole-body
CharBuffer. Web expires consumed wire loans and drops its decoded string parts
on cleanup. Neither implementation claims erasure of immutable strings, parsed
objects, the GC heap, provider internals or caller-owned outputs.

## Evidence and limits

Shared `contracts/e2ee/transport-json-v1.json` contains44 synthetic cases:8
admitted and36 refused. The same byte observations, success/error outcomes,
escaped duplicates, BOMs, strict-number cases and malformed UTF8 are exercised
by Node, the browser, JVM and Android provider tests. Native device tests use
the real AuthSessionClient and Keystore-backed encrypted session journal with
an injected controlled connection factory; they do not claim real TLS/backend
acceptance or alter a personal installation.

Initial web RED witness `transport-json-red-01.log` reproduced all3 missing
refusals. Final full JS1956/1956,0 failures/skips, is retained in
`output/release-3.3.6/runtime/transport-json-full-js-01.log`. Owned types02 and
scoped lint02 pass. Static Vite build plus the existing gallery/documents/
dictionaries/offline checks pass, and the legacy-worker export check passes.
The98 public HTML variants,14 languages,280 gallery images and authored legal
disclosures remain intact; no UI text, language rules or release gates changed.

Chromium157 passes143/143 checks across the44-case corpus through actual
authenticated fetch and split-byte error readers. Cold encrypted IndexedDB
inventory stays byte-identical and the retained outbox original still
authenticates. An authenticated owner change cancels a partial wire response.
The console contains exactly the2 expected HTTP409 network diagnostics,0
warnings and no other errors. Reports: `transport-json-browser-01.{json,log}`
and `transport-json-browser-console-01.log`. Initial shell/session startup
diagnostics did not execute browser acceptance; the final named session did.

Native final frozen input02:
`F4F0CFD43E619DFC5775B18395DDCD52BD3A38E27E5B6CA98BFD7667F5147FAB`.
Build02 SUCCESS1m28s, selected JVM235/235 across32 suites,0 failures/skips.
Main APK:
`7920AB4EA310460E9B5935E3E38BFE77437F532C1D5562778C73C854EEC20E9B`;
test APK:
`FC1EEBC4E348AE0CF6529E5E5D0E29FA021937779B11CDBB6526FFB50229D6EC`.
API26/API34 each pass3/3 new actual-client cases and7/7 regressions, reports
`output/qa/security336-transport-json-api{26,34}-02/results.json`. The new actual
client cases exercise88 success/error observations per platform, preserve the
encrypted session/pending-work sentinel on refusal, prove cancellation through
both body paths, enforce declared route limits before reading and keep valid
public migration error codes. They use controlled connection ports, not TLS.

Six separate bounded host checks independently verify every fresh regression
artifact hash and all original digests:4,194,392 logical bytes/24 hashes of mixed
source history with48 encrypted rows unchanged,4,194,310 readback bytes with the
largest4MiB envelope, and the9,437,191-byte content-plan file with38 exact gets
plus3 local bytes. No transport calls or activation are inferred from the
history fixture. Max Java heaps512/192MiB are fixture settings, not peak heap,
API26/192MiB, OEM, aggregate32MiB-HTTP or product acceptance.

Full native lint01 SUCCESS15m17s; final incremental lint02 SUCCESS2m9s,0 errors,
208 warnings/8 hints and no new issue/file pairs against the accepted history
baseline. Final source and both APK identities match after devices AND lint:
`transport-json-post-{device,lint}-identity-02.json`.

Input01/build11m32s/JVM235 and its main-code lint are retained diagnostics.
Its actual-client tests failed BEFORE reading any response because the synthetic
session used64 CSRF hex characters while the existing protocol requires48.
Input02 corrects ONLY that fixture, prevalidates its CSRF and preserves the
byte-identical MAIN APK. The new test APK and actual02 reports are required;
neither failed01 device report is acceptance. No production guard was weakened.

This change still does NOT durably protect remote response originals before
normalization. It fixes parser ambiguity in the existing real channels. The
separate remote-original purpose/catalogue, complete source/plan/state4
publication, old-key custody,11 remaining real sources, normal product routing,
recovery/shared/Drive/upgrades, full48-scenario and14-language acceptance and
independent human crypto review remain mandatory. Coverage remains9/20,
production3.3.5/149, floors0/pilot/cutover off and GENESIS_DEPLOY_ANDROID=false.
