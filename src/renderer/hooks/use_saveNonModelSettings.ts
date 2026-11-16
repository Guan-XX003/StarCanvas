/**
 * saveNonModelSettings。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import type { Ref } from "../lib/app-types";
declare const chrome: any;

interface UseSaveNonModelSettingsDeps {
  agentConversations: any;
  agentItems: any;
  appLanguage: any;
  autoDownloadGeneratedResults: any;
  backupExportSelection: any;
  downloadDirectory: any;
  layeredRunConcurrencyOptions: any;
  layeredRunMaxConcurrency: any;
  maxPollingDuration: any;
  nonModelSettingsSaveTimerRef: Ref;
  performanceProfile: any;
  pollingInterval: any;
  presetPrompts: any;
  selectedAgentId: any;
  settingsHydratedRef: Ref;
  storageOptimizationEnabled: any;
  storageOptimizationPaused: any;
  themeMode: any;
}

export function use_saveNonModelSettings(deps: UseSaveNonModelSettingsDeps) {
  const {
    agentConversations,
    agentItems,
    appLanguage,
    autoDownloadGeneratedResults,
    backupExportSelection,
    downloadDirectory,
    layeredRunConcurrencyOptions,
    layeredRunMaxConcurrency,
    maxPollingDuration,
    nonModelSettingsSaveTimerRef,
    performanceProfile,
    pollingInterval,
    presetPrompts,
    selectedAgentId,
    settingsHydratedRef,
    storageOptimizationEnabled,
    storageOptimizationPaused,
    themeMode,
  } = deps;
  const saveNonModelSettings = (overrides: Partial<Pick<UseSaveNonModelSettingsDeps, "themeMode" | "appLanguage" | "autoDownloadGeneratedResults">> = {}) => {
      if (
        !settingsHydratedRef.current ||
        typeof chrome > `u` ||
        !chrome.storage ||
        !chrome.storage.local
      )
        return;
      // An assistant command can arrive while an older debounced batch is
      // pending. Reschedule the batch with the new value instead of letting
      // the older snapshot overwrite the already-confirmed targeted write.
      const nextTheme = overrides.themeMode ?? themeMode;
      const nextLanguage = overrides.appLanguage ?? appLanguage;
      const nextAutoDownload = overrides.autoDownloadGeneratedResults ?? autoDownloadGeneratedResults;
      if (nonModelSettingsSaveTimerRef.current != null) clearTimeout(nonModelSettingsSaveTimerRef.current);
      const timer = setTimeout(() => {
          if (nonModelSettingsSaveTimerRef.current === timer) nonModelSettingsSaveTimerRef.current = null;
          chrome.storage.local.set({
            globalPollingInterval: pollingInterval,
            globalMaxPollingDuration: maxPollingDuration,
            themeMode: nextTheme,
            uiTheme: nextTheme,
            theme: nextTheme,
            appearanceTheme: nextTheme,
            appLanguage: nextLanguage,
            uiLanguage: nextLanguage,
            downloadDirectory: downloadDirectory,
            autoDownloadGeneratedResults: nextAutoDownload,
            storageOptimizationEnabled: storageOptimizationEnabled,
            storageOptimizationPaused: storageOptimizationPaused,
            presetPrompts: presetPrompts,
            layeredRunConcurrencyOptions: layeredRunConcurrencyOptions,
            layeredRunMaxConcurrency: layeredRunMaxConcurrency,
            wanjuanPerformanceProfile: performanceProfile,
            backupExportSelection: backupExportSelection,
            agents: agentItems,
            selectedAgentId: selectedAgentId,
            agentConversations: agentConversations,
          });
        }, 250);
      nonModelSettingsSaveTimerRef.current = timer;
    };
  return { saveNonModelSettings };
}
