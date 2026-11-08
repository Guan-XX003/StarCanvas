Personal API keys and tokens must remain local and must never be written into diagrams, logs, commits, or release notes. Account refresh tokens and enterprise workspace tokens stay encrypted in the Electron main process. Enterprise provider keys remain on the LAN gateway and must never be returned to the App. Requests must preserve each upstream provider's documented schema.

Direct Google Gemini requests may use the documented query-key form. Gemini-compatible gateways, including Jixin, must use bearer authorization and must not copy their credential into the request URL. Experimental image bindings must remain manually overridable and visibly separate from production-verified protocol presets.

The built-in `MiniMax-H3-720p` alias uses the supplier JSON video-task contract,
never deprecated `seconds`, `size`, or `input_reference` fields. The built-in
profile is fixed to 720p and integer durations from 4 through 15 seconds. Until
the production relay accepts role-aware H3 media safely, any connected image,
frame, video, audio, selected context, or generated media reference must be
rejected before upload, conversion, proxying, or submit. User-defined protocol
profiles remain independent and are not rewritten into the built-in profile.
