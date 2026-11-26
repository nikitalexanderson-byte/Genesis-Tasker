# Private activity uploads: correction87

Actual mounted membership73 logged70 rejected `/metrics` POSTs and26 rejected
`/feature-usage` POSTs after activation. Server409 prevented legacy writes, but
could not prevent receiving the request bodies. The client transport policy
omitted these two routes. Private task/habit counts are already derived from
encrypted content; their legacy aggregate copy must not continue after activation.

The shared JS/Android/PHP transport contract now protects both route prefixes,
including trailing-slash aliases. The deployed PHP policy resource is identical
and the classic worker was regenerated. Existing mutation fences now cover an
activation racing the page's early check. Web's optional aggregate/usage calls
return without HTTP for confirmed, cached or locked private accounts. A scheduled
metrics callback also checks its captured session before using its old inputs.
Existing source history and encrypted domain data are retained. Legacy accounts
keep their previous behavior; this does not add analytics or server-visible counts.
Historical feature_usage classification is not rewritten by this client policy.

Acceptance: focused JS/worker/fence20/20 PASS, including old raw requests with
and without owner headers. Shared classification fixture now has52 vectors and
continues to be consumed by native/PHP checks. Actual Chromium/IDB/Web Locks/SW
run `output/playwright/security336-activity87-1124-04/results.json` PASS5/5:
legacy uploads, preparing-marker deny before HTTP, raw old-page SW deny, active
locked profile/no vault authority, independent later legacy account. The server
counters prove no new private POST reached the fixture in the refused cases.
No provider, private account key or simulated vault unlock is supplied.

Early browser01 used an outdated fixture worker without completed-background
attestation;02/03 exposed the new fixture route below its old GET-only guard.
These are retained setup failures, not product passes.04 corrects only those
fixture issues. The first direct Node test call used strip-only TypeScript and
failed its prerequisites; the normal project transform/resolver flags pass20/20.
Types/scoped lint and build87 pass. Immutable87 has8983files, SHA256
5955b3f5123feb5f83f189696653c331c6cb5ca1bcabea58f86599f1f1e10d22. Native88
SUCCESS2m18s includes one forced fresh JVM policy test with all52 vectors and
zero failures. The actual packed APK policy matches the reviewed contract
exactly (runtime/native150-activity88-policy-asset.json). This is not a full JVM
or native HTTP/UI run. Native84 predates this block; main149 was not changed.

Production remains7964526b/APK149. Whole20-path/48-scenario acceptance, final
review and signed149→150 are still open; no privacy claim is based on counts.
