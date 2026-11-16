/**
 * Debounced encrypted-config preparation and normal canvas autosave.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type { WjEdge, WjNode } from "../lib/app-types";

interface UseLateEffect1184Deps {
  edges: WjEdge[];
  nodes: WjNode[];
  saveCanvasState: any;
  prepareCanvasConfigs?: () => Promise<unknown>;
  shouldFitView: any;
}

export function useLateEffect1184(deps: UseLateEffect1184Deps) {
  const {
    edges,
    nodes,
    saveCanvasState,
    prepareCanvasConfigs,
    shouldFitView,
  } = deps;
  useEffect(() => {
		      if (!shouldFitView) return;
		      let preparationId = setTimeout(() => { prepareCanvasConfigs?.().catch(() => {}); }, 100);
		      let timeoutId = setTimeout(saveCanvasState, 2800);
		      return () => { clearTimeout(preparationId);clearTimeout(timeoutId); };
		    }, [nodes, edges, shouldFitView, saveCanvasState, prepareCanvasConfigs]);
}
