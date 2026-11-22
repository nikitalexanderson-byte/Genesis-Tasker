# Ordinary membership composition — candidate source,22 November

This is a code-stage checkpoint, not completed membership acceptance. No tests,
compiler, typecheck, lint, build, asset generation or CI ran. Coverage remains9/20.

`membership-operation-plan.ts` is the common pure business planner for project
role/removal, space role, member/category permissions and complete project grants.
It retains nearest inherited grants, explicit exclusions, inbox/admin semantics,
guest cleanup, invitation revocations, role events and private assignment clears.
Intermediate removal effects survive a final role returning to its prior value.
Effect-only operations retain affected scopes. Complete legacy grant sets are not
truncated to the current bounded membership command. Review fingerprints use
ordered bounded page hashes and the existing SQL-name-as-value projection.

`MembershipOperationDrafts` persists the complete input before graph/state IO,
reads it back, obtains a proposal, rechecks it at explicit consent and freezes it
before crypto preparation. Before freezing, old proposals/reviews remain history.
After freezing, a changed graph cannot silently obtain new consent or semantics.
The journal has no apply/approval/signature replay capability. Content archives
retain these raw inputs as inert history; importing them grants no ACL or device
authority. Pending drafts must still be composed into normal recovery UI.

`captureMembershipOperationSnapshot` reads actual pinned normal repositories,
decrypts every selected immutable root, verifies signed topology, obtains complete
ACL coordinates for selected users and rechecks graph/pins/heads/directories. It
checks previously pinned project roots omitted by routing. Fresh-device unknown
server omissions remain a stated limit, not a completeness proof. Missing scopes,
pins or values remain errors, never empty categories. The graph endpoint returns
only technical routing/ACL identifiers and presently requires the space owner.
Project-owner-only/multi-owner composition still needs the owner exchange rather
than broadening this endpoint to arbitrary ACL readers. Web and native use the
same capture/planner/draft code through the existing isolated bundled runtime.
Native content ports retain foreground/account/update guards; no keys or generic
network/storage capability enter the renderer. The existing shared-aggregate
channel was also added to the native whitelist that previously omitted it.

Shared product transactions now support a membership binding in their first
durable write. Normal flush refuses a bound transaction and normal pending flush
does not select it. `prepare` uploads immutable encrypted values only;
`confirmPrepared` checks signed normal heads and decrypted exact versions before
acknowledgement. These are foundations for a containing atomic transaction, not
permission to apply a series of ordinary product commits before changing ACL.

`product-commit-bound` signatures include the intended membership hash. The
ordinary command route rejects them; an already-held membership writer context
must supply the same hash. Product read proofs also require the immediately
following independently verified directory frame to be a membership rotation
carrying that hash. The marker is derived while verifying the signed directory;
it does not change old directory packets or crypto suites. Frozen command custody
is typed and remains inert, whether or not a containing batch was accepted.

Still required: complete signed effects/anchors manifest in the membership hash,
atomic private assignment/audit/product commits plus invitation/Google projection
revocation, wide staged batches, multi-owner effect preparation and attribution,
normal role/remove/grants/invitation UI on both platforms,14-language review,
and semantic outcome/cancellation resolution for stale frozen attempts. Until
that composition exists, normal buttons must not call the raw low-level batch
and must not claim these foundations are a completed user operation.

Source inspection also corrected the server's ACL access-revision validator:
ordinary role/permission changes may carry the unchanged access revision;
replacing grants advances it. Category revisions still require an increment.

All production/Paddle/3.3.5/149 state is unchanged. Floors0, cutover off,
GENESIS_DEPLOY_ANDROID=false. No push/deploy/device/Play operations occurred.
