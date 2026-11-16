Converts local or private media to public URLs when required, using configured upload services while retaining project-local bindings for rendering.

For controlled application operations, existing image/video upload invocations
are wrapped in the root-created application-generation-execution closure. Each
new renderer invocation validates the same consumed operation's scope and private
environment. A failed permission/config check is terminal even when existing
fallback code catches it. Normal upload transport errors can retain their existing
approved fallbacks; already-in-flight IPC/upload is not revoked. Tianji's media
normalizer also supplies its captured config binding. Closures never enter node,
task, project, review or external payload fields; manual upload paths retain their
existing behavior when no private operation execution was passed.
