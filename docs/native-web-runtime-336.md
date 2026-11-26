# Embedded Android web runtime compatibility

During 3.3.6 security QA, the original task-owned API26 image used Chromium
69.0.3497.100. It failed to parse the embedded module (`Unexpected token ?`),
before a repository or recovery UI could start. A timeout or a blank editor is
not an acceptable recovery path, and upgrading Android alone does not determine
the installed WebView provider version.

`contracts/native-web-runtime-v1.json` now pins the JS build target and runtime
compatibility check together: Chromium111 or later. This is the supported syntax
and platform API baseline for the packaged code, **not** a declaration that every
version above111 is security-patched or a substitute for cryptographic checks.
The selected system WebView provider is checked, never a claimed client header.
Unknown/unavailable/older provider versions fail closed for the embedded module.
Future compatible major versions remain accepted.

Aurora, personal backup UI and the Olympian catalogue all use the same native
check before constructing a WebView. An authored message in each of14 languages
asks the user to update Android System WebView or Chrome through their app store
and reopen the screen. Native close/navigation remains available. The application
does not delete, recreate, decrypt or restore records to handle this condition.
No automatic system package update, external checkout or store navigation occurs.

This is a compatibility guard for these three embedded screens. It does not
implement the E2EE product bootstrap, full native migration or an emergency vault
export. Existing signed application updates, identity and storage authority keep
their separate boundaries.

The original Aurora UI tests also predated the Gno entry screen. They now reach
the retained earlier route through its actual archive action and return through
Gno when closing, keeping their original saved-draw/progress/offline assertions.
Earlier failed logs remain evidence; they are not counted as successful UI QA.

Evidence and limitations are recorded in `e2ee-336-operation-fences.md` and the
3.3.6 release worklog. The API26 old-provider fallback and a task-owned API35
image with Chromium124 serve different acceptance purposes. Neither is a
personal-device update or proof that every OEM WebView has been checked.

The next increment also uses a task-owned API34 image with Chromium113, following
repeat host-QEMU crashes of the API35 offline scenario. The complete Aurora
empty/expanded/save/close/offline-reopen UI passed in both schemes at font1.3 on
that stable image. It exposed and verified a fix for stale parent state when
returning from the archive and immediately closing Gno. Earlier API35 host
crashes remain recorded; provider compatibility is still distinct from current
security patch status. Full evidence: `e2ee-336-operation-fences.md`.

Reminder source acceptance exposed another compatibility difference within the
supported runtime range: on actual WebView113, JavaScript URL exposes an empty
hostname for the internal `genesis://` scheme, while native Android Uri has the
generated authority and owner. A bounded CDP diagnostic recorded only static
code frames and technical URL properties. Native registry attribution now checks
the exact generated scheme/authority/first owner component without normalizing
it through the browser URL parser. Userinfo, ports, queries, fragments, controls
and backslashes are refused. This preserves raw historical records and does not
replay their actions. The final packaged source passes on WebView113/API34 and
WebView124/API35; API26 still has guard-only acceptance with its old provider.
Details: `e2ee-336-reminders-source.md`.
