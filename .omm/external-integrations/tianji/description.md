Seedance Tianji endpoints for generation tasks, points, point history, group IDs, portrait review, portrait assets, and material library pagination.

Controlled assistant/CLI/MCP portrait-ID generation uses the existing request
client and get-list-assets contract only after the shared paid grant is consumed.
application-tianji-portraits restricts reads to configured groups, bounds timeout/
pagination and rejects non-Active/ambiguous identities without creating nodes.
No automatic group creation, portrait review, cache mutation or preview upload
is added. Minimal private metadata produces normal ID-only reference nodes and
the existing form generation/polling flow. Actual source-Mac local mocks verify
the ID-only path; other specialized wire cases remain separate acceptance
requirements, not live-provider guarantees. Actual-sender timing is covered by
the following fence and native synthetic-upload evidence.

Controlled initial generation now rechecks current provider/groups immediately
before normal upload/submit and compares the config actually captured by the
sender. The root holds the same operation environment ticket through preparation,
claims a single submit, then releases it; normal polling is independent. This
does not revoke an upload already started or promise remote cancellation/refund.
