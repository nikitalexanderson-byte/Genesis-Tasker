# 24 November: retained controller and actual device unlocking

## Current rate correction57

Build57 SUCCESS14m52s, fresh focused6/6 JVM (not the entire suite), source
`11DB6869A7EB8294145D7B85052D27E2F4FC6B81B61CAC5EFA5316956DF3CD7C`, commit40e4f4c7.
QA APK `198B39F058D7B439F5E0961ECC0FB82F5FBE34CFFC9595CDFA86403C537E8160`;
instrumentation remained327EC0D3…11826. Genuine platform UI57 PASS4/4 on retained37:
cancel/PIN/pending-biometric background/hardware fingerprint with relocking.
Identity delivery1/1 PASS, no periodic credential refresh or new migration.
Evidence: `output/qa/security336-native150-ui57-launcher-driver-preserved37/results.json`.
The current backend differs in the exact reviewed eight payment/history paths;
its full hash6192CD13…BF357C is recorded, not described as byte-identical37.
Data preserved, services stopped and reverse removed. Retained37 must be cleaned
before release. The later scenario35 interface correction has separate inputs;
these results are not acceptance of that later diff.

## Live Play signing comparison57

Read-only Play Console App signing for `ru.genesis.calendar` showed an in-use
signing key and the Digital Asset Links fingerprint
`1e161d36f574b0560d808c7ee95e1abe98165b3385336d0276fb381dfd901cb8`.
It matches the existing website release certificate requirement. Evidence:
`output/release-3.3.6/runtime/play-signing57-20261124.json` and the browser
observation. No signing settings, tracks or releases changed. This accepts only
the live certificate comparison; final signed150 identity and actual149-to150
data-preserving update remain required for scenario42. The console also showed
a separate November22 payments-account notification, which was not modified.

## Current candidate41

Native41 rebuilt the accepted unified website/payment changes and browser
retirement modules with a fresh JVM task:1453 tests,1445 passed,0 failed,
8 existing opt-in skips. Build SUCCESS21m52s; source
BEA956EAAE847329A0C221CF5B14E491E156B6EC4C173F4E1B7D4D504D230308.
Product QA APK95995C54F331E9943FC4EF6A89DCE8F70B7C022C864AC0D8775CA8B4BC982D8C;
instrumentation remained327EC0D32B7F7E428019F353946BEC9C477FCBC39010F2DFDD5C6FE65CE11826.

UI41 PASS_LOCAL_SCOPE4/4 reuses the retained accepted controller37 fixture
without repeating migration, resetting keys or clearing app data. Genuine
platform PIN/fingerprint/cancel/background cases passed on the new product APK.
Evidence: output/qa/security336-native150-ui41-launcher-driver-preserved37/results.json.

The current backend differs from controller37 only by six explicitly reviewed
unified billing/donation files. The runner rejects any other path or dirty
backend; E2EE guards/transports and fixture sources are unchanged. It records
backendUnchanged=false and the full new hash
BAAD5E689DD2FF7E585BE84874FB1BDFB83010B3708F51D5CA764010C1E4518C.
It does not claim a byte-identical backend. Services stopped and reverse mapping
removed; retained owned fixture remains for cleanup before release.

The following section preserves the older accepted product37/40 evidence.

The production QA APK remains byte-identical to build37:
`7A7AF1CFB732BF00726E5B8B49DD050CE205E86C872D6B61B4D33A81A9F44D8F`.
Build37 executed the JVM suite:1452 cases,1444 passed,0 failures,8 existing
opt-in skips. Builds38–40 assembled instrumentation only; they did not execute
new JVM tests. No copied XML is counted as a new run.

## Controller and unlock

Controller37 platform result is PASS_LOCAL_SCOPE, actual migration/private
normal reader/cold PIN1/1. Its wrapper originally remained INCOMPLETE because
of the separate UI driver. The same owner-checked, stopped synthetic runtime
was retained; no second migration or vault reset was performed for UI acceptance.

Final UI40: PASS_LOCAL_SCOPE,4/4 on owned API34 emulator-5580:

- Cancelling genuine platform authentication cannot open the vault.
- System PIN opens retained edited content; actual background relocks.
- Backgrounding a pending fingerprint cannot admit it after return.
- Emulated hardware fingerprint37 opens retained content; background relocks.

Evidence: `output/qa/security336-native150-ui40-launcher-driver-preserved37/results.json`.
The driver separately delivered the same ordinary synthetic login identity,
then performed genuine launcher entries and responded only to observed platform
PIN/fingerprint surfaces. No auth-success callbacks or periodic HAT refresh
were injected. Backend bytes were unchanged and QA data preserved. Services
stopped and reverse mapping removed; the retained backend must be cleaned before
release. Main package and personal devices were untouched.

Instrumentation now targets the real enabled clickable ancestor of Compose
Text and waits for actual STOPPED after Home. A Text child's enabled flag alone
does not prove button interactivity. It also avoids a duplicate in-process launch.
Earlier UI37/38 results remain2/4, and UI39 remains prerequisite failures;
they have not been relabelled as passing product journeys.

Build40 native input hash:
`A352EAC5FFB1265F1C53C513E034EFFEF7B82A60ACF3DE41E11D26CBE8F6AB76`.
Instrumentation APK:
`327EC0D32B7F7E428019F353946BEC9C477FCBC39010F2DFDD5C6FE65CE11826`.

## API26 component regression

Source37 per-case report originally contains36 passes and1 capacity-race failure.
Its top-level passed=2 was also a runner aggregation error over mixed dictionary
types; `derived-totals.json` records36/1 without rewriting the original result.
The failed race spent349 seconds preparing/attempting protected key creation.

Source39 repeats that one race with a real observed system credential after
preparation: PASS_LOCAL_SCOPE1/1, no periodic refresh, original NONE restored.
Evidence: `output/qa/security336-native150-source39-api26-prepared-capacity/results.json`.
The product APK is identical. The instrumentation itself records the actual
system credential hierarchy; the external driver reads it instead of registering
a competing UiAutomation client. The observed owned-AOSP verifier crash was
closed normally without changing verifier/security settings. The earlier setup
failures are retained as INCOMPLETE.

These results accept the stated controller/unlock and component scopes. They
do not claim completion of all20 private paths,48 system scenarios, signed
149→150 delivery, final internal crypto review, or the3.3.6 release.
