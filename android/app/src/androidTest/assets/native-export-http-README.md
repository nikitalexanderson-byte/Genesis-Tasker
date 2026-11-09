# Native export HTTP contract fixtures

Captured on 2026-10-20 from the unmodified PHP API at master
`8c9351f78379431128b4acbbd6ce22fb6e1ba19e`, through the isolated local
HTTP fixture at `127.0.0.1:4338`. These files contain only synthetic content:
two imported projects, 131 tasks, one subtask/checklist link, a dependency,
one comment, Unicode, quotes, multiline descriptions, zero/null estimates,
and zero/false custom values. No production accounts, credentials, or cookies
are included.

The POST request uses `scope=tree`, the synthetic root project, `format=json`
or `csv`, `undated=true`, `archived=true`, `calendarMode=lunar`, and calendar
context v2 / `America/New_York` / `march`. The files are the direct HTTP
response envelopes, without reserializing their content strings. Both responses
report two projects and 131 tasks. Instrumentation compares their decoded file
bytes with the platform JSON reference and checks preserved content/relations.

The temporary workspace is removed after fixture capture. These recorded
contracts supplement live server export tests; they do not demonstrate a real
Google login or SAF interaction on a physical device.
