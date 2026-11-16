Agent conversations, multimodal attachments, knowledge imports, long-term memory, agent configuration, and reusable workspace templates.

Final phase-two status: all three source-macOS milestones plus the inspected
portable tests are accepted in docs/ASSISTANT_STAGE_TWO_ACCEPTANCE.md. The
incremental descriptions below retain their milestone-specific coverage, not
remaining whole-phase gates. Internal assistant operations, CLI and MCP share
the application-operation host/dispatcher, policy and public protocol registry;
the original workspace repository remains the sole conversation-storage owner.
Formal App replacement, packaged/Windows native and release are separate.

Phase 2 connects the default assistant to one renderer session controller and
the main-process encrypted role/session repository through trusted IPC. The
first-phase chat/action controller displays the SAME selected session as a
robot float or full workbench. Async setters retain their owner ID; delayed
replies cannot cross into a new selection. Switching waits for encrypted writes
and gates input. Create/select/rename/archive/restore and normal macOS source
App restart are accepted, along with seven themes and three languages.

Original agent-keyed records remain intact behind the compatibility entry.
Their JSON definitions/history now import idempotently into encrypted role and
session snapshots after reliable settings hydration. Repeated import does not
overwrite new edits. Role editor saves encrypted revisions, not the old agents
array. Custom text roles execute through the original request builder using
their manual binding, output mode, knowledge and session-specific history.
They never silently switch to DeepSeek. Memory defaults to the session; explicit
role sharing is available. A renderer abort controller and bounded custom queue
own each custom request; trusted main-process leases own its persisted state.

Actual source Mac tests passed custom text/memory, two independent conversations,
Stop A preserving B, role edits, original-data preservation and normal process
restart without DeepSeek credentials. Encrypted media import, independent
drafts, history reattachment and normal Mac source restart now also passed
against fake providers. Request bytes were verified for images and the existing
Gemini inline-video schema; live provider capability is not claimed. Attachment
limits/help follow the current themes, locales and compact layout.

The role editor now translates fixed labels directly with a language subscription
and skips DOM translation of private content. New roles are staged until save;
cancel creates no record. Model changes preserve explicit API bindings, missing
configured models remain visible, and zero temperature survives. Semantic theme
surfaces replace hardcoded navy overlays. Session project binding is explicit,
does not share project content, and is refused during an active request.

Queue/running/interrupted labels reflect persisted task state. Native sends use
one owned, non-overlapping read loop only while outstanding; status read failure
never replays a model request. Workbench password backup/confirmation restore
uses the existing portable encryption/save path, with remapped encrypted copies
and one catalog publication. Duplicate import never overwrites edits or moves
the selected conversation. The legacy backup dialog discloses its separate scope.

Milestone one is accepted for source macOS within documented limits; full
packaged/Windows and every legacy/media combination are not implied. Controlled
canvas plans and shared CLI/MCP authorization remain milestones two/three, not
part of this acceptance. See docs/ASSISTANT_WORKSPACE.md for the requirement
audit, receipts and corrected QA directory-isolation deviation.

Milestone two now adds a scoped planning mode inside this same chat composer.
The default role uses the existing restricted Harness send; custom roles use
their existing provider builder with a shared pure canvas-proposal contract.
Planning keeps role prompt/knowledge but does not send chat attachments or use
remote long-term memory. Each workspace view owns its transient controller,
scope, preview and edits; delayed results stay with the original conversation.
Field edits require revalidation, and only direct confirm/undo buttons call
the real canvas owner. Original project names are local display metadata, not
model context. Restart restores ordinary history and canvas data, never plan
authority. Source Mac custom-role preview/edit/apply/undo, seven themes, three
locales, compact view and two normal restarts passed against loopback fakes;
that increment alone did not establish external authorization or final M2 acceptance.

The shared client observes project changes for every loaded session and expires
scope/request/preview/applied controls permanently, not only as a temporary
display projection. Returning cannot make an old confirmation look valid;
delayed model replies cannot revive it. A collapsed localized preflight panel
shows only local field readiness and never generation authority. Actual default
Harness source GUI now verifies confirmation, existing edits/layout, undo,
manual conflicts and project changes; the hidden automatic-fit SVG defect is
now reproduced/corrected and milestone two is source-Mac accepted. See the
contract's enumerated receipts, not an overall
console-health claim.

Phase-three confirmed generation messages retain strict non-authorizing task
pointers through the existing encrypted workspace presentation. Plans/reviews
and operation handles remain volatile. History cards use the original bounded
task projection, lazy visible observation and shared read coalescing. A separate
media.export review/approval invokes the normal output owner and enables local
image/video/audio preview only after accepted save. Exact-task diagnostics fill
the selected conversation's editable draft, retain selection/draft race checks,
and never send raw error bodies or auto-approve a corrective generation.

Custom-role Chat/Responses/Gemini replies can now consume actual SSE through
the original sender. The shared parser emits text only, excluding reasoning,
tool arguments and raw error objects; explicit protocol terminals determine
completion, not progress animation or connection EOF alone. Live text is
session-owned volatile state, emitted at most about every 40ms, with no per-token
encrypted writes. Interrupted text persists once as an incomplete model quote,
never as canonical completed history or an actionable proposal. Selected-session
scroll-follow respects reading older content. The pinned Harness SDK still
settles whole messages; main-owned official inference now taps actual SSE bytes
for a separate volatile preview. A non-overlapping 80ms revision poll follows
only the caller's request and does not decrypt history per token. Failure does
one final progress read and preserves a single incomplete model quote; success
still waits for the normal SDK/repository commit. Structured canvas planning
does not publish partial JSON as suggestions. Duplicate sends cannot clear a
live preview or consume another turn's progress.

Workbench role/session items keep their minimum height inside bounded scroll
lists. Selecting a role scrolls only its list to make the selection visible;
compact layouts do not shrink six roles into clipped miniature rows.

Phase-three history navigation mounts at most 24 presentation records per page,
retaining original absolute indices/item identity for existing confirmation
fences. Earlier/later/latest and explicit literal text/attachment-name search
can reach the full history without truncating its encrypted data or model
context. Queries are component memory only, not plaintext indexes or model
requests. Session-name filtering is deferred and memoized per role/archive view.
Archive preview reads the original encrypted record without selecting or
restoring it, presents paged plain history without task/action authority, and
fences late reads on close. Only the separate Restore control unarchives it.
Reading upward inside the latest page freezes its absolute start when a reply
arrives; a separate Latest control opts back into following. Scoped layout
adjustment keeps selected roles and sessions visible without scrolling chat.
Archive search Escape restores focus before unmounting its input; Tab remains
inside the preview and close returns focus to the original session control.

Attachment cards show identified image/video type and size, explicit local
preview, draft removal and historical reattachment. Import progress/errors are
owner-scoped volatile metadata; a mixed failure retains earlier added files,
and saved-not-sent copy is cleared when a custom turn begins. Preview uses only
the trusted encrypted-media route, never an arbitrary file reader/upload. Late
reads and old decode events cannot replace a newer preview; Blob URLs are
disposed on close, replacement or decode failure. Native video controls retain
Tab behavior through boundary focus guards rather than a blanket Tab trap.

The collapsed Setup and examples surface distinguishes assistant credentials,
custom-role bindings and local image/video configuration. Its explicit local
check uses the canvas owner's existing non-mutating factory/capability/API
presence probes and reports only counts plus default presence flags, never
network/balance validation. Examples append bounded editable request text to
the owning draft and do not create nodes, share content or call a model.
