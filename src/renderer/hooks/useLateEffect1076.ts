/**
 * useLateEffect1076（自 bundle 抽出的后置 useEffect，无组件级前向引用，行为不变）。
 */
import { useEffect, useRef } from "react";
import type { WjNode } from "../lib/app-types";
import {scheduleCanvasLoadFit} from '../lib/canvas-load-fit';

interface UseLateEffect1076Deps {
  fitView: any;
  nodes: WjNode[];
  shouldFitView: any;
  visible:boolean;
  wrapperRef:{current:HTMLElement|null};
}

export function useLateEffect1076(deps: UseLateEffect1076Deps) {
  const {
    fitView,
    nodes,
    shouldFitView,
    visible,
    wrapperRef,
  } = deps;
  const fitted=useRef(false);
  useEffect(() => {
    if(!shouldFitView){fitted.current=false;return;}
    if(!visible||!nodes.length||fitted.current||!wrapperRef.current)return;
    return scheduleCanvasLoadFit(wrapperRef.current,()=>{
      fitted.current=true;
      // An automatic load fit is immediate; deliberate focus/layout controls
      // keep their animations. This also avoids a queued zoom interpolation
      // beginning after a rapid switch hides the canvas again.
      void fitView({padding:0.2,duration:0});
    });
  }, [shouldFitView,visible,nodes.length,fitView,wrapperRef]);
}
