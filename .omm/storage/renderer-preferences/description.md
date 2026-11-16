User-facing settings stored through the Chrome compatibility API and selected localStorage mirrors, including themes, performance profiles, model settings, and UI preferences.

Model/API settings retain a 250 ms autosave debounce during editing. Their hook
also registers a settings participant with the normal desktop-close registry:
cancel the debounce, invalidate/drain older local saves, then await the latest
committed settings snapshot. A failed or changed write keeps the window open;
no upload, generation, credential fallback, or extra filesystem authority is
introduced. Snapshot inputs are cloned before asynchronous local projection.
