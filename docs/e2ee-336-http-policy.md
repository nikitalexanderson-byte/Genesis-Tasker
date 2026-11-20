# E2EE HTTP origin, error and identity boundaries

21 November2026. Working increment after protected-original component
`e52b553f356148f9a85885a5dfe28387c539b178`. Web implementation/regression is
verified below, together with final native build/provider/lint acceptance.
No deployment, coverage increase, pilot/cutover or human cryptographic approval.

## Reproduced failures

The actual cloud client used fetch's default redirect policy for E2EE routes.
A generated two-origin loopback browser witness proves that a307 forwarded a
synthetic POST and its synthetic CSRF header to the second origin and accepted
that origin's response. `http-policy-browser-red-01.log` records three failed
checks; `http-policy-browser-red-metrics-02.log` confirms one forwarded request
and the header. This is a synthetic local test, not a production leak. A first
metrics CLI attempt suffered Git Bash path conversion inside its JS argument;
the corrected command used the observed absolute loopback URL. It does not
change or explain away the independently reproduced application failure.

Web also accepted arbitrary server error text merely beginning `E2EE_`, exposing
free text and the generic error object's original payload. The three real-client
unit RED witnesses are in `http-policy-web-red-01.log`; the initial bounded
synthetic diagnostic is `http-policy-negative-witness-01.json`.

Both clients could feed a syntactically valid E2EE root `user` to ordinary
profile/session handling before the actual content caller checked its semantics.
Native could also persist a root `csrf`. A real AuthSessionClient/Keystore
session test on API34 reproduces identity adoption with a controlled connection:
`output/qa/security336-http-policy-red-api34-01/results.json` has4 passing and
1 failing case. The failure is specifically `E2EE content published session
fields`, not setup or JSON parsing. That diagnostic's input/APKs are separate
from final candidate acceptance. Existing native redirect/code handling passes.

## Implemented policy

For the seven existing E2EE routes only, web fetch explicitly uses
`redirect: error`. It overrides any inherited RequestInit redirect setting.
Other authenticated routes retain their existing redirect policy. Native already
sets instanceFollowRedirects=false; its actual-client regression now proves it.
This does not change configured API origins or pin a new certificate authority.

HTTP400..599 errors accept only the existing native-compatible technical grammar
`E2EE_[A-Z_]{1,80}`. This is a bounded code grammar, not an exhaustive semantic
allowlist or permission grant. Valid migration/source/fencing codes survive.
Other error bodies become fixed `E2EE_HTTP_ERROR` with a null exception payload.
For admitted codes, web retains only `{error: code}` before the outer adapter
projects the stable code. Arbitrary body fields cannot reach billing/upgrade
notifications, exception messages, payloads or causes through this path.
Protected raw observations still retain their exact original error bytes; the
new policy does not delete originals or change the existing8KiB error limit.

Successful E2EE responses containing OWN root `user` or `csrf` fields refuse with
`E2EE_INVALID_RESPONSE` before profile/trial publication or native session/cookie
persistence. The real E2EE API and all current legacy response wrappers emit
content/control fields, not those root identity fields. Internal PHP context
objects may contain `user`; they are not that external response contract.
Nested private property names remain ordinary content for their semantic reader.
Ordinary session/profile endpoints retain their existing behavior and Google
identity remains a separate authority. Browsers still manage same-origin cookies
at the network layer; a JS body check is not control over browser Set-Cookie.

Strict UTF8/JSON, raw observation ordering, account cancellation, byte budgets,
same-actor quarantine and pending originals remain unchanged. No crypto root,
enrollment, billing, ACL or recovery authority is imported from these bodies.

## Verification in progress

Profiled JS39/39 passes: three new actual-client cases,15 strict-response cases,
seven observation-ordering cases and14 protected-original cases, in
`http-policy-web-01.log`. Full JS1980/1980,0 failures/skips, passes in
`http-policy-full-js-01.log`, with the validated PHP runtime used by the two
PHP-dependent regression tests. Owned types01 and scoped lint01 pass.

Chromium157 passes9/9 actual two-origin loopback checks in
`http-policy-browser-02.{json,log}`. Metrics02 independently reports0 forwarded
requests and no forwarded synthetic CSRF, compared with1/true before the fix.
Both reserved fields refuse without changing earlier local records. Console02
contains exactly the three expected diagnostics: one blocked redirect destination
and two deliberately returned HTTP409 responses;0 warnings/other errors. A
console entry naming the blocked destination is not evidence of a sent request;
the independently counted receiving-origin requests stay0.

Static web build01 and all existing gallery/documents/dictionaries/offline/worker
checks pass:98 HTML variants/14 languages/280 images and authored disclosures
remain intact. No UI copy, locale selection or public payment behavior changes.

Final native input01:
`1E4FEBF8B9154CF4416A40F74495A04445D3DDBA1CA0A1A4CB139E11EA0B58BC`.
Build01 SUCCESS10m23s; broad JVM248/248 across33 suites,0 failures/skips.
Main APK:
`645F54154712CDE2C6E8A92E75654AE4E149ECD9FDC84CFD7F7E5D87EAC73216`;
test APK:
`C7AC72E27BD57ACD94CDB909A6CCC1962A815842A92D2D97945556AA4C62FF29`.
Actual API26/API34 each pass5/5 AuthSessionClient cases (including the previously
failing identity/CSRF case plus redirect/error-code parity) and4/4 protected raw
original regressions. Both reports' exact source/APK identities and required
method coverage are verified by `http-policy-native-device-summary-01.json`;
post-device identity01 matches. The same compiled test APK used by the diagnostic
RED remains valid for the new MAIN APK; main-source hashes are different and
the final reports are required. Do not relabel the failed RED as final acceptance.

Native lint01 SUCCESS16m15s:0 errors/208 warnings/8 hints and no new issue/file
pairs against accepted raw-original lint01. The copied XML/delta and final
post-device/post-lint source plus both-APK identity checks match frozen input01.
Original security prompt SHA256 remains unchanged. This increment is locally
accepted within this component scope; its own CI is still pending. All real-client
native cases use the actual Keystore session/HTTP implementation with controlled
HttpsURLConnection ports; this is not live TLS/backend, process-death, physical
device, Google Play or full product E2EE migration/recovery acceptance.

These checks do not close mandatory capture factories/source-plan-state4,
authenticated original custody, the11 remaining real source categories, normal
writers/unlock/enrollment/recovery, shared ACL+rotation/files/Drive, direct signed
upgrades,48 system scenarios,14-language semantic acceptance or independent
human crypto review. Production stays3.3.5/149, floors0, pilot/cutover off,
GENESIS_DEPLOY_ANDROID=false. No personal device or Play track is changed.
