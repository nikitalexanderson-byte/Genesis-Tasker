# Membership hash composition, 22 November (candidate source)

Source inspection during normal membership composition found raw SQL field names
(`space_id`, `permissions_json`, etc.) were being passed as keys to the strict
technical canonical encoder. That encoder intentionally accepts camelCase keys;
the previous beforeHash/changeHash/batch hashing could not process real ACL rows.

The matching JS/Kotlin/PHP `acl-name-value-v1` projection keeps SQL names as sorted
`name` values. String values use exact UTF8 bytes in a base64url `utf8` wrapper;
null, booleans and nonnegative integers preserve their types. It does not widen
the established canonical grammar, change crypto suites or rewrite old packets.
Before-row hashes, duplicate-coordinate checks, complete change hashes and exact
batch hashes now use this projection with an explicit domain marker. Input order
of the changes remains significant. Permission JSON bytes, including whitespace,
are retained exactly; the strict permission validator still admits only the six
technical booleans. No titles/private content are added to these control hashes.

Both product journals include hashFormat on new intents and validate typed ACL
shapes. Explicit readState ports verify the row coordinates and returned hashes.
Old journals remain readable/pending; mutation methods require the new marker.
Retained custody accepts an old input-only journal as inert history, while old
unverifiable preview/review/signed states require explicit review. No original
journal is upgraded or deleted automatically. Both custody readers understand
the new projection and compare raw changes through that same projection.

This remains source-only. No compiler/typecheck/lint/tests/build/CI were run.
The later consolidated suite must include cross-platform bytes/hashes, every ACL
table, missing/null values, empty strings, permission JSON byte differences,
duplicate coordinates, order changes, stale beforeHash, malformed types and old
journal preservation. Normal invitation/member UI, all-owner rotation exchange,
exact receipt/readback and interrupted plan resolution still need composition.
Coverage remains9/20 and activation stays disabled.

Normal-route source inspection found the existing project-grant `excluded` flag
was missing from the initial candidate spec. It is now an explicit0/1 field in
all three specs/hashes, so deny rules and descendant exceptions cannot silently
become grants. This contract is still unpublished. Old input-only drafts missing
the field remain typed/readable inert input; no default is invented and live
preview/preparation/submission require a fresh reviewed plan. Pending/load views
mark them for review. Old non-input states require explicit custody review.
