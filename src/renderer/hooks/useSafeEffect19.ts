/**
 * useSafeEffect19（自 bundle 抽出的后置 useEffect，无组件级前向引用，行为不变）。
 */
import { useEffect, useRef, useState, useMemo, useCallback, useSyncExternalStore } from "react";
import type { ApiConfig, SetAny } from "../lib/app-types";
import { getManagedRelayRuntimeVersion, subscribeManagedRelayRuntime, wanjuanManagedRelayPlaceholderFor, wanjuanResolveManagedRelayConfig } from "../lib/managed-relay";

interface UseSafeEffect19Deps {
  apiConfigs: ApiConfig[];
  audioApiConfigId: any;
  imageApiConfigId: any;
  setAudioApiKey: SetAny;
  setAudioApiUrl: SetAny;
  setImageApiKey: SetAny;
  setImageApiUrl: SetAny;
  setTextApiKey: SetAny;
  setTextApiUrl: SetAny;
  setVideoApiKey: SetAny;
  setVideoApiUrl: SetAny;
  textApiConfigId: any;
  videoApiConfigId: any;
}

export function useSafeEffect19(deps: UseSafeEffect19Deps) {
  const managedRelayVersion = useSyncExternalStore(
    subscribeManagedRelayRuntime,
    getManagedRelayRuntimeVersion,
    getManagedRelayRuntimeVersion,
  );
  const {
    apiConfigs,
    audioApiConfigId,
    imageApiConfigId,
    setAudioApiKey,
    setAudioApiUrl,
    setImageApiKey,
    setImageApiUrl,
    setTextApiKey,
    setTextApiUrl,
    setVideoApiKey,
    setVideoApiUrl,
    textApiConfigId,
    videoApiConfigId,
  } = deps;
  useEffect(() => {
    const runtimeConfig = (config: ApiConfig | undefined) => config ? {
      ...config,
      key: String(config.key || ``).trim() || wanjuanManagedRelayPlaceholderFor(config),
    } : config;
    let textConfig = runtimeConfig(wanjuanResolveManagedRelayConfig(apiConfigs, textApiConfigId));
    textConfig && (setTextApiUrl(textConfig.url), setTextApiKey(textConfig.key));
    let imageConfig = runtimeConfig(wanjuanResolveManagedRelayConfig(apiConfigs, imageApiConfigId));
    imageConfig && (setImageApiUrl(imageConfig.url), setImageApiKey(imageConfig.key));
    let videoConfig = runtimeConfig(wanjuanResolveManagedRelayConfig(apiConfigs, videoApiConfigId));
    videoConfig && (setVideoApiUrl(videoConfig.url), setVideoApiKey(videoConfig.key));
    let audioConfig = runtimeConfig(wanjuanResolveManagedRelayConfig(apiConfigs, audioApiConfigId));
    audioConfig && (setAudioApiUrl(audioConfig.url), setAudioApiKey(audioConfig.key));
  }, [apiConfigs, textApiConfigId, imageApiConfigId, videoApiConfigId, audioApiConfigId, managedRelayVersion]);
}
