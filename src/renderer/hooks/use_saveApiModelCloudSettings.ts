// @ts-nocheck
/**
 * Debounced model settings with an acknowledged normal-close save.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ApiBindings, ApiConfig, ProtocolBindings, ProtocolRegistry, Ref, StoredGlobalConfig } from "../lib/app-types";
import { WANJUAN_JIXIN_BUILTIN_TIANJI_SEEDANCE_MODELS, wanjuanMergeModelText } from "../lib/jixin-catalog";
import { isCurrentSettingsSave } from "../lib/global-config";
import { registerDesktopCloseParticipant } from "../lib/desktop-close";
declare const chrome: any;

interface UseSaveApiModelCloudSettingsDeps {
  activeStoredGlobalConfigId: any;
  arkTrustedAssetConfig: any;
  apiConfigs: ApiConfig[];
  apiModelCloudSettingsSaveTimerRef: Ref;
  audioApiConfigId: any;
  audioApiKey: any;
  audioApiUrl: any;
  audioModelApiBindings: ApiBindings;
  audioModelProtocolBindings: ProtocolBindings;
  audioModels: any;
  configButlerApiKey: any;
  configButlerApiUrl: any;
  configButlerDocUrl: any;
  configButlerMode: any;
  configButlerModel: any;
  configButlerProtocol: any;
  configButlerTargetApiConfigId: any;
  configButlerTargetCategory: any;
  customPublicUploadConfig: any;
  imageApiConfigId: any;
  imageApiKey: any;
  imageApiUrl: any;
  imageCompatResolutions: any;
  imageModelApiBindings: ApiBindings;
  imageModelProtocolBindings: ProtocolBindings;
  imageModels: any;
  modelProtocolRegistry: ProtocolRegistry;
  qiniuConfig: any;
  seedanceDurations: any;
  seedanceEnableWebSearch: any;
  seedanceGenerateAudio: any;
  seedanceModel: any;
  seedanceRatios: any;
  seedanceResolutions: any;
  seedanceUploadMode: any;
  seedanceVirtualPortraits: any;
  seedanceWatermark: any;
  settingsHydratedRef: Ref;
  storedGlobalConfigs: StoredGlobalConfig[];
  syncTianjiConfigFromJixinApi: any;
  textApiConfigId: any;
  textApiKey: any;
  textApiUrl: any;
  textModelApiBindings: ApiBindings;
  textModelProtocolBindings: ProtocolBindings;
  textModels: any;
  tianjiSeedanceModel: any;
  tianjiSeedanceSettingsMode: any;
  tongyiWanxiangDurations: any;
  tongyiWanxiangEditModels: any;
  tongyiWanxiangImageModels: any;
  tongyiWanxiangRatios: any;
  tongyiWanxiangReferenceImageModels: any;
  tongyiWanxiangResolutions: any;
  tongyiWanxiangTextModels: any;
  tosConfig: any;
  ttsMusicModel: any;
  videoApiConfigId: any;
  videoApiKey: any;
  videoApiUrl: any;
  videoAspectRatios: any;
  videoDurations: any;
  videoModelApiBindings: ApiBindings;
  videoModelProtocolBindings: ProtocolBindings;
  videoModelRequestProfilesText: any;
  videoModels: any;
  videoResolutions: any;
}

export function use_saveApiModelCloudSettings(deps: UseSaveApiModelCloudSettingsDeps) {
  const {
    activeStoredGlobalConfigId,
    arkTrustedAssetConfig,
    apiConfigs,
    apiModelCloudSettingsSaveTimerRef,
    audioApiConfigId,
    audioApiKey,
    audioApiUrl,
    audioModelApiBindings,
    audioModelProtocolBindings,
    audioModels,
    configButlerApiKey,
    configButlerApiUrl,
    configButlerDocUrl,
    configButlerMode,
    configButlerModel,
    configButlerProtocol,
    configButlerTargetApiConfigId,
    configButlerTargetCategory,
    customPublicUploadConfig,
    imageApiConfigId,
    imageApiKey,
    imageApiUrl,
    imageCompatResolutions,
    imageModelApiBindings,
    imageModelProtocolBindings,
    imageModels,
    modelProtocolRegistry,
    qiniuConfig,
    seedanceDurations,
    seedanceEnableWebSearch,
    seedanceGenerateAudio,
    seedanceModel,
    seedanceRatios,
    seedanceResolutions,
    seedanceUploadMode,
    seedanceVirtualPortraits,
    seedanceWatermark,
    settingsHydratedRef,
    storedGlobalConfigs,
    syncTianjiConfigFromJixinApi,
    textApiConfigId,
    textApiKey,
    textApiUrl,
    textModelApiBindings,
    textModelProtocolBindings,
    textModels,
    tianjiSeedanceModel,
    tianjiSeedanceSettingsMode,
    tongyiWanxiangDurations,
    tongyiWanxiangEditModels,
    tongyiWanxiangImageModels,
    tongyiWanxiangRatios,
    tongyiWanxiangReferenceImageModels,
    tongyiWanxiangResolutions,
    tongyiWanxiangTextModels,
    tosConfig,
    ttsMusicModel,
    videoApiConfigId,
    videoApiKey,
    videoApiUrl,
    videoAspectRatios,
    videoDurations,
    videoModelApiBindings,
    videoModelProtocolBindings,
    videoModelRequestProfilesText,
    videoModels,
    videoResolutions,
  } = deps;
  const pendingWrites = useRef(new Set<Promise<boolean>>());
  const latest = useRef<any>(null);
  const closing = useRef(false);
  const buildSettingsPatch = () => {
          let settingsPatch = {
            textApiUrl: textApiUrl,
            textApiKey: textApiKey,
            imageApiUrl: imageApiUrl,
            imageApiKey: imageApiKey,
            videoApiUrl: videoApiUrl,
            videoApiKey: videoApiKey,
            audioApiUrl: audioApiUrl,
            audioApiKey: audioApiKey,
            textModel: textModels,
            drawingModel: imageModels,
            imageCompatResolutions: imageCompatResolutions,
            videoModel: videoModels,
            videoDurations: videoDurations,
            videoResolutions: videoResolutions,
            videoAspectRatios: videoAspectRatios,
            seedanceModel: seedanceModel,
            tianjiSeedanceModel: tianjiSeedanceModel,
            seedanceDurations: seedanceDurations,
            seedanceResolutions: seedanceResolutions,
            seedanceRatios: seedanceRatios,
            seedanceGenerateAudio: seedanceGenerateAudio,
            seedanceWatermark: seedanceWatermark,
            seedanceEnableWebSearch: seedanceEnableWebSearch,
            seedanceVirtualPortraits: seedanceVirtualPortraits,
	            arkTrustedAssetConfig: arkTrustedAssetConfig,
	            tianjiSeedanceSettingsMode: tianjiSeedanceSettingsMode,
            tongyiWanxiangTextModels: tongyiWanxiangTextModels,
            tongyiWanxiangReferenceImageModels: tongyiWanxiangReferenceImageModels,
            tongyiWanxiangImageModels: tongyiWanxiangImageModels,
            tongyiWanxiangEditModels: tongyiWanxiangEditModels,
            tongyiWanxiangDurations: tongyiWanxiangDurations,
            tongyiWanxiangResolutions: tongyiWanxiangResolutions,
            tongyiWanxiangRatios: tongyiWanxiangRatios,
            seedanceUploadMode: seedanceUploadMode,
            tosConfig: tosConfig,
            customPublicUploadConfig: customPublicUploadConfig,
            qiniuConfig: qiniuConfig,
            audioModel: audioModels,
            ttsMusicModel: ttsMusicModel,
            modelProtocolRegistry: modelProtocolRegistry,
            configButlerApiUrl: configButlerApiUrl,
            configButlerApiKey: configButlerApiKey,
            configButlerProtocol: configButlerProtocol,
            configButlerModel: configButlerModel,
            configButlerDocUrl: configButlerDocUrl,
            configButlerMode: configButlerMode,
            configButlerTargetCategory: configButlerTargetCategory,
            configButlerTargetApiConfigId: configButlerTargetApiConfigId,
            storedGlobalConfigs: storedGlobalConfigs,
            activeStoredGlobalConfigId: activeStoredGlobalConfigId,
            apiConfigs: apiConfigs,
            textModelApiBindings: textModelApiBindings,
            textModelProtocolBindings: textModelProtocolBindings,
            imageModelApiBindings: imageModelApiBindings,
            imageModelProtocolBindings: imageModelProtocolBindings,
            videoModelProtocolBindings: videoModelProtocolBindings,
            textApiConfigId: textApiConfigId,
            imageApiConfigId: imageApiConfigId,
            videoApiConfigId: videoApiConfigId,
            audioApiConfigId: audioApiConfigId,
            videoModelApiBindings: videoModelApiBindings,
            audioModelProtocolBindings: audioModelProtocolBindings,
            audioModelApiBindings: audioModelApiBindings,
          };
          try {
            videoModelRequestProfilesText.trim() &&
              JSON.parse(videoModelRequestProfilesText);
            settingsPatch.videoModelRequestProfiles = videoModelRequestProfilesText;
          } catch (error) {
            console.warn(`Skip autosaving invalid video model request profiles`);
          }
          return settingsPatch;
  };
  // Capture committed state before passive effects schedule a save. Updating
  // this in render could expose an abandoned render to the close coordinator.
  useLayoutEffect(() => {
    latest.current = { buildSettingsPatch, syncTianjiConfigFromJixinApi, tianjiSeedanceModel };
  });
  const persistSnapshot = async (snapshot, scheduledSaveId) => {
          // API inputs must not mutate an in-flight snapshot while the local
          // Tianji projection or storage queue is awaiting completion.
          const settingsPatch = structuredClone(snapshot.buildSettingsPatch());
          try {
            let syncedTianjiSeedanceConfig = await snapshot.syncTianjiConfigFromJixinApi(settingsPatch.apiConfigs);
            syncedTianjiSeedanceConfig &&
              (settingsPatch.tianjiSeedanceConfig = {
                ...syncedTianjiSeedanceConfig,
                models: String(snapshot.tianjiSeedanceModel || ``).trim() || wanjuanMergeModelText(WANJUAN_JIXIN_BUILTIN_TIANJI_SEEDANCE_MODELS),
              });
          } catch (error) {
            console.warn(`Auto sync Tianji config from Jixin API failed`);
          }
          if (!isCurrentSettingsSave(apiModelCloudSettingsSaveTimerRef.current, scheduledSaveId)) return false;
          await chrome.storage.local.set(settingsPatch);
          return isCurrentSettingsSave(apiModelCloudSettingsSaveTimerRef.current, scheduledSaveId);
  };
  const trackWrite = (operation: Promise<boolean>) => {
    pendingWrites.current.add(operation);
    // Install a rejection handler immediately; callers still observe failure.
    void operation.then(() => pendingWrites.current.delete(operation), () => pendingWrites.current.delete(operation));
    return operation;
  };
  const cancelDebounce = () => {
    if (apiModelCloudSettingsSaveTimerRef.current) clearTimeout(apiModelCloudSettingsSaveTimerRef.current);
    apiModelCloudSettingsSaveTimerRef.current = 0;
  };
  const saveApiModelCloudSettings = () => {
    if (closing.current || !settingsHydratedRef.current || typeof chrome === `undefined` || !chrome.storage?.local) return;
    cancelDebounce();
    const scheduledId = setTimeout(() => {
      void trackWrite(persistSnapshot(latest.current, scheduledId)).catch(() => {
        console.warn(`Model settings save failed`);
      }).finally(() => {
        if (isCurrentSettingsSave(apiModelCloudSettingsSaveTimerRef.current, scheduledId)) apiModelCloudSettingsSaveTimerRef.current = 0;
      });
    }, 250);
    apiModelCloudSettingsSaveTimerRef.current = scheduledId;
  };
  useEffect(() => registerDesktopCloseParticipant('settings', async () => {
    if (!settingsHydratedRef.current) return { ok: true };
    if (!latest.current || typeof chrome === `undefined` || !chrome.storage?.local) return { ok: false };
    closing.current = true;
    try {
      cancelDebounce();
      // Invalidate and drain older saves before the final current snapshot.
      // This waits for local writes only, never uploads or model requests.
      await Promise.allSettled([...pendingWrites.current]);
      const snapshot = latest.current;
      const expected = structuredClone(snapshot.buildSettingsPatch());
      const signature = JSON.stringify(expected);
      const committed = await trackWrite(persistSnapshot(snapshot, 0));
      if (!committed) return { ok: false };
      const keys = Object.keys(expected);
      const readback = typeof chrome.storage.local.getWithStatus === 'function'
        ? await chrome.storage.local.getWithStatus(keys)
        : { values: await chrome.storage.local.get(keys), reliable: true };
      // Some legacy shims swallow storage exceptions after fallback. A settled
      // set() alone is not evidence that the latest user values were persisted.
      const matches = readback?.reliable === true && keys.every(key =>
        JSON.stringify(readback.values?.[key]) === JSON.stringify(expected[key]));
      return { ok: matches && signature === JSON.stringify(latest.current.buildSettingsPatch()) };
    } catch {
      return { ok: false };
    } finally {
      closing.current = false;
    }
  }), []);
  return { saveApiModelCloudSettings };
}
