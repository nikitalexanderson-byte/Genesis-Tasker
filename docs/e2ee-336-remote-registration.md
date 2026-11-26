# Remote-original registration and metadata discovery

21 November 2026. This increment supplies the missing pre-network identity and
restart descriptor APIs on web and Android. It does not implement state4,
mandatory capture factories, provider-wide admission or original-key custody.
Real source coverage remains9/20; production remains3.3.5/149 with floors0 and
pilot/cutover off.

## Contract

- `ProtectedRemoteOriginal.registration()` / native `registration()` returns an
  immutable technical identity before `prepare`: the generated observation id,
  original actor/target context and exact signed request binding. It performs
  no storage, key-adoption, admission or network operation. It remains inert
  after close/retirement and grants no durable-original or completion receipt.
- `describeRemoteOriginal` / native `describeOriginal` authenticates the retained
  request bytes, original signature and full request binding before any response
  body lookup. It enforces the existing inventory/capacity/current-actor checks
  and rechecks catalogue stability after verification. Request bytes are wiped.
- The descriptor reports registered, receiving or complete metadata with
  **`bodyVerified:false` in every phase**. Even a complete authenticated journal
  does not authenticate its response parts. `withRemoteOriginal` / native
  `withOriginal` must still read every part and reach actual EOF before a receipt.
- Web descriptors and nested records are frozen. Native DTOs contain immutable
  values rather than shared JSON objects, and their `toString` is redacted.
  Exact cancellation is preserved. Physical request BOMs now refuse consistently
  on web/native, including validly resealed local metadata; response BOM behavior
  and the strict old-format readers are unchanged.

## Verification

Evidence is under `output/release-3.3.6/runtime/remote-registration-*` and
`output/qa/security336-remote-registration-api{26,34}-01/`.

| Check | Actual result |
| --- | --- |
| Full JS suite |2000/2000,0 failures/skips; `full-js-03.log` |
| Actual Chromium157 fetch/WebCrypto/IndexedDB |23/23, console0; `browser-01.json` |
| Scoped ESLint / owned TypeScript |PASS; `lint-01.log`, `types-01.log` |
| Fresh main/test APK build |SUCCESS11m4s; `native-build-01.log` |
| E2EE JVM |254/254 across33 suites,0 failures/skips; `native-unit-01.json` |
| Actual API26 and API34 |Each13/13:6 remote-original,5 HTTP-policy/JSON,2 envelope cases |
| Native lint |SUCCESS11m51s,0 errors/208 warnings/8 hints; no new issue/file pairs or count increases |
| Static web build |PASS;98 HTML/14 languages/280 gallery images, disclosures, locale/offline/worker checks |
| Final source/APK identity |PASS after devices, lint and web build; `final-identity-01.json` |

The component is locally accepted within these limits. The final identity
record binds the frozen source, both actual APKs, device/JVM/lint evidence and
the unchanged original security prompt. It is not full release acceptance.

The browser independently checks2097234 original bytes, SHA256 base64url
`4vOdg8L5Ep5mCTV4gYdojFqEwdn4uZWDVwMxBqEJShQ`. Native cases use actual
Keystore/session/ciphertext-SQLite and a controlled AuthSessionClient connection
factory. They reopen SQLite, discover partial metadata without body reads, and
show that a complete descriptor cannot authenticate a corrupt response part.
Stored ciphertext remains unchanged on refusal and subsequent valid readback.
These are controlled provider cases, not live TLS/backend, OS process death,
physical/OEM devices, portable recovery or full product migration.

Frozen native input:
`181ED242A8FB0A64B43F54610D94F49280F23271CCC309DCB4A67C9C83AB843B`.
Main APK:
`BA02B19896BE00EF36AA7B90150D29F3956C784601B6DCC86DC777A46E8C1ADE`.
Test APK:
`022460D3A2864CC1457748CD706B6B3C3BC782501A591F20EE25BEF26E99295D`.
The exact input and both APKs are bound by the build and device reports. Only
the two owned QA AVDs and isolated QA package were used; personal devices and
Play were untouched. There is no new public UI text or language-rule change.

The full-JS01 run exhausted host memory while overlapping Gradle. Full-JS02
passed1998/2000 but lacked the recorded PHP runtime in that new shell. Full-JS03
uses the verified local PHP8.4.27 and the exact `scripts/test.mjs` enumeration
with file concurrency4; all2000 cases pass. Tests were neither removed nor
weakened. The failed logs remain separate from accepted evidence.

## Remaining integration

State4 must reserve/bind the exact registration and owned plan attempt to all
original source references in the coordinator CAS before network consumption or
plan advancement. The descriptor is a discovery input, not storage reservation
or historical authenticity. Concrete factories must use the provisioned device
and a signer matched to its verified directory roster, durable key adoption and
real provider-wide capacity accounting. Keep v1/v2/v3 history refusals strict;
an arbitrary prefix ignore-list cannot replace provenance, custody or recovery.
