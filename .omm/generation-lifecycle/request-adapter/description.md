Provider-aware generation hooks that assemble payloads, submit requests, interpret immediate responses, and create task records.

Normal video generation and application-operation preflight share
video-request-profile.ts for existing explicit/legacy profiles and provider
exceptions. Controlled text-only generation checks local config before review,
then invokes the existing node factory/hooks after a scoped one-shot grant.
No new provider implementation is introduced; reference-media scoped approval
now reaches the normal hooks through verified imported references. Legacy raw
path/URL requests stage the same imports then generation with separate grants;
they don't add another provider/request implementation. Tianji mode inference
is shared by existing CLI/MCP normalization; malformed arrays are not discarded.
Portrait IDs now verify through the existing list client only after paid grant,
then normal factory/collector/request/polling runs. Specialized wire/media review
remains incomplete. Actual-sender binding timing is fenced by
the root-owned application-generation-execution closure below.

The shared root holds its consumed operation's environment ticket until a normal
transport is actually invoked. The new volatile execution fence wraps each
renderer input uploader and initial image/video/Tianji submit; it rechecks scope,
expiry, configuration, target and references without persisting authority.
Tianji compares both current groups/config and its actual captured config.
Submission is claimed before awaited validation; duplicate/parallel/automatic
paid retries are refused. A hook ending without a send is NOT_SUBMITTED. Polling
and results stay with existing owners and do not require another grant. Controlled
quality images use a reviewed explicit ratio, not a hidden extra text-model call.
Already-started IO is not revoked; this is not an upstream cancellation promise.

Tianji controlled sending additionally consumes a frozen scalar reviewed-argument
closure (not project data) and reads the stored provider without the legacy Jixin
sync writer. It uses provider rather than unrelated general-node options and
refuses unavailable model/ratio instead of silently falling back. Review exposes
the seven common form fields; private media values remain hidden. All four mode
common-field shapes are covered by actual normal-hook mocks; native source CLI
form equality, polling/playback and cross-MCP idempotency are independently
checked. Unaffected manual sync behavior is retained.

Legacy single-node text/image/video assistant buttons now use the same scoped
read/preview/apply service and normal plan undo/recovery as full plans and
CLI/MCP. The canvas root supplies only a pure placement, not a second writer.
Original-click selection fences, duplicate suppression and late-result recovery
remain in force; no additional model or generation call is made on confirmation.
Explicit release retires fully undone snapshots but preserves applied undo.
The remaining setting/navigation/task migration and scoped media are still open.

Generic video provider overrides/parameter conversion now live in
video-request-parameters.ts, while video-request-body.ts owns the existing
JSON/multipart base fields and final JSON defaults. Both actual normal sending
and App operation review use these pure helpers. The review separates canvas
selections from actual non-secret outgoing fields; it counts hidden private or
unknown extras rather than returning config/credentials. Existing hooks still
own references, upload, HTTP and result lifecycle. Normal-hook/mock and real
source CLI/MCP local-provider checks prove the covered wire fields match, not
all image/native/provider paths. Legacy request profiles are included in the
canvas's private approval fence even when public choices do not change.

Media API URL joining deduplicates known version prefixes without changing unrelated clients. OpenAI-hosted GPT image requests omit the unsupported response format parameter; third-party gateways retain their existing behavior. Gemini image results accept both camelCase and snake_case inline image fields. Direct Ark Seedance 2.5 submits and polls the native content-generation task route, with duration validation before result clearing; other gateways and the H3 billing gate retain their own rules. Mock tests exercise actual hooks without paid provider calls.

Newly applied single-model configuration-butler protocols carry an explicit-preference marker after validation. The generic video hook preserves their request paths, field types, and body instead of applying its legacy Veo/Grok/provider-name overrides; previously saved and built-in protocols retain the old behavior. This is not a guarantee for specialized generation branches or every provider. Butler normalization preserves explicitly provided OpenAI-video routes and only guesses polling for canonical OpenAI/JSON submit paths.

For assistant-generated video proposals with both submission and polling paths, preview and apply retain those explicit paths instead of applying the legacy X-See/Lconai Veo defaults. Both raw and normalized proposed endpoints are safety-checked; deterministic document-field inference and unrelated specialized model branches may still adjust other protocol details.

The custom-node AI configuration helper no longer serializes the existing
node configuration into its model request. Only a fixed allowlist of exact
enum values is included automatically; the user's typed description still
goes to the selected text model. Model suggestions fill empty or unchanged
built-in template fields in the editing draft, preserving other current values;
the user must review and apply the configuration. Invalid model responses and
errors are reported without logging the raw response or upstream error. This
does not sanitize secrets typed into the description or migrate old node data.

`canvas-plan-generation.ts` prepares a private closure over the selected applied
plan target and connected, ready canvas inputs. It reuses normal capability,
request-profile review, node factory, batch setters, image/video hooks and the
existing application-generation-execution upload/one-submit fence. It exposes
only prompt/scalar parameters/input node IDs and types for trusted App review,
never source locations/configuration or executable arguments. Source mutation,
scope/config changes, unsupported input or an expired confirmation refuses IO.
