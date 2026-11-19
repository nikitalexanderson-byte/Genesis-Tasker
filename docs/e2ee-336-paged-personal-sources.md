# Complete large legacy personal sources

19 November 2026. Server implementation behind the existing signed migration
read channel. No migration/production flag, update floor or release version changes.

Physis has a 32 MiB service storage allowance. Personal mindmap retained versions
have a 40,000,000-byte allowance. Both can exceed the 16 MiB single bridge/source
message budget. Refusing a large source is safer than truncation, but a complete
migration also needs a usable path for those valid sources.

`genesisE2eeLegacyPersonalPage` reads fixed internal table specifications under
the existing signed owner/device/directory/session/lease/source and owner-file /
SQLite transaction gates. The signed payload binds the table and integer offset.
Every response repeats source identity, exact table counts, requested offset and
an explicit next offset or end. The same source token is checked on every page;
an expired/changed lease cannot splice different generations. Page size is at
most 128 rows and 8 MiB before the small response metadata/key overhead; an
oversized individual row refuses. A short page is not end-of-source.

`legacy-physis` reads all four raw owner tables, including expired tombstones,
permanently used IDs, raw vault/envelope JSON, pending-operation receipts and
response JSON. It does not call entitlement/bootstrap/prune helpers or create
keys. Account-v2 vaults can receive the existing old account key only on their
owner page. Independent v1 password/recovery vaults never become an empty or
implicitly unlocked account vault. Unsupported/malformed vault formats refuse.
Exact raw JSON remains available for the client's stricter duplicate-field and
content validation; no JSON projection drops unknown private fields here.

`legacy-mindmaps` keeps its existing small-source request/response contract and
adds the same signed table/offset option for all maps, retained versions,
receipts and deletions. All rows are preserved without the ordinary history
screen's twenty-entry cap. Only pages containing map/version ciphertext can
return the existing old account key. No provider task creation, receipt replay
or acknowledgement is exposed by this read API.

Evidence under `output/release-3.3.6/runtime/`:

- `physis-paged-source-server-03/`: 4/4 PHP suites PASS, including the ordinary
  Physis security suite, opaque store and small mindmap source regressions.
- `paged-personal-source-server-04/`: 4/4 PHP suites PASS after extracting the
  shared page reader. Includes real signed PHP requests, all actual table columns,
  old tombstones/receipts, exact raw JSON, owner separation, tampered offsets,
  stale/revoked/cancelled leases, write fences and no content/source mutation.
- A synthetic Physis source above 16 MiB is read completely in bounded pages;
  the 253-ID retained registry also exercises the 128-row boundary. A row above
  the byte cap returns an explicit continuation first, then refuses that row
  without changing/deleting the source. A synthetic map history above 16 MiB
  and below the real 40,000,000-byte allowance is read with all 50 versions.
- The original 18-packet WebCrypto/JCA fixture passed the server increment.
  Follow-up client emitters now collect 22 actual signed packets, including
  mindmap-version / Physis-record page offsets. PHP checks those packets and
  four tampered offsets in 26 assertions; no replacement signatures are made.

The retained `physis-paged-source-server-02/` failure was an incorrect test
expectation: its valid first tombstone page correctly returned a continuation
before the oversized second row. The corrected test checks that continuation
and the subsequent refusal; it does not treat the short first page as complete.

This is server source coverage, not a completed client category. Accepted source
adapters remain 6/20. Client capture/reconciliation, every independently locked
Physis source, embedded map attachments, large-data bridge/lifecycle acceptance,
normal product routing and recovery/direct-upgrade tests remain required.
All private paths, shared rotations/files/automation, backups, the original 48
scenarios, 14-language review and independent crypto review remain release gates.

## Web and native signed page collection

The new web/native ports sign table and integer offset together with owner,
device, directory checkpoint and migration lease. Invalid table/offset/binding
requests refuse before HTTP. Both collectors verify the exact response shape,
all source/header/generation bindings, stable table counts and old-key identity,
consecutive offsets, explicit EOF and bounded pages. Empty/truncated pages and
changed metadata cannot become successful partial data. Unknown row fields and
raw JSON are retained for the category's subsequent validation. A collector is
not an unlock of an independent vault and does not validate private row meaning.

Limits are explicit: 128 rows / 16 MiB per received response, 128 MiB aggregate,
10,000 pages and 1,000,000 declared rows. The server's 8 MiB body budget is tighter.
Oversize input refuses without changing sources. The JS context is copied/frozen
before asynchronous IO; native uses its immutable source context. The optional JS
opaque-key capability is explicit: it refuses raw account keys and is only for
the native bridge. The ordinary web collector requires a canonical old key.

Evidence: `legacy-pages-migration-js-02.log` 79/79 web tests PASS (27 collector
and 52 coordinator/transport); native page collector 3/3 and migration 13/13
JVM PASS, no skips in these suites, from `native-mindmaps-jvm-summary-01.json`.
Main/test APK and full native lint build01 completed successfully in 19m8s.
`mindmaps-source-server-05/` 7/7 PHP PASS includes the new actual 22-packet
fixture. Types/scoped lint passed. The separate new map repository fixture was
corrected and subsequently passed 73/73 on both API34/API35; its first failure
is retained in the map implementation evidence.
Native large bridge/source integration and the Physis category remain required.
