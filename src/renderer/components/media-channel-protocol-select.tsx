import type { ApiConfig, ProtocolRegistry } from "../lib/app-types";
import { resolveModelApiBindingIdHelper, resolveModelProtocolBindingHelper, updateModelBindingHelper } from "../lib/model-binding";

/** A small control in the existing model/API binding row, not a separate configuration workflow. */
export function MediaChannelProtocolSelect({ category, model, apiConfigs, apiBindings, registry = {}, setApiConfigs }: {
  category: "image" | "video";
  model: string;
  apiConfigs: ApiConfig[];
  apiBindings: Record<string, string>;
  registry?: ProtocolRegistry;
  setApiConfigs: (updater: (configs: ApiConfig[]) => ApiConfig[]) => void;
}) {
  const configId = resolveModelApiBindingIdHelper(apiBindings, model, "");
  const config = apiConfigs.find((item) => item.id === configId);
  const field = category === "image" ? "imageProtocolBindings" : "videoProtocolBindings";
  const selected = resolveModelProtocolBindingHelper(config?.[field], model);
  const options = Object.entries(registry).filter(([, protocol]) => protocol?.category === category);
  return <select
    className="w-44 min-w-0 bg-[#1a1a1a] border border-[#333] text-gray-300 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500 wanjuan-settings-control wanjuan-settings-select"
    aria-label={category === "image" ? "图像渠道协议" : "视频渠道协议"}
    title={category === "image" ? "此模型在所选 API 渠道使用的图像协议" : "此模型在所选 API 渠道使用的视频协议"}
    value={selected}
    disabled={!config}
    onChange={(event) => {
      const name = event.target.value;
      setApiConfigs((configs) => configs.map((item) => {
        if (item.id !== configId) return item;
        return { ...item, [field]: updateModelBindingHelper(item[field], model, name) };
      }));
    }}
  >
    <option value="">沿用模型协议</option>
    {selected && !options.some(([name]) => name === selected) ? <option value={selected}>{selected}</option> : null}
    {options.map(([name]) => <option key={name} value={name}>{name}</option>)}
  </select>;
}
