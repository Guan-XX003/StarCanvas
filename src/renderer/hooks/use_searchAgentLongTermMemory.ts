/**
 * searchAgentLongTermMemory。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import { getMem0Headers } from "../lib/app-root-helpers";
import {assistantMemoryIdentity} from '../lib/assistant-memory-scope';

interface UseSearchAgentLongTermMemoryDeps {
  extractMem0Results: any;
  normalizeMem0BaseUrl: any;
}

export function use_searchAgentLongTermMemory(deps: UseSearchAgentLongTermMemoryDeps) {
  const {
    extractMem0Results,
    normalizeMem0BaseUrl,
  } = deps;
  const searchAgentLongTermMemory = async (agent, query, options:{sessionId?:string;signal?:AbortSignal} = {}) => {
          if (!agent?.memoryEnabled) return ``;
          let baseUrl = normalizeMem0BaseUrl(agent.memoryBaseUrl || ``);
          if (!baseUrl || !String(query || ``).trim()) return ``;
          let userId = String(agent.memoryUserId || `default-user`).trim() || `default-user`,
            agentId = assistantMemoryIdentity(agent,options.sessionId),
            topK = Math.min(20, Math.max(1, Number.parseInt(agent.memoryTopK || `6`, 10) || 6)),
            headers = getMem0Headers(agent.memoryApiKey),
            response = await fetch(`${baseUrl}/search`, {
              signal:options.signal,
              method: `POST`,
              headers: headers,
              body: JSON.stringify({
                query: String(query || ``),
                user_id: userId,
                agent_id: agentId,
                top_k: topK,
              }),
            });
          if (!response.ok && (response.status === 404 || response.status === 405)) {
            response = await fetch(`${baseUrl}/v3/memories/search/`, {
              signal:options.signal,
              method: `POST`,
              headers: headers.Authorization || headers[`X-API-Key`] ?
                {
                  ...headers,
                  ...(headers[`X-API-Key`] ? {
                    Authorization: `Token ${headers[`X-API-Key`]}`
                  } : {}),
                } :
                headers,
              body: JSON.stringify({
                query: String(query || ``),
                filters: {
                  user_id: userId,
                  agent_id: agentId
                },
                top_k: topK,
              }),
            });
          }
          if (!response.ok) throw Error(`Mem0 记忆检索失败：${response.status}`);
          let data = await response.json(),
            results = extractMem0Results(data).slice(0, topK);
          return results.length ?
            results.map((item, index) => `${index + 1}. ${item}`).join(`
`) :
            ``;
        };
  return { searchAgentLongTermMemory };
}
