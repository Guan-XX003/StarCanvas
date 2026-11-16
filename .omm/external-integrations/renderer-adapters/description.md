Provider libraries and generation hooks that translate node parameters and references into concrete external API calls.

Custom workspace roles reuse createAgentMessageSender from the original agent
hook. Explicit role/API binding, protocol-native image parts and Gemini inline
video remain in that one builder. Request ownership/history and default remote
memory IDs are session-scoped; role-shared memory requires explicit selection.
The encrypted custom-turn lease resolves only its own submitted media to
transient File objects. Strict media conversion prefers File bytes and fails
closed rather than dropping unusable images. Past media is not automatically
resent, and Chat/Responses reject video. Workspace requests carry the internal
starcanvasNoRetry flag so preload cannot replay a failed model request;
legacy retries remain unchanged. Errors suppress raw provider bodies. No
arbitrary upload/filesystem/tool permission or real-provider capability claim
is added by these adapters.
