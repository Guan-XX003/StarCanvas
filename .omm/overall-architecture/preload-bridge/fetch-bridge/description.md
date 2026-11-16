Replaces renderer fetch paths that need desktop privileges with cancellable IPC requests while preserving normal fetch behavior where possible.

Assistant text streaming uses an explicit proxyFetchStream contextBridge
callback, because the existing main-world HTML fetch shim otherwise buffers a
whole response. assistant-stream-fetch adapts scoped frames through the same
shared desktop-response-stream implementation as the preload fetch path. No
Response/ReadableStream is transferred through contextBridge. Per-request
sequence/size checks, originating-frame delivery, abort and listener cleanup
bound the stream; there is no public IPC object, retry or durable body mirror.
