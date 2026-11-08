External integration is mediated by renderer adapters and a desktop proxy boundary. The app supports unified model gateways, Seedance Tianji, Tongyi and Qwen, Suno, user-defined providers, public media upload services, admin notifications, update feeds, account-authenticated personal and organization prompt workspaces, enterprise-gateway-local team prompt templates, local extension tools, and local automation clients connected through a loopback-only task boundary. Team template list/change/create/update/delete requests use a strict prompt DTO, revision conflicts, idempotency keys, and tombstones without sending prompt content to account-service.

The built-in Jixin catalog treats production channel evidence as authoritative for default bindings: `claude-opus-5` and `gemini-3.8-flash` use the OpenAI-compatible chat contract on the current type-1 channel. `gemini-3.1-flash-lite-image` is an explicit experimental Gemini `generateContent` profile, fixed to the model's documented 1K output and native inline-data reference/result shape; it must not be silently reinterpreted as OpenAI Images, and production availability remains unverified until an isolated contract check succeeds.

`MiniMax-H3-720p` is bound to the supplier JSON `POST /v1/videos` task contract
and `GET /v1/videos/{task_id}` polling. All real H3 submissions remain blocked
locally with zero network activity until the production relay contract and the
`duration`-aware billing entry point are deployed and verified. Closed-network
fixtures may exercise the text/media builders, but they are not production
readiness evidence.
