/**
 * duplicateSelectedAgent。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import type { SetAny, Toast } from "../lib/app-types";
import { cloneBackupValue } from "../lib/backup";

interface UseDuplicateSelectedAgentDeps {
  selectedAgent: any;
  setAgentConversations: SetAny;
  setAgentItems: SetAny;
  setSelectedAgentId: SetAny;
  showToast2: Toast;
}

export function use_duplicateSelectedAgent(deps: UseDuplicateSelectedAgentDeps) {
  const {
    selectedAgent,
    setAgentConversations,
    setAgentItems,
    setSelectedAgentId,
    showToast2,
  } = deps;
  const duplicateSelectedAgent = (targetAgent = selectedAgent) => {
            if (!targetAgent) return;
            let clonedAgent = {
              ...targetAgent,
              id: `agent-${Date.now()}`,
              name: `${targetAgent.name || `智能体`} 副本`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            (setAgentItems((prevAgents) => [...prevAgents, clonedAgent]),
              setSelectedAgentId(clonedAgent.id),
              setAgentConversations((prevConversations) => ({
                ...prevConversations,
                [clonedAgent.id]: cloneBackupValue(prevConversations[targetAgent.id] || []).map((message, index) => ({
                  ...message,
                  id: `${clonedAgent.id}-copy-${index}-${Date.now()}`,
                })),
              })),
              showToast2(`已复制智能体`));
          };
  return { duplicateSelectedAgent };
}
