# Protected remote originals: component implementation and contract

The web and native same-active-actor quarantine and optional real-HTTP observation
ports are implemented. This is a component, not complete migration custody or
release acceptance. Concrete coordinator factories, mandatory observations for
all legacy reads, original-role custody, durable key adoption and source/plan/
state4 composition remain unfinished. The original3.3.6 prompt, coverage9/20 and
release gates remain unchanged. Strict wire JSON is handled separately by
`e2ee-336-transport-json.md`.

`app/e2ee/remote-original.ts` and native `E2eeRemoteOriginal.kt` use the distinct
`remote-original/v1` purpose in ciphertext-only local-snapshot storage. Their
metadata is the existing canonical binary command codec, not regenerated JSON;
the separately retained request and response parts preserve original bytes.
They do not widen any original-source read capability or reactivate an old
private signer. The same active actor must still supply the roots/public signer.

## Capture before projection

An authenticated legacy read can contain the only remaining original of a
remote value, retained key or archive fragment. A pre-network local snapshot
does not contain that later response. Neither a parsed object nor a partial
derived content plan proves reproducibility after a server-side deletion.

Register an observation under the actual coordinator fence BEFORE sending its
request. Its binding must snapshot the exact signed request, original active
actor/namespace, target owner/scope/kind, migration attempt, source hash, lease
fence, directory revision/checkpoint and any table/record/byte offsets. Bind the
actual transmitted request snapshot as well; a mutable JSONObject or caller
object cannot be rebound while waiting for a transport permit. A participant's
local actor and the target project owner need not be the same identity.

Use a distinct authenticated remote-original purpose and catalogue. Partial
remote pages cannot enter the existing complete local source-stage catalogue.
No old private signing identity is reactivated. Observations are inert source
material: they grant no billing, ACL, session, replay, device or migration
authority, and do not authenticate historical content against a malicious old
server. Old key material inside a raw response still needs exact original-AAD
materialization before semantic reconciliation and portable recovery.

After the response arrives, protect its bounded HTTP metadata before body
consumption. Await durable acknowledgement of every consumed raw byte range
BEFORE UTF8 decoding or JSON projection can use it. A complete raw EOF marker
precedes JSON parsing; it records wire completeness only, even when strict JSON
later refuses duplicate fields. Invalid UTF8 found before EOF may leave a
partial observation; never infer EOF from a prefix or a short part.

Route byte budgets stay unchanged. No aggregate raw body, giant bridge/base64
argument or whole-file ciphertext array may be introduced to satisfy custody.
Native reads/captures use bounded buffers and the web awaits the actual sink;
neither may accept a transport-piece split followed by whole-input assembly as
the completed streamed source/plan implementation.

## Durable state and admission

Catalogue registration and the initial request journal publish atomically.
Each append atomically publishes an immutable encrypted raw part and the exact
next journal prefix, with serial CAS and original byte hashes. EOF publication
binds all offsets/sizes/parts and a complete original SHA256. A failed write/CAS
does not publish parsed success or clear any earlier part. Registration,
receiving and complete states remain distinguishable after process death.

Admission includes existing incomplete/cancelled observations, complete remote
originals, source/plan/coordinator metadata and provider record/free-space
limits. Reserve before consuming more remote data. A catalogue-only counter is
not a provider-wide capacity check. Refusal must preserve the complete previous
store and give the future product recovery flow a usable path.

The implemented per-context ceilings are128MiB raw,8000 parts,1000 observations,
10000 records and16MiB aggregate metadata; each metadata value is at most2MiB,
the transmitted request128KiB and a raw part64KiB. Existing HTTP budgets are
unchanged:16MiB successful read,8KiB error. Request/journal/catalogue and complete
manifest costs enter admission, including retained prefixes and earlier attempts.
The external admission callback must additionally reserve provider-wide room
for source/plan/coordinator records. Its presence does not prove that reservation
or provide a product recovery path. The fixtures use controlled admission ports.

Observation failures expose fixed local codes. Arbitrary provider exception
text, paths and causes cannot become an HTTP exception; Android converts these
to AuthApiError before the generic network/protocol classifier. Cancellation
retains its identity. This is not yet localized product handling of each refusal.

All awaited registration/append/EOF operations repeat owner/vault/fence guards.
Retirement revokes the live capability, closes the input and keeps its original
actor's protected prefix. Cleanup never deletes an incomplete observation or
labels it disposable derived data. Separate close/revoke from durable EOF.
Do not swallow cancellation while handling an HTTP error or cleanup failure.

## Read and coordinator composition

Discover authenticated role/owner/epoch/target locators before opening bodies.
Unknown/unbound remnants and incomplete catalogue/journal/part inventories
refuse. Readers verify exact request binding, immutable part serials, original
hashes/lengths, EOF and final catalogue/serial/locator stability. A prefix may be
offered only as explicitly incomplete inert source material, never a complete
path or a successful migration receipt.

State4 must reserve and bind the EXACT owned observation and derived-plan
attempt to all original source references before changing upload/activation
state. A losing CAS preserves every losing original and plan. The current
same-actor history scope continues refusing network-touched history and
content-plan journals until this composition exists; no arbitrary ignore-list
may bypass those guards. Cross-device use still needs authenticated custody
and an original-role read capability with roots plus public signer.

## Negative witnesses and required verification

The initial three RED ordering failures are retained in
`output/release-3.3.6/runtime/remote-observation-wire-red-02.log`. The seven wire
tests now pass: exact raw capture before duplicate refusal, independent expiring
bounded loans, immutable registration before the actual authenticated fetch,
failed registration, retirement before networking/during acknowledgement and
failed append without parsed success. This memory port alone is not custody.

Two additional web RED witnesses in `remote-original-refusal-red-01.log` prove
the former arbitrary provider exception leak and the explicit-close-after-EOF
web/native disagreement. Both are fixed; early close still cannot yield a
receipt. Native `remote-original-native-refusal-red-01.log` separately proves
the former unsanitized local IOException path.

Web component tests14/14 plus wire7/7 and original HTTP15/15 pass together in
`remote-original-web-04.log`. Actual WebCrypto/AEAD storage tests include cold
capability reopen, exact raw hashes, retained incomplete attempts, failed quota/
storage, request/lease/context mismatch, missing/forged parts, unknown roles,
serial drift, escaped/early readers and catalogue mutation. Validly resealed
metadata cannot rebind its original signed source token before body lookup.

Chromium157 actual fetch and encrypted IndexedDB pass19/19 in
`remote-original-browser-03.{json,log}`; console03 has0 errors/0 warnings. The
independently generated raw body is2097234 bytes, SHA256 base64url
`4vOdg8L5Ep5mCTV4gYdojFqEwdn4uZWDVwMxBqEJShQ`. Cold readback preserves every
encrypted record byte-for-byte. The rejected duplicate retains its exact51-byte
BOM/whitespace body. Process-style partial close, opt-in incomplete read, quotas,
early/escaped readers, retirement and actual failed registration/no networking
are covered. Cold capability/DB reopen uses retained fixture keys; it is not a
new process, old-key loss or authenticated recovery handoff.

Owned types04 and scoped lint04 pass. Earlier diagnostic lint03 failed on an
empty test loop only; its comment was added and the rerun passes. Browser01
covered the previous16 checks;03 is the final19-check component report.

Final full JS1977/1977,0 failures/skips, is recorded in
`remote-original-full-js-02.log`. The first full run passed1975 but failed two
PHP-dependent tests because the previously recorded temporary executable was
missing. Its archive still matched the pinned official SHA256; it was extracted
to a fresh owned directory, without changing production or tests, and runtime02
records validation of PHP8.4.27/all required extensions. The complete rerun
passes. Static web build01 plus gallery/documents/dictionaries/offline and the
separate legacy-worker export check pass;98 HTML variants/14 languages/280 gallery
images and existing disclosures remain intact. No UI text or language rule changes.

Native frozen input01:
`0BC8290607FE3CE6B33082C182AE475ACADF336BE02AAC33A4B44FB57AB5A7B5`.
Build01 SUCCESS10m27s. Component JVM17/17; broad E2EE JVM248/248 across33 suites,
0 failures/skips, in `remote-original-native-unit-{01,02}.json`.
Main APK:
`1044CD0BBFBB03B732009D7FA1467E4177F78C6D7AE22A71743849B0DBAF78C7`;
test APK:
`24C026837F54343570B1D8601191AA271A163DB4DC51F54C421C48E7F1632279`.
These hashes are separate from the earlier strict-JSON component artifacts.

API26/API34 each pass4/4 new real-client/JCA/Keystore-session/ciphertext-SQLite
cases and3/3 strict-JSON real-client regressions. Actual reports are
`output/qa/security336-remote-original-api{26,34}-01/results.json`, with the exact
fresh source and both APK hashes. The independently constructed native fixture
is524370 bytes, SHA256 base64url `thSKPIJAt8jcxbfVISPFpKEEuM6Ul2gtJwCmFAwP030`.
The device test verifies the complete original and cold read receipt against
its fixture hash and leaves ciphertext rows unchanged. No external data file
is emitted by this suite; receipt values are asserted within the device test.
Tests also prove retained8192-byte partial input on an injected storage IO
failure, fixed local failure classification without the private canary,
duplicate refusal after protected EOF, quota before networking, early/escaped
reader revocation and cancellation before connection/admission publication.
They use the actual AuthSessionClient with a controlled connection factory;
they are not real TLS/backend tests, process death, physical/OEM or portable
new-device recovery. Only the isolated QA package on the two owned emulators
is installed/reset. Personal devices and Play are untouched.

Native regression/lint01 SUCCESS13m49s:0 errors/208 warnings/8 hints, with no new
issue/file pairs against accepted strict-JSON lint02. Exact XML/delta and
post-device/post-lint source plus both-APK identities are retained in
`remote-original-native-lint-{01.xml,delta-01.json}` and
`remote-original-post-{device,lint}-identity-01.json`. The original security
prompt SHA256 also remains unchanged. The component is locally accepted within
these limits; its concrete transport factory/state4/custody integration is not.

Separate next-step HTTP policy witnesses are NOT part of this component's
acceptance: current web fetch can follow a redirect and its generic error path
can expose arbitrary server text. The two-origin synthetic browser and unit RED
records are `http-policy-browser-red-01.log`/`http-policy-web-red-01.log`. Root
user/CSRF fields must also be prevented from reaching session/profile adoption
on both platforms before content semantic validation. Do not claim those gaps
fixed by the raw quarantine; the next increment must keep its own evidence.
The following working implementation and its separate gates are now recorded in
`e2ee-336-http-policy.md`; the historical raw-original acceptance above does not
stand in for that candidate's new MAIN APK or native/provider/lint checks.

The remaining integration must additionally prove actual encrypted IDB/SQLite cold
readback, interrupted/failed/CAS-losing attempts, malformed/error/oversize
responses, quota/key loss, source/lease/context changes, unknown and missing
roles, strict pre-/post-consumption guards, complete raw hashes and actual
authenticated web/native transport usage. Retain byte-identical originals in
every refusal case. No production activation, coverage increase or independent
human review is implied by passing this component's tests.
