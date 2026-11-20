# Ordered mindmap save acknowledgements

20 November 2026. Source checks 44658090511 on d6f99745 failed only the
premium `mindmap-edit-second-client` browser assertion: its new description was
empty in the independent client. Android and the earlier web/API steps passed.
The failed run was not reclassified as a flake or retried without investigation.

The repository allowed an earlier upload's callback to publish `synced` after a
newer edit was staged. The browser check also awaited any mindmap PUT rather
than the request that acknowledged the new edit. A controlled test reproduced
the transient false acknowledgement before the fix (0/1 PASS). The latest draft
remained encrypted locally; the observation did not prove permanent text loss.

Save callbacks now check the current per-map staged sequence. An older response
still advances its actual CAS revision and receipt, but cannot acknowledge a
later draft. Draining an uncertain earlier request also cannot publish `synced`
before the current draft's own response. No encryption format, HTTP authority,
quota or conflict rule changes.

The existing browser scenario now delays one actual backend response, stages a
second description, releases the first response, and holds the second upload.
It checks every observed save-state transition for a premature `synced`, verifies
the consecutive revisions and exact current operation receipt, then opens an
independent cold client and checks the complete description. Assertions were
strengthened; no delay-based success or relaxed text comparison was introduced.

## Local evidence

- `runtime/mindmap-save-status-before.log`: deterministic reproduction FAIL.
- `runtime/mindmap-save-status-after-02.log`: 42/42 repository/model/source tests
  PASS, including lost-acknowledgement retry and preserved latest ciphertext.
- `runtime/mindmap-save-full-js.log`: 1806/1806 PASS, 0 fail/skip. This local count
  includes the separately staged, unconnected value-transport modules and must
  not be treated as their native acceptance.
- Owned typecheck and scoped ESLint PASS; web build with the CI setting
  `GENESIS_MINDMAPS=true` PASS, including all 14 public locales and asset checks.
- `output/playwright/security336-map-status-03/`: Chromium 145.0.7632.6, all four
  startup checks PASS and three controlled two-write/cold-client cycles PASS,
  console errors 0. Exact revisions 1→2→3, 3→4→5, 5→6→7; while the latest upload
  was held, observed states were `device`, `device`, `pending` in each cycle.
  The final synthetic desktop/light screenshot was inspected.

Browser attempts 01 and 02 never reached the feature scenario because the local
web bundle had been compiled without the mindmap flag. Attempt 02 added explicit
workspace bootstrap but revealed the same missing build setting. Both failures
remain recorded; attempt 03 used the same feature setting as CI. The original CI
failure is not declared resolved in CI until a new run actually passes.

No new Android build/device acceptance, full visual matrix, deployment, version
bump, Play update or personal-device action is claimed by this increment.
Production remains 3.3.5/149; update floors 0 and E2EE pilot/cutover off.
