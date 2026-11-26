# Secret peer-key change: scenario35

24 November2026, correction after native57. Current Messenger already refuses
a different pinned device/key pair. Its web/native interfaces incorrectly used
the generic pending-or-disconnected notice for that refusal. Web also retained
the previous security code after this particular refresh failure.

The correction adds a separate changed-key notice on all14 languages and clears
the stale web code. It does not replace pins, keys, message history or drafts;
the original secret-chat protocol still has no forward-secrecy claim.

Acceptance added for the actual current native MessengerRepository with real
P256/message encryption and synthetic transport/durable-memory ports: changed
peer key, substituted public key, blocked sends, cold retained pin/draft and
original-key history readback. Browser acceptance mounts the actual Messenger
with real WebCrypto/IndexedDB and an ordinary synthetic backend login. Chat
responses are modeled, including a substituted peer public key; this does not
claim real two-party server enrollment or private-vault storage acceptance.

The browser check covers the visible warning, stale-code removal, disabled Send,
encrypted local draft, cold retained pin and original-key history. Its localized
layout matrix is14 languages ×4 widths ×2 schemes. Results, exact input hashes
and limitations must be recorded after execution; no new PASS is claimed here.

## Native58 and the discovered web composition gap

Native58 SUCCESS12m44s, fresh focused8/8 JVM including both current-repository
peer-pin cases. Exact input6D331482…1928C2F; results are in runtime/
native150-secret-build58-{result,jvm,identity}.json. This accepts the stated
native repository cases, not a second complete UI migration or all scenarios.

The browser drill exposed an implementation gap: normal web textarea changes
were held only in React state. No general autosave existed, and an unfinished
edit could not survive reload with its original target/revision. Code59 adds
an encrypted versioned composition, ordered owned writes, cross-tab Web Locks
CAS, exact edit target/base revision and stable create token. Legacy raw text
is read without interpretation and retained. Replaced/acknowledged compositions
and command originals remain encrypted inert history. An acknowledgement clears
only its exact composition; revised text receives a fresh create token, while
another composition is preserved. Failed saves block send/navigation and cause
the ordinary browser unsaved-work prompt. Lock/account changes clear the UI
and owned in-memory journal references. No background write or plaintext fallback.

New browser runs58-01/02 were setup/selector failures (missing public build
defines, then an intentionally absent Send control). Run03 demonstrated the
missing draft after the key change. Its earlier async wait incorrectly treated
a Promise as evidence: that first PASS does not prove persistence. The harness
now explicitly awaits the actual encrypted-cell read and a bounded boolean poll.
All three owned runtimes were cleaned; original failed reports remain unchanged.
Code59 adds source regressions for ordering, failed storage, competing readers,
late/repeated acknowledgement, cold edit identity and malformed/foreign input.
The full mounted browser drill also exercises exact lost-ACK retry and cold PATCH.
New code59 acceptance is pending; no failed result is relabelled PASS.

## Accepted bounded web59 result

`output/playwright/security336-secret-peer59-1124-05/results.json`: PASS5/5
functional checks and112/112 localized layout cases, cleanup PASS, input source
unchanged throughout. Source snapshot08b861a1…5cf17f, entryd7be45bd…70f716.
Actual WebCrypto/IndexedDB preserve the draft after the changed key and cold
reload. Replacing the modeled reply with the original peer still opens retained
history. A lost message ACK is retried after cold reload with byte-identical
POST; no duplicate message appears. A cold unfinished edit emits PATCH with
the original message ID and base revision, never another POST. Three modeled
mutation attempts total: original POST, exact retry and PATCH. No page errors.

Pure composition regressions8/8 PASS; types/scoped lint and build:web PASS.
Identity changes now key the inner Messenger component so old state cannot
follow another user; this also resolves the new lint rejection of effect-time
state resets without disabling that check. I18n/native export audit58 PASS and
all14 changed-key messages were read semantically; their catalogue is unchanged59.
Manual screenshots: RU390light, EN1440dark, JA360dark. Remaining109 combinations
have geometry/input checks, not manual visual review. This is the standalone
component with modeled chat transport, not whole-app or font-scale1.3 acceptance.

Run59-04 passed the same first4 functional checks and112 layout cases, but its
last assertion matched edited textarea text before the PATCH finished. The
corrected59-05 waits for the actual message row. The original failure and cleanup
remain recorded. Protected private-vault storage, final native asset59 identity,
complete20-path/48-scenario review and signed149→150 are not claimed here.

## Actual competing tabs60

The follow-up retains a rejected competing composition as a separate encrypted
inert conflict record. It cannot replace the active draft. Input callbacks also
check the chat and token captured by their rendered editor before accepting a
late event. Pure regressions remain8/8 PASS; types/scoped lint PASS.
`output/playwright/security336-compose-two-tabs60-1124/results.json`: PASS2/2,
real two-page IndexedDB/Web Locks CAS and encrypted readback of both intents,
blocked send after save failure, zero message writes/page errors, cleanup PASS.
Source5c6617dc…2642dcd stayed unchanged; entry0050a39a…17f7495. This run focuses
on concurrency; it does not repeat the already accepted112 layout cases.
Its first invocation failed before execution because of a JS-only harness
syntax mistake; no runtime was created. The corrected invocation used fresh
owned output. No product guard was weakened and no old failure was renamed.
# Дополнительная приёмка24 ноября: actual private migration62

Browser62-08 PASS5/5: обычный workspace и task созданы/перечитаны настоящим UI;
Messenger использует real WebCrypto/IDB с nonempty composition, conflict draft
и unknown-outcome command. Настоящий mounted personal migration controller и
full source factory/PHP/SQLite активируют scope. Direct E2eeMessageLocal reader
до fallback подтверждает все исходные hashes. Cold real vault unlock сохраняет
device/pin/history/drafts/command и ordinary task; identity alone не показывает
composer. Migration не отправляет сообщение. Explicit retry повторяет точный
сохранённый ciphertext POST, без второго message, с пустой принятой composition.
pageErrors[], sourceUnchanged=true, owned runtime cleanup PASS.

Evidence: output/playwright/security336-messenger-migration62-1124-08/results.json.
Source79797ddd…93206, entry299a6176…5991. Chat transport modeled, Google delivery
synthetic; это не server enrollment/whole20-path acceptance/signed upgrade.
Предыдущие62 failures и harness corrections сохранены и перечислены в handoff;
продуктовый crypto/storage код ради этой приёмки не менялся. Layout112 не повторён.
