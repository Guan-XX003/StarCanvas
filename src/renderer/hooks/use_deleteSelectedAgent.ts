/**
 * deleteSelectedAgent。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import type { SetAny, Toast } from "../lib/app-types";

interface UseDeleteSelectedAgentDeps {
  agentItems: any;
  selectedAgent: any;
  setAgentConversations: SetAny;
  setAgentItems: SetAny;
  setSelectedAgentId: SetAny;
  showToast2: Toast;
}

export function use_deleteSelectedAgent(deps: UseDeleteSelectedAgentDeps) {
  const {
    agentItems,
    selectedAgent,
    setAgentConversations,
    setAgentItems,
    setSelectedAgentId,
    showToast2,
  } = deps;
  const deleteSelectedAgent = (targetAgent = selectedAgent) => {
            if (!targetAgent || !agentItems.some((agent) => agent.id === targetAgent.id)) return;
            if (agentItems.length <= 1) {
              showToast2(`至少保留一个智能体`);
              return;
            }
            if (!confirm(`确定删除智能体“${targetAgent.name || `智能体`}”及其聊天记录吗？`)) return;
            let remainingAgents = agentItems.filter((agent) => agent.id !== targetAgent.id),
              nextAgentId = remainingAgents[0]?.id || ``;
            (setAgentItems(remainingAgents),
              selectedAgent?.id === targetAgent.id && setSelectedAgentId(nextAgentId),
              setAgentConversations((prevConversations) => {
                let updatedConversations = {
                  ...prevConversations
                };
                return delete updatedConversations[targetAgent.id], updatedConversations;
              }),
              showToast2(`已删除智能体`));
          };
  return { deleteSelectedAgent };
}
