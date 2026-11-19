# Retained native migration keys — 19 November 2026

This increment concerns diary and personal mindmap migration captures. It does
not provision a new vault, export an Android Keystore key, activate E2EE or
publish 3.3.6.

## Failure being addressed

The previous capture retained exact encrypted local documents and decrypted
caches, but the old account key only as its LocalCipher-encrypted wrapper. If
that Keystore alias disappeared after the new-root-protected capture committed,
reconciliation could still fail while reopening the old key. This matters for
independent old keys and pending encrypted operations which cannot be opened
with a current server account key. Refusal preserved the sources, but the saved
capture was not independently sufficient to finish migration.

## Change

The native capture now opens and validates the old account key before source IO,
and retains it beside its original encrypted wrapper in the capture. The existing
migration coordinator encrypts that capture under the new root before the first
legacy request. This follows the retained-old-key pattern already used by the
native task, Aurora and Stoicheion captures.

Only old legacy key material is retained. New roots, device private keys and the
non-exportable LocalCipher Keystore key are not exported by this change. It does
not recreate a missing alias or change any source row.

Both current and historical captures are cloned and stripped of the retained key
before entering the network-disabled WebView. The native opening capability is
still restricted to exact captured envelopes and their original purposes. The
key is absent from reconciliation outputs and new remote content. Native decoded
key buffers are cleared after use; immutable legacy JSON/key strings have the
same runtime-memory limitations as the existing capture formats.

Old captures without the added field remain readable using their original
LocalCipher key. They do not become recoverable retroactively if that key is
already lost. A malformed retained key fails before source IO; disagreement
between retained keys for otherwise identical captures requires explicit history
review. Adding the retained key to a newer capture does not by itself turn an
otherwise identical older capture into a content conflict.

Recovery still requires the protected snapshot bytes and access to the new root
through an accepted unlock/recovery path. A recovery secret cannot reconstruct
device-only ciphertext which has been lost. Product recovery/unlock and backup
acceptance remain separate release gates.

## Verification

Evidence is under `output/release-3.3.6/runtime/`.
`native-retained-old-key-build-01.log` completed BUILD SUCCESSFUL in 17m21s:
main/test QA APKs, JVM tests and lint. Lint has zero errors, 206 existing warnings
and eight hints. APKs were tied to their unchanged source hash before
instrumentation, and the full build finished without changes to its inputs.

New JVM cases cover later Keystore loss with a client-mode old key, stripping
current and historical bridge inputs, older captures, malformed key types/values
and inconsistent retained key history. Actual API34/35 cases capture through the
real Room/Keystore path, store under the new root, erase the fixture's old alias
and key bytes before the first source request, construct a fresh source adapter,
and reconcile without a server-provided old key. They must then read the migrated
content with only the new root and verify exact unchanged legacy rows and no
replacement alias. These cases passed on both API34 and API35.

- `native-retained-old-key-jvm-summary-01.json`: 1184 tests / 215 suites,
  1176 passed, 8 opt-in real-PHP HTTP cases skipped, zero failures. All four new
  key-retention/compatibility cases passed.
- `native-retained-old-key-instrumentation-summary-01.json`: API34 76/76,
  API35 76/76, zero failures/skips, including both new actual late-alias-loss
  cases and the previous large-history source/storage regressions.
- API26 18/18 key/JCA/old-provider gate cases passed again on the assembled APK.
  Its original Chromium69 still prevents supported-provider migration acceptance;
  this does not claim the two packaged source migrations passed on API26.
  `native-retained-old-key-api26-artifacts-01.json` retains 84 localized fallback
  PNGs and hashes. UI copy/assets are unchanged by this increment.
- `native-retained-old-key-build-identity-01.json` binds the APK hashes and native
  inputs. All three task-owned emulators were stopped after parsed acceptance.

All fixtures use a separate QA package, unique synthetic accounts and their own
aliases. No personal device, Play track, source retirement or release flag is
changed. Source coverage remains 7/20; independent crypto review and the full
product/recovery/direct-upgrade acceptance remain mandatory.
