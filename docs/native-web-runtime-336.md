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
