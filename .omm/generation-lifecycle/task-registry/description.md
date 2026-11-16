Compacts duplicate records, indexes tasks by ID and project-node pair, preserves active and result-bearing tasks, and powers the global task panel.

New custom asynchronous tasks record their originating node ID as a string;
the previous task list is not embedded as the ID. The task metadata does not
retain the full submit/poll response or the configured API URL as its prompt.
New custom-node failures store and display only a fixed coarse error summary,
with an HTTP status when recognized; custom-node warnings no longer log raw
headers, URLs, provider errors or JSON parse errors. Previously stored records
are not rewritten. New image/video terminal failures and the generic-video
polling failure update use the same coarse summaries; selected image/video
warnings omit raw errors and media URLs. Other paths and result content retain
their existing privacy behavior. Image/video task records still store prompt
and API base URL under their existing lifecycle; manually configured custom-node
fields are not migrated or removed by this change.

Text-generation failures now store and display only coarse safe summaries,
preserving an HTTP status where available. Text request, media-conversion and
error logs omit prompt bodies, media addresses, provider messages and raw
exceptions. Shared reference-media conversion warnings also omit URLs and
exceptions. Existing task prompt fields and historical records are unchanged;
other generators and downstream components are not covered by this claim.

Manual refresh of image, generic/Seedance video and Tianji failures reduces
new provider messages to fixed summaries before writing or displaying them;
Suno query failures and refresh exceptions show a safe summary. A network
query failure does not by itself change the generation task to failed, and a
missing original credential or HTTP 401/403 from the task-query endpoint also
leaves the task and node unchanged and reports that the last status is not
confirmed. These are query failures, not proof of generation failure.
Successful media recovery and historical fields retain their existing behavior.

Tianji automatic polling treats an explicit provider cancellation as cancelled,
and a locally handled terminal result returns normally to avoid an extra failed
task. The task, live node and persisted node use their own active-task guards;
these separate stores are not atomically committed.

For an explicit Suno failure or cancellation response, refresh now records the
corresponding terminal status and coarse error; contradictory or unrecognized
status evidence stays unconfirmed. A late failure cannot overwrite a task now
stopped/completed or a node bound to another task. A stopped audio task is not
automatically repopulated from a cached result. The node guard is conditional
on its own loading, stop and task-identity fields, not a cross-store transaction.

New asynchronous custom-node runs use an independently generated `custom-local-`
task ID for the persisted task record and node association. The upstream ID is
kept in the active polling closure and substituted into the configured poll
request, not copied into this local identifier. Existing task records are not
migrated. This alone does not sanitize custom configuration, generated content,
or task fields from other providers.

application-task-records provides the same local snapshot for assistant, CLI
and MCP reads. Renderer-lifetime submission jobs survive canvas remount but do
not become persisted history. An older same-node task no longer hides a new
submission: pruning requires the same project/node and comparable creation
order (or its matched persisted identity); uncertain order retains both.
Source lists are bounded and malformed/unavailable storage is not treated as
empty. Exact duplicate IDs or ambiguous node aliases are refused. The shared
application-task-data projection preserves unknown/contradictory states,
custom output types, absent progress and valid original timestamp formats.
It exports only fixed failure categories on explicit diagnostic reads; normal
reads never scan raw errors. None of this polls providers, downloads media,
mutates historical records or grants retry/generation authority.

The renderer-lifetime submission tracker now captures original project/type/time
and updates only its exact live fallback slot. Once canonical history prunes it,
a stop replaces it, or a later run owns the slot, late callbacks cannot recreate
an identity-less newer pending record. This fixes an actual native image race
without editing history, changing task projection chronology or persisting a
second task store. Native repeated task/node reads and prune/callback unit tests
cover this path.

The assistant's generation card observes the same bounded task metadata owner
as the normal task panel and public task projection. It uses one nonoverlapping
local observation timer, stops on terminal/unknown/unavailable state or unmount,
and never adds provider polls, operation jobs per tick, materialization or paid
retry. Generation-completed and media-saved are not conflated. Controlled image
and ordinary video hook records now carry an independent clientSubmissionId.
Confirmed encrypted chat presentation stores only version/project/node/UUID
observation identity, not grants, reviews, paths or URLs. Exact correlation
prevents a later same-node task replacing the historical result. Ambiguous
canonical matches are refused; no new persisted task store is created.

Visible cards share a short-lived metadata read and stop local observation on
terminal/unavailable state. Media export uses the same staged main service and
separate trusted confirmation; saved local preview is volatile and never copied
into chat/model context. A selected failed card requests only that exact task's
allowlisted diagnostic, inserts an editable draft, and never auto-sends/retries.
HTTP-only parameter/endpoint/server categories are explicitly possible causes,
not proof of a specific field or of upstream acceptance.
