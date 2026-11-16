export function assistantMemoryIdentity(agent:any,sessionId?:string) {
  const roleId=String(agent?.id||'agent-default');
  if (!sessionId || agent?.memoryScope==='role') return roleId;
  if (!/^session-[a-f0-9-]{36}$/.test(sessionId)) throw Object.assign(new Error('ASSISTANT_SESSION_INVALID'),{code:'ASSISTANT_SESSION_INVALID'});
  return `starcanvas-${sessionId}`;
}
