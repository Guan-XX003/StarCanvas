import type { ApiBindings, ApiConfig, ProtocolBindings, ProtocolConfig, ProtocolRegistry } from "./app-types";
import { resolveModelApiBindingIdHelper, resolveModelProtocolBindingHelper } from "./model-binding";

/** Shared by canvas controls and request builders; never infer a provider from a model label here. */
export function resolveMediaModelContract({
  category,
  model,
  apiConfigs = [],
  apiBindings,
  protocolBindings,
  fallbackProtocolBindings,
  registry,
  apiBindingId,
  selectedApiConfigId,
}: {
  category: "image" | "video";
  model: string;
  apiConfigs?: ApiConfig[];
  apiBindings?: ApiBindings;
  protocolBindings?: ProtocolBindings;
  fallbackProtocolBindings?: ProtocolBindings;
  registry?: ProtocolRegistry;
  apiBindingId?: string;
  selectedApiConfigId?: string;
}) {
  // The node's explicit channel choice wins over a model's default channel.
  const apiConfigId = apiBindingId || selectedApiConfigId ||
    resolveModelApiBindingIdHelper(apiBindings, model, undefined);
  const apiConfig = apiConfigs.find((config) => config?.id === apiConfigId);
  const channelBindings = category === "image" ? apiConfig?.imageProtocolBindings : apiConfig?.videoProtocolBindings;
  const protocolName = resolveModelProtocolBindingHelper(channelBindings, model) ||
    resolveModelProtocolBindingHelper(protocolBindings, model) ||
    resolveModelProtocolBindingHelper(fallbackProtocolBindings, model);
  const candidate: ProtocolConfig | undefined = registry?.[protocolName];
  const protocolCategoryMismatch = !!candidate && !!candidate.category && candidate.category !== category;
  const protocolConfigMissing = !!protocolName && !candidate;
  // Old protocol entries may omit category. A category that IS present is authoritative.
  const protocol = candidate && typeof candidate === "object" &&
    !protocolCategoryMismatch ? candidate : undefined;
  return {
    apiConfigId, apiConfig,
    protocolName: protocol ? protocolName : "",
    protocol,
    protocolConfigMissing,
    protocolCategoryMismatch,
  };
}
