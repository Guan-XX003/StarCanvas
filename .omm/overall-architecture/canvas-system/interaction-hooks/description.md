Implements connection creation, drag/drop, paste, context menus, split outputs, deletion, edge clicks, and chain execution.

Phase-two canvas plans use `useCanvasOperationPlans` and the pure
`lib/canvas-operation-plan.ts` controller. Ephemeral read tickets bind a bounded
selected/structure snapshot, project/mount, private config identity and actual
model parameter choices. Whole-plan preflight precedes the normal batched node
and edge setters; paid generation and arbitrary paths/commands are absent.
Idempotent application and conflict-safe undo share those setters and existing
autosave/history/media processing. The controller is held in the existing
assistant canvas ref. Session-owned chat planning/preview/confirm/undo is now
connected through `assistant-canvas-planner` and the normal workspace model
engines. The pure shared wire protocol excludes private config/media locations;
node text is opt-in. `canvas-plan-layout` fits conservative expanded bounds
without hiding nodes behind a visible float. `canvas-generation-preflight`
inspects hypothetical or current local fields only; it never probes endpoints,
resolves media, reads balances, starts generation or grants permission. Private
global API defaults also fence pending plans. Default-role native source GUI
now covers existing-node/layout edits, actual manual conflicts and project
away/back. The hidden load-fit NaN defect is corrected and the milestone-two
source-Mac requirement audit is accepted in the workspace contract. Structured
CLI/MCP and internal assistant planning now share application-operation-service,
trusted nonce consumption and this same controller. Internal actors are scoped
by session; mutation confirmations also bind the selection version at the user
click and recheck it after IPC. Background read/preview may remain with its owner
while another session is selected. Unknown outcomes retain a job handle and only
query it; no write is retried. Other old assistant actions and paid/media routes
remain to be migrated before M3 acceptance.

The assistant setup summary reuses the same preparation probes, capability
cache and canvasGenerationApiPresence as planning. Only local default
configuration flags and image/video model-entry counts leave the owner. Reading
this summary creates no read ticket, proposal, node, authorization or request;
it is not exposed as an arbitrary external CLI/MCP controller method.
