# Read-only original-device source capability

20 November2026. Selected component acceptance PASS. No product enrollment,
recovery handoff, complete content migration or activation is accepted here.
Production3.3.5/149, coverage9/20 and floors0/pilot/cutover off are unchanged.

The source-stage reader previously required an active vault, even for readback.
Reopening the old active vault on a replacement device would also import its
signing identity. The new source-reader interface admits only technical identity,
bounded source record lookup/discovery and a live guard. Source capture and
publication continue to require the separate writable active vault.

Web `openOriginalSourceStage` and native `E2eeOriginalSource.open` accept already
independently unwrapped roots and a PUBLIC original signing key. Original owner,
device scope, device ID, data generation and epoch bounds must come from the
authenticated recovery handoff. No root/signer is taken from ciphertext fields,
server booleans or a newly enrolled device's identity. The actual authenticated
handoff/independent custody integration is still a separate release gate.

The private reader restricts access to the local-snapshot source-stage namespace.
It checks record serial/context, exact original actor/generation/schema, epoch
bounds and trusted root ID before signature/AEAD verification. Discovery checks
the same bounded, length-framed technical keys as the active vault. Missing or
corrupt material refuses; there is no write, repair, new empty store, key lookup
fallback, network, lease, replay, billing or ACL authority in the returned API.

The public handle exposes only paths, openPath and close. Each path allows one
active reader at a time, so it cannot accumulate unbounded concurrent plaintext
buffers. Original metadata/callbacks/root maps are captured before the first IO.
Close revokes pending reads before returning plaintext. Web borrowed parts are
wiped after iterator advance/failure and immediately on capability close.
Native SourceInput wipes its internal bounded part on close; caller-owned output
buffers remain the caller's responsibility. Failed native post-read guards wipe
the portion that would otherwise be returned by that read.

One authenticated stage/path EOF proves only those original bytes. It does not
imply the full registry/history is reconciled or that a partial stage is absent.
The coordinator still refuses incomplete history and its v3 run remains closed.
No old device signing key is a parameter to this capability, and a separate new
device's identity is never changed by source reads.

## Component evidence

- JS red01 records the missing implementation; it is not a passing acceptance.
- JS draft02 passes105 selected original/source-stage/file/storage/migration
  cases, including5 new original-reader cases. No failure/skip.
- Scoped lint draft04 and owned types draft02 pass after the browser harness's
  prefer-const repair. The earlier harness lint draft03 failure is retained.
- Native input01 frozen as
  `6FC6A3B73E094EFABC398272DA1DDB4D93D4967235A6BDBB2B7EE0777373D8FE`.
  Build SUCCESS24m50s; selected JVM172/172,0 failure/skip. Lint0 errors,
  208 warnings/8 hints, no new issue/file pairs against file-read-stream01.
- Actual API26/API34 each pass2/2 original-reader cases, plus5/5 coordinator
  stage and4/4 retained-archive regressions,0 failure/skip. The two generated
  paths each contain35MiB+17bytes: all73,400,354 bytes read back through the
  original read-only capability match independent bounded host construction.
  Only the synthetic old LocalCipher alias was deleted; the separately active
  new-device identity stays unchanged. Each original-reader report's two
  extracted artifacts match their recorded hashes. Node WebCrypto reads both
  fresh JCA vectors with roots and a public signer only:2paths/6bytes each.
- The coordinator regressions independently match all73,400,327 primary-source
  bytes and six synthetic paths on each platform. Retained regressions match
  the whole71,305,891-byte source wire,51MiB original binary input,4 raw values
  and2 manifest histories. These remain component/source evidence, not six
  actual shared adapters or full nested-archive/recovery acceptance.
- Actual Chromium157/IndexedDB passes14/14: cold web/fresh JCA readback,
  immutable narrow capability, no original ciphertext/serial mutations,
  wrong-context/key refusal, callback snapshots, bounded concurrent readers,
  close/borrowed-byte wipe and close/account retirement during actual fetch.
  Result: `original-source-browser-final-01.json` under the runtime directory.

Original-reader fixture elapsed31,748/52,312ms(API26/API34), max Java heaps
512/192MiB. Coordinator elapsed48,240/73,986ms; retained-source elapsed
146,002/125,807ms. These are fixture durations/configured heap maxima, not
peak-memory measurements, product capacity or an SLA. Instrumentation began
from the newly assembled APKs while lint ran independently. The assembled-only
identity is saved as `original-source-native-assembled-01.json`; both hashes
match the final successful build and the frozen input was checked again.
Final verification02 corrects verification01's hint-count script (Android XML
uses severity Hint); the underlying build/XML/APK evidence is unchanged.

Main APK:
`813761A3E113A68E710C74A606887A0377887C88B069CF3550DF5BB9ACA8F94B`.
Test APK:
`25D324A005AFC6AF8F430D2DE9D451293CA62618DEBA04F4ED0209FBC14D6E07`.
Exact native reports:
`output/qa/security336-original-source-api{26,34}-01/results.json`.
Runtime host checks use `original-source-host-*`,
`original-source-coordinator-host-*` and `original-source-retained-host-*`.

The synthetic native fixture saves a separate protected root, removes only its
own old LocalCipher alias and cold-opens SQLite, then reads through the original
source capability while a distinct new active identity remains unchanged.
This is designed to test the reader boundary. It does not establish a complete
fresh-process recovery ceremony, product presence/custody, recovery-kit delivery,
all historical keys, old-device retirement, system backup or any customer data.
The original coordinates/reference and independent fixture secret are still
provided by the test; product trust/antirollback and recovery UX remain open.

Full streamed planner/common-reader input, incomplete-prefix recovery, all20
actual sources, normal writers/shared rotation/Drive, signed direct upgrades,
48 scenarios,14-language semantics and independent human crypto review remain
required. See `e2ee-336-snapshot-stream-plan.md` and the acceptance matrix.
