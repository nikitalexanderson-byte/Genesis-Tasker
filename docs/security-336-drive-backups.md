# 3.3.6: personal encrypted Google Drive copies

## HTTP provider acceptance77,24 November2026

Additional77-05:16/16 PASS, cleanup PASS, with2actual backend process restarts:
after prepare and after the provider accepted the partial resumable prefix.
SQLite file ID, encrypted connection and upload-session URI survived; retry
allocated no replacement file/session. Native process death, other crash
boundaries and real Google OAuth remain untested. The new runner source is
recorded independently of the earlier04 hashes below.

`output/qa/security336-drive77-1124-04/results.json`:16/16 PASS, cleanup PASS.
The unchanged production PHP Drive service is exercised through actual session/
CSRF/owner-bound HTTP routes, SQLite and cURL. An isolated local TLS CONNECT
simulator terminates only the three allowlisted Google hosts and forwards
nothing upstream. The fixture uses synthetic credentials and a short-lived test
certificate; no personal Google account, real OAuth UI or live Drive was used.

Accepted: wrong primary sub/missing scope, one-time native-code attempt, exact
prepare/commit retry, provider metadata/full ciphertext readback, discovery,
corruption/foreign metadata/duplicate list refusal, immutable operation/owner
binding,401 refresh, redirect and oversized-response refusal, lost upload ACK
without another file create, declared-size bound and disconnect without deletion.
A5,593,280-byte artifact exercises actual durable resumable session reuse:
the simulator retains262,144 bytes, the first upload returns uncertain, and
retry queries that offset and sends byte-exact remaining content using one
provider session. No product endpoint, host allowlist, TLS check or budget was
relaxed. `--drive` is confined to the CLI-only synthetic backend fixture.

Early01 failed only fixture setup (an empty owner header prevented session
adoption);02 accepted the11-case small-file scope.03 accepted13 cases but its
simulator incorrectly routed resumable PUT as session creation.04 corrects that
test-only method dispatch and accepts the final16. Original results remain.

Still required: real configured web/native Google OAuth, process death/restart,
maximum-size artifact, native SAF and whole product UI. This does not enable
`private_drive_enabled` in production or close the complete release gate.

The following22 November section records the implementation-time state; its
"no tests" wording is superseded only within the exact scoped evidence above.

22 November 2026, implementation candidate. No compilation, automated tests,
provider-account exercise, OAuth readiness check or deployment has run for this
change. Accepted source coverage remains 9/20. `private_drive_enabled=false` by
default; this is source implementation, not an activated provider integration.

The actual private backup panels now have web/native Drive actions. The client
captures the same content-only archive as local export and seals it in the
existing independently keyed `.genesisbackup` format **before** any upload.
The backup recovery key is not a GENESIS authentication/recovery credential. It
never enters the service request, durable intent, Drive object or server log.
Consent/limitations and action labels are supplied in all fourteen languages;
semantic/render acceptance is still pending.

## Credential and ownership boundary

The explicit extra grant requests only `drive.appdata` plus Google identity
scopes. It does not change login, Calendar/Tasks scopes/tokens or linked-account
identity. Both clients use the currently authenticated canonical owner's primary
Google `sub`. Web admission binds CSRF, session login ID, security epoch, nonce,
PKCE, original connection and a two-minute attempt. Native uses a one-time server
code from AuthorizationClient, exact attempt, original session/restore admission
and primary-sub verification; it does not claim an ID-token nonce from that API.
The native OAuth host is above the vault gate, holds no vault/backup key and does
not reconstruct consent after process death. A provider request accepted before
disconnect/background may still finish remotely; a late result cannot reopen a
retired client capability or claim verified delivery.

New connection UUIDs prevent old operations following a later connection. Drive
tokens are encrypted in `private_drive_connections`, independently of the existing
service token fields. Disconnect clears only these credentials and old resumable
URIs; it never calls Google's combined-grant revocation or deletes user files.
Server connections are identity authority and excluded from content import.

## Delivery, recovery and bounds

Each unlocked client persists an immutable encrypted artifact and intent under
its device root and reads it back before sending it. A retry uses the same
operation ID, complete file hash, byte count, backup ID and source connection.
Google's generated `appDataFolder` file ID is persisted on the server before
create. Small files use multipart create; files above 5 MiB use a resumable upload
with an encrypted, durably bound upload-session URI. A resumed attempt queries
the provider's accepted offset. Lost replies/409 reconcile the same file; they
do not allocate another object or overwrite a mismatching file. The server and
client each download the complete copy and verify size/SHA-256 before the local
receipt becomes complete. Corrupt/missing local journals refuse retry.

Only sealed portable headers/ciphertext are accepted by the service. Header
names, suite, lengths, canonical Base64 and ciphertext digest are checked;
duplicate decoded names refuse. Maximum portable file size is 24 MiB. HTTP input,
output, headers, time, request/byte budgets and page sizes are bounded. Provider
URLs are fixed HTTPS hosts, redirects are disabled, resumable URLs are validated
and no provider body/token/upload URI is included in errors.

Listing uses provider `appDataFolder` and owner-bound app properties, so a clean
client can find older copies without a local upload journal. Download never
imports identity/rights/old commands. Web saves the encrypted file for the existing
content-only importer; native routes it through the bounded exact-attempt SAF
handoff. Pending original encrypted files can also be saved locally, including
after the original connection was replaced. Binary/content restore semantics
remain the separate content-import work item. Automatic scheduling/retention is
not claimed. Removing the app's data in Google can remove its copies; this is
not protection against provider/account deletion or loss of the user's key.

The schema inventory now deliberately classifies migrations 128–134, including
the earlier ciphertext product tables and external-copy receipts. Drive upload
operations are identity-security metadata because they temporarily hold encrypted
provider upload-session credentials. The existing whole-schema drift acceptance
still rejects unknown tables/columns; its expected schema checkpoint is 134.

## Consolidated acceptance still required

Exercise actual configured Google web/native OAuth and clean-device discovery;
wrong primary/linked account, CSRF/login/epoch/connection changes; code reuse and
expiry; process death before/after every journal/create/receipt step; concurrent
uploads, 409, 401/refresh, resumable offsets/expiry and lost provider replies;
modified/truncated/missing remote content; small and maximum-size archives;
bounded bad JSON/duplicate headers/pagination/bandwidth; hide/lock/unlock and SAF
return ordering; fourteen-language meaning and both web/native themes. Then
include the exact final code/artifacts in the internal crypto review.

## Provider references inspected for implementation

- [Application data folder](https://developers.google.com/workspace/drive/api/guides/appdata): app-only scope, hidden folder, provider deletion and constraints.
- [Generated IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds): explicitly supports the `appDataFolder` space.
- [Upload and retry protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads): resumable uploads, offset reconciliation and retries with an allocated ID.
