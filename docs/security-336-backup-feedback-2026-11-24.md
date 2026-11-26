# Backup acceptance74/76 and bounded feedback78

Content74 on immutable72 completed15 checks, including real encrypted device
download, independent decryption, wrong-key refusal, inert import/cold history,
personal/project/space activation and normal encrypted task readback. It failed
the image check while the normal UI still showed Loading under an observed
503-second Retry-After. The QA incorrectly applied its default20-second timeout.
No corruption or product refusal was observed there. Cleanup passed; bundle
remained3cb209db…7bf94. The test now waits for the normal reader's permitted
bounded window, and still fails immediately on the real unavailable-photo UI.
No server rate, reader retry policy or ciphertext guard changed.

The next76 run instead encountered `E2EE_SOURCE_HISTORY_CHANGED` during its
device backup, before shared transfer. Non-pausing compiled logpoint ordinal8
in private-security-ui-Rp3-VjuR.js identifies the final ownership-catalogue set
comparison. This is a safe refusal of a changing authenticated snapshot, not
proof of data loss or an excuse to weaken the catalogue. The failed run and
owned synthetic client state remain retained; private JSON must not be read.

Correction78 keeps that refusal and the original backup key/checkboxes. The
actual web exporter now displays a specific actionable message on all14
languages for changed-source/capture refusals; other failures use the existing
localized generic error. Arbitrary exception text is no longer rendered.
Existing catalogue values are unchanged.14 new messages were read for meaning:
finish saving, explicitly try again, existing data preserved. Evidence:
runtime/backup-feedback78-semantic.json. Types, scoped lint0errors/1existing
warning, i18n audit and build:web pass. Immutable78 contains8983files, SHA256
e808ba07e7d6853868f9b2d2c725840666b61fa9dda46062b2f6a150a5f54c68. Runtime
files79 and backup80 are running separately; neither is already a PASS.

The browser QA permits at most two explicit button retries after this exact
safe changed-capture state, checks that the original backup key stays intact,
and still requires a real downloaded/decrypted archive. It never resets sources
or accepts a partial file. New `files` focus can independently finish file/photo
acceptance without repeating the three already accepted archive checks.

Whole20-path/48-scenario acceptance, final review and signed149→150 remain open.
