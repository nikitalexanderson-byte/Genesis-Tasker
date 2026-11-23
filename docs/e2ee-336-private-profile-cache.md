# Private profile cache correction — 23 November 2026

Consolidated acceptance found that `privatePreferences.apply()` correctly kept
preferences in memory, but nine mounted profile callbacks serialized that user
into plaintext `genesis-last-user-v2`. This affects the unpublished 3.3.6
candidate; production E2EE has not been activated.

All writers now use `cacheLastUser`. A private profile hint, known protected
owner, saved private profile or active local fence excludes `advicePreferences`,
`uiVisibility` and `syncRouting`; a stale callback cannot reopen that boundary.
The preparing fence freezes the original bytes. Legacy profiles retain their
previous cache format, and local sign-out continues to deny profile writes.

The real personal.local-work capture preserves the exact owner-bound profile
original, with only those three fields exposed as inert preference history.
Finalization and device unlock also retain any unique old profile in a durable
independent-key device document, verify its readback, and only then sanitize the
current same-owner cache. Disk/lock/account/race failures preserve originals.
Typed custody validates the retained owner and content hash; portable normal and
retired-device archives expose preference content, excluding profile authority.
Offline restoration reapplies preferences from the unlocked encrypted document.

Evidence: `output/release-3.3.6/runtime/private-user-cache-04.log`: 29/29 PASS
(8 cache/retention cases plus 21 relational source regressions). This includes
actual vault encryption, cold unlock/readback, typed custody, exact local-work
capture, legacy compatibility and foreign-owner/error/race cases. TypeScript,
lint and build logs use the same `private-user-cache` / `consolidated-web-build`
prefix. Mounted migration/reload/edit/offline/clean-browser recovery is still
running in `output/playwright/security336-private-17-1123/` against immutable
build15; do not mark that journey passed before its report completes.

Accepted coverage stays 9/20. This correction is not activation or release
approval, and does not replace final 20-path/system acceptance and crypto review.
