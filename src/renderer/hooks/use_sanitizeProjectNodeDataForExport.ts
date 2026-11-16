// @ts-nocheck
/**
 * sanitizeProjectNodeDataForExport。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import { EXPORT_RUNTIME_NODE_DATA_KEYS } from "../lib/app-root-helpers";
import { WANJUAN_RUNTIME_NODE_DATA_KEYS } from "../lib/node-runtime-contract";

interface UseSanitizeProjectNodeDataForExportDeps {
  EXPORT_INLINE_MEDIA_FIELDS: any;
}

export function use_sanitizeProjectNodeDataForExport(deps: UseSanitizeProjectNodeDataForExportDeps) {
  const {
    EXPORT_INLINE_MEDIA_FIELDS,
  } = deps;
  const sanitizeNodeData = (data, isNodeRoot = false) => {
                    if (Array.isArray(data))
                      return data.map((item) => sanitizeNodeData(item));
                    if (!data || typeof data != `object`) return data;
                    let sanitized = {};
                    for (let [key, value] of Object.entries(data)) {
                      if (typeof value == `function` || EXPORT_RUNTIME_NODE_DATA_KEYS.has(key) || (isNodeRoot && WANJUAN_RUNTIME_NODE_DATA_KEYS.has(key))) continue;
                      sanitized[key] = sanitizeNodeData(value);
                    }
                    let projectAssetBindings = sanitized.projectAssetBindings;
                    if (projectAssetBindings && typeof projectAssetBindings == `object`)
                      for (let key of EXPORT_INLINE_MEDIA_FIELDS)
                        Object.prototype.hasOwnProperty.call(projectAssetBindings, key) &&
                        Object.prototype.hasOwnProperty.call(sanitized, key) &&
                        delete sanitized[key];
                    return sanitized;
                  };
  const sanitizeProjectNodeDataForExport = (data) => sanitizeNodeData(data, true);
  return { sanitizeProjectNodeDataForExport };
}
