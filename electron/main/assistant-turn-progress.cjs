// Volatile answer previews only. Encrypted workspace turns remain authoritative.
// Exact caller request IDs prevent a delayed poll from observing a later turn.
const fail = () => Object.assign(new Error('ASSISTANT_WORKSPACE_INVALID'),{code:'ASSISTANT_WORKSPACE_INVALID'});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SESSION = /^session-[a-f0-9-]{36}$/i;
function validateProgressRequest(id, requestId) {
  if (typeof id !== 'string' || !SESSION.test(id) || typeof requestId !== 'string' || !UUID.test(requestId)) throw fail();
}
function createAssistantTurnProgress({now = Date.now, limit = 64, ttl = 30000} = {}) {
  const entries = new Map();
  function prune() { for (const [key,item] of entries) if (item.closedAt !== null && now()-item.closedAt >= ttl) entries.delete(key); }
  return Object.freeze({
    begin(id,requestId,turnId) {
      validateProgressRequest(id,requestId); prune();
      const key = id+':'+requestId;
      if (entries.has(key)) throw fail();
      // Evict oldest terminal previews only, never a live turn.
      for (const [old,item] of entries) { if (entries.size < limit) break; if (item.closedAt !== null) entries.delete(old); }
      if (entries.size >= limit) throw fail();
      const entry = {turnId,phase:'waiting',revision:1,text:'',closedAt:null}; entries.set(key,entry);
      return Object.freeze({
        text(value) { if (entry.closedAt !== null || typeof value !== 'string' || value.length > 200000 || entry.text === value) return; entry.text = value; entry.phase = 'receiving'; entry.revision++; },
        close() { if (entry.closedAt !== null) return; entry.closedAt = now(); entry.phase = 'closed'; entry.revision++; },
      });
    },
    read(id,requestId,afterRevision = 0) {
      validateProgressRequest(id,requestId);
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) throw fail();
      prune(); const entry = entries.get(id+':'+requestId);
      if (!entry) return null;
      return {turnId:entry.turnId,phase:entry.phase,revision:entry.revision,...(entry.revision !== afterRevision ? {text:entry.text} : {})};
    },
  });
}
module.exports = {createAssistantTurnProgress,validateProgressRequest};
