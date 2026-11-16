// @ts-nocheck
/**
 * applyConfigButlerResult。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import type { ApiBindings, ApiConfig, ProtocolBindings, ProtocolRegistry, SetAny, SetState, StoredGlobalConfig, Toast } from "../lib/app-types";
import { cloneBackupValue } from "../lib/backup";
import { ensureModelInList } from "../lib/model-list-utils";
import { finalizeButlerProtocolConfig, normalizeButlerBaseUrl, normalizeModelCategory, normalizeProtocolConfig, normalizeProtocolName, validateButlerProtocolConfig } from "../lib/config-butler";
import { guessApiConfigName, normalizeUnifiedApiConfigs } from "../lib/unified-api-config";
import { validateButlerProtocolSafety } from "../lib/butler-protocol-safety";
declare const chrome: any;

interface UseApplyConfigButlerResultDeps {
  _e: any;
  activeStoredGlobalConfigId: any;
  apiConfigs: ApiConfig[];
  audioModelApiBindings: ApiBindings;
  audioModelProtocolBindings: ProtocolBindings;
  audioModels: any;
  configButlerTargetApiConfigId: any;
  configButlerDocUrl: any;
  configButlerTargetApiKey: any;
  configButlerTargetApiUrl: any;
  configButlerTargetCategory: any;
  configButlerTargetModel: any;
  getSelectedButlerTargetApiConfig: any;
  imageModelApiBindings: ApiBindings;
  imageModelProtocolBindings: ProtocolBindings;
  imageModels: any;
  modelProtocolRegistry: ProtocolRegistry;
  setActiveProtocolConfigText: SetAny;
  setActiveProtocolName: SetAny;
  setActiveStoredGlobalConfigId: SetAny;
  setApiConfigs: SetAny;
  setAudioApiConfigId: SetAny;
  setAudioModelApiBindings: SetAny;
  setAudioModelProtocolBindings: SetAny;
  setAudioModels: SetAny;
  setConfigButlerExpanded: SetAny;
  setImageModelApiBindings: SetAny;
  setImageModelProtocolBindings: SetAny;
  setImageModels: SetAny;
  setModelProtocolRegistry: SetAny;
  setProtocolFormatsExpanded: SetAny;
  setProtocolNamesText: SetAny;
  setStoredGlobalConfigs: SetState<StoredGlobalConfig[]>;
  setTextModelApiBindings: SetAny;
  setTextModelProtocolBindings: SetAny;
  setTtsMusicModel: SetAny;
  setVideoModelApiBindings: SetAny;
  setVideoModelProtocolBindings: SetAny;
  setVideoModels: SetAny;
  showToast2: Toast;
  storedGlobalConfigs: StoredGlobalConfig[];
  textModelApiBindings: ApiBindings;
  textModelProtocolBindings: ProtocolBindings;
  textModels: any;
  ttsMusicModel: any;
  videoModelApiBindings: ApiBindings;
  videoModelProtocolBindings: ProtocolBindings;
  videoModels: any;
}

export function useApplyConfigButlerResult(deps: UseApplyConfigButlerResultDeps) {
  const {
    _e,
    activeStoredGlobalConfigId,
    apiConfigs,
    audioModelApiBindings,
    audioModelProtocolBindings,
    audioModels,
    configButlerTargetApiConfigId,
    configButlerDocUrl,
    configButlerTargetApiKey,
    configButlerTargetApiUrl,
    configButlerTargetCategory,
    configButlerTargetModel,
    getSelectedButlerTargetApiConfig,
    imageModelApiBindings,
    imageModelProtocolBindings,
    imageModels,
    modelProtocolRegistry,
    setActiveProtocolConfigText,
    setActiveProtocolName,
    setActiveStoredGlobalConfigId,
    setApiConfigs,
    setAudioApiConfigId,
    setAudioModelApiBindings,
    setAudioModelProtocolBindings,
    setAudioModels,
    setConfigButlerExpanded,
    setImageModelApiBindings,
    setImageModelProtocolBindings,
    setImageModels,
    setModelProtocolRegistry,
    setProtocolFormatsExpanded,
    setProtocolNamesText,
    setStoredGlobalConfigs,
    setTextModelApiBindings,
    setTextModelProtocolBindings,
    setTtsMusicModel,
    setVideoModelApiBindings,
    setVideoModelProtocolBindings,
    setVideoModels,
    showToast2,
    storedGlobalConfigs,
    textModelApiBindings,
    textModelProtocolBindings,
    textModels,
    ttsMusicModel,
    videoModelApiBindings,
    videoModelProtocolBindings,
    videoModels,
  } = deps;
  const applyConfigButlerResult = (butlerResult) => {
          const selectedApiConfig = getSelectedButlerTargetApiConfig();
          const explicitTargetId = String(configButlerTargetApiConfigId || ``);
          if (explicitTargetId && (!apiConfigs.some(config => config.id === explicitTargetId) || selectedApiConfig?.id !== explicitTargetId)) {
            throw Error(`所选 API 配置已变化或不存在，请重新选择并分析`);
          }
          const selectedTargetId = String(selectedApiConfig?.id || explicitTargetId || ``);
          if (butlerResult.__wanjuanTargetApiConfigId && String(butlerResult.__wanjuanTargetApiConfigId) !== selectedTargetId) {
            throw Error(`目标 API 配置已变化，请重新分析后再应用`);
          }
          if (typeof configButlerDocUrl === `string` && butlerResult.toolContext?.sourceUrl && String(butlerResult.toolContext.sourceUrl).trim() !== configButlerDocUrl.trim()) {
            throw Error(`API 文档链接已变化，请重新分析后再应用`);
          }
          let modelName = String(butlerResult.modelName || configButlerTargetModel || ``).trim(),
            category =
            normalizeModelCategory(configButlerTargetCategory) ||
            normalizeModelCategory(butlerResult.category) ||
            ``,
            apiUrl = String(selectedApiConfig ? (selectedApiConfig.url || ``) : (configButlerTargetApiUrl || butlerResult.apiConfig?.url || ``)).trim(),
            apiKey = String(selectedApiConfig ? (selectedApiConfig.key || ``) : (configButlerTargetApiKey || ``)).trim();
          if (!modelName || !category || !apiUrl) throw Error(`配置结果缺少模型名、分类或请求地址`);
          const requestedModel = String(configButlerTargetModel || ``).trim();
          if (requestedModel && modelName !== requestedModel) throw Error(`结果模型 ID 与当前选择不一致，请重新分析或先更改模型名称`);
          const sourceTarget = butlerResult.toolContext?.target;
          if (sourceTarget && typeof sourceTarget === `object`) {
            if ((sourceTarget.modelName && String(sourceTarget.modelName).trim() !== modelName) ||
                (sourceTarget.category && normalizeModelCategory(sourceTarget.category) !== category) ||
                (sourceTarget.apiUrl && normalizeButlerBaseUrl(sourceTarget.apiUrl) !== normalizeButlerBaseUrl(apiUrl))) {
              throw Error(`模型、分类或目标 API 已变化，请重新分析后再应用`);
            }
          }
          if (butlerResult.__wanjuanRawSafetyFailed === true) throw Error(`原始分析结果包含不安全地址或认证字段，请重新分析或手动核对配置`);
          if (butlerResult.protocol?.config) {
            const rawSafety = validateButlerProtocolSafety(butlerResult.protocol.config, apiUrl);
            if (!rawSafety.ok) throw Error(`配置安全检查未通过：${rawSafety.errors.join(`；`)}。跨域协议请核实文档后手动配置`);
          }
          let protocolConfig = finalizeButlerProtocolConfig(normalizeProtocolConfig(butlerResult.protocol?.config, category), {
              modelName: modelName,
              apiUrl: apiUrl,
              category: category,
              preserveExplicitProtocol: butlerResult.protocol?.config?.__wanjuanPreferExplicitProtocol === true,
            }),
            protocolName = normalizeProtocolName(butlerResult.protocol?.name, protocolConfig),
            apiConfigName = guessApiConfigName(butlerResult.apiConfig?.name, apiUrl),
            apiConfigs2 = [...apiConfigs],
            matchedApiConfig = selectedTargetId ? apiConfigs2.find((config) => config.id === selectedTargetId) || null : null;
          if (selectedTargetId && !matchedApiConfig) throw Error(`所选 API 配置已不存在，请重新选择并分析`);
          if (!selectedTargetId) {
            const matches = apiConfigs2.filter((config) => normalizeButlerBaseUrl(config.url) === normalizeButlerBaseUrl(apiUrl));
            if (matches.length > 1) throw Error(`存在多个相同地址的 API 配置，请先选择目标渠道`);
            matchedApiConfig = matches[0] || null;
          }
	          let validation = validateButlerProtocolConfig(protocolConfig, {
	            modelName: modelName,
	            apiUrl: apiUrl,
	            category: category,
	          });
	          if (!validation.ok) throw Error(`配置校验未通过：${validation.errors.join(`；`)}`);
	          const safety = validateButlerProtocolSafety(protocolConfig, apiUrl);
	          if (!safety.ok) throw Error(`配置安全检查未通过：${safety.errors.join(`；`)}。跨域协议请核实文档后手动配置`);
	          // Newly applied, validated protocols take precedence over legacy model-name heuristics.
	          protocolConfig.__wanjuanPreferExplicitProtocol = true;
	          matchedApiConfig
            ?
            (matchedApiConfig = {...matchedApiConfig, url:apiUrl, protocolFormat:matchedApiConfig.protocolFormat || `auto`},
              apiConfigs2.splice(apiConfigs2.findIndex((config) => config.id === matchedApiConfig.id), 1, matchedApiConfig)) :
            ((matchedApiConfig = {
                id: Date.now().toString(),
                name: apiConfigName,
                url: apiUrl,
                key: apiKey,
                protocolFormat: `auto`,
              }),
              apiConfigs2.push(matchedApiConfig)),
            setApiConfigs(normalizeUnifiedApiConfigs(apiConfigs2));
	          let nextProtocolRegistry = modelProtocolRegistry;
	          if (protocolName && protocolConfig && typeof protocolConfig == `object`) {
	            let protocolConfigKey = JSON.stringify(protocolConfig || {}),
	              existingProtocolName = Object.keys(modelProtocolRegistry).find(
	                (existingName) => JSON.stringify(modelProtocolRegistry[existingName] || {}) === protocolConfigKey,
	              );
	            if (existingProtocolName) protocolName = existingProtocolName;
	            else {
	              let candidateName = protocolName, suffix = 2;
	              for (; modelProtocolRegistry[candidateName];)((candidateName = `${protocolName}（${suffix}）`), (suffix += 1));
	              protocolName = candidateName;
	              nextProtocolRegistry = { ...modelProtocolRegistry, [protocolName]: protocolConfig };
	              setModelProtocolRegistry(nextProtocolRegistry);
	            }
	          }
	          if (category === `text`) {
	            let textModelList = ensureModelInList(textModels, modelName),
	              nextApiBindings = {
	                ...textModelApiBindings,
	                [modelName]: matchedApiConfig.id
	              },
	              nextProtocolBindings = protocolName ? {
	                ...textModelProtocolBindings,
	                [modelName]: protocolName,
	              } : textModelProtocolBindings;
	            (_e(textModelList),
	              setTextModelApiBindings(nextApiBindings),
	              protocolName && setTextModelProtocolBindings(nextProtocolBindings),
	              typeof chrome < `u` && chrome.storage?.local?.set({
	                textModel: textModelList,
	                apiConfigs: apiConfigs2,
	                textModelApiBindings: nextApiBindings,
	                textModelProtocolBindings: nextProtocolBindings,
	                modelProtocolRegistry: nextProtocolRegistry,
	              }));
	          } else if (category === `image`) {
	            let imageModelList = ensureModelInList(imageModels, modelName),
	              nextApiBindings = {
	                ...imageModelApiBindings,
	                [modelName]: matchedApiConfig.id
	              },
	              nextProtocolBindings = protocolName ? {
	                ...imageModelProtocolBindings,
	                [modelName]: protocolName,
	              } : imageModelProtocolBindings;
	            (setImageModels(imageModelList),
	              setImageModelApiBindings(nextApiBindings),
	              protocolName && setImageModelProtocolBindings(nextProtocolBindings),
	              typeof chrome < `u` && chrome.storage?.local?.set({
	                drawingModel: imageModelList,
	                apiConfigs: apiConfigs2,
	                imageModelApiBindings: nextApiBindings,
	                imageModelProtocolBindings: nextProtocolBindings,
	                modelProtocolRegistry: nextProtocolRegistry,
	              }));
	          } else if (category === `video`) {
	            let videoModelList = ensureModelInList(videoModels, modelName),
	              nextApiBindings = {
	                ...videoModelApiBindings,
	                [modelName]: matchedApiConfig.id
	              },
	              nextProtocolBindings = protocolName ? {
	                ...videoModelProtocolBindings,
	                [modelName]: protocolName,
	              } : videoModelProtocolBindings;
	            (setVideoModels(videoModelList),
	              setVideoModelApiBindings(nextApiBindings),
	              protocolName && setVideoModelProtocolBindings(nextProtocolBindings),
	              typeof chrome < `u` && chrome.storage?.local?.set({
	                videoModel: videoModelList,
	                apiConfigs: apiConfigs2,
	                videoModelApiBindings: nextApiBindings,
	                videoModelProtocolBindings: nextProtocolBindings,
	                modelProtocolRegistry: nextProtocolRegistry,
	              }));
	          } else if (category === `audio`) {
	            let audioModelList = ensureModelInList(audioModels, modelName),
	              nextApiBindings = {
	                ...audioModelApiBindings,
	                [modelName]: matchedApiConfig.id
	              },
	              nextProtocolBindings = protocolName ? {
	                ...audioModelProtocolBindings,
	                [modelName]: protocolName,
	              } : audioModelProtocolBindings;
	            (setAudioModels(audioModelList),
	              setAudioModelApiBindings(nextApiBindings),
	              setAudioApiConfigId(matchedApiConfig.id),
	              protocolName && setAudioModelProtocolBindings(nextProtocolBindings),
	              typeof chrome < `u` && chrome.storage?.local?.set({
	                audioModel: audioModelList,
	                audioApiConfigId: matchedApiConfig.id,
	                apiConfigs: apiConfigs2,
	                audioModelApiBindings: nextApiBindings,
	                audioModelProtocolBindings: nextProtocolBindings,
	                modelProtocolRegistry: nextProtocolRegistry,
	              }));
	          } else if (category === `music` || category === `tts-music`) {
	            let ttsMusicModelList = ensureModelInList(ttsMusicModel, modelName),
	              nextApiBindings = {
	                ...audioModelApiBindings,
	                [modelName]: matchedApiConfig.id
	              },
	              nextProtocolBindings = protocolName ? {
	                ...audioModelProtocolBindings,
	                [modelName]: protocolName,
	              } : audioModelProtocolBindings;
	            (setTtsMusicModel(ttsMusicModelList),
	              setAudioModelApiBindings(nextApiBindings),
	              protocolName && setAudioModelProtocolBindings(nextProtocolBindings),
	              typeof chrome < `u` && chrome.storage?.local?.set({
	                ttsMusicModel: ttsMusicModelList,
	                apiConfigs: apiConfigs2,
	                audioModelApiBindings: nextApiBindings,
	                audioModelProtocolBindings: nextProtocolBindings,
	                modelProtocolRegistry: nextProtocolRegistry,
	              }));
	          } else throw Error(`暂不支持的模型分类：${category}`);
	          let currentStoredConfigPatch = {
	              apiConfigs: cloneBackupValue(apiConfigs2),
	              modelProtocolRegistry: cloneBackupValue(nextProtocolRegistry),
	            },
	            activeConfigForButlerApply =
	            activeStoredGlobalConfigId &&
	            (storedGlobalConfigs || []).find((globalConfig) => globalConfig.id === activeStoredGlobalConfigId);
	          if (category === `text`) {
	            currentStoredConfigPatch.textModel = ensureModelInList(textModels, modelName);
	            currentStoredConfigPatch.textModelApiBindings = cloneBackupValue({
	              ...textModelApiBindings,
	              [modelName]: matchedApiConfig.id,
	            });
	            protocolName &&
	            (currentStoredConfigPatch.textModelProtocolBindings = cloneBackupValue({
	              ...textModelProtocolBindings,
	              [modelName]: protocolName,
	            }));
	          } else if (category === `image`) {
	            currentStoredConfigPatch.drawingModel = ensureModelInList(imageModels, modelName);
	            currentStoredConfigPatch.imageModelApiBindings = cloneBackupValue({
	              ...imageModelApiBindings,
	              [modelName]: matchedApiConfig.id,
	            });
	            protocolName &&
	            (currentStoredConfigPatch.imageModelProtocolBindings = cloneBackupValue({
	              ...imageModelProtocolBindings,
	              [modelName]: protocolName,
	            }));
	          } else if (category === `video`) {
	            currentStoredConfigPatch.videoModel = ensureModelInList(videoModels, modelName);
	            currentStoredConfigPatch.videoModelApiBindings = cloneBackupValue({
	              ...videoModelApiBindings,
	              [modelName]: matchedApiConfig.id,
	            });
	            protocolName &&
	            (currentStoredConfigPatch.videoModelProtocolBindings = cloneBackupValue({
	              ...videoModelProtocolBindings,
	              [modelName]: protocolName,
	            }));
	          } else if (category === `audio`) {
	            currentStoredConfigPatch.audioModel = ensureModelInList(audioModels, modelName);
	            currentStoredConfigPatch.audioApiConfigId = matchedApiConfig.id;
	            currentStoredConfigPatch.audioModelApiBindings = cloneBackupValue({
	              ...audioModelApiBindings,
	              [modelName]: matchedApiConfig.id,
	            });
	            protocolName &&
	            (currentStoredConfigPatch.audioModelProtocolBindings = cloneBackupValue({
	              ...audioModelProtocolBindings,
	              [modelName]: protocolName,
	            }));
	          } else if (category === `music` || category === `tts-music`) {
	            currentStoredConfigPatch.ttsMusicModel = ensureModelInList(ttsMusicModel, modelName);
	            currentStoredConfigPatch.audioModelApiBindings = cloneBackupValue({
	              ...audioModelApiBindings,
	              [modelName]: matchedApiConfig.id,
	            });
	            protocolName &&
	            (currentStoredConfigPatch.audioModelProtocolBindings = cloneBackupValue({
	              ...audioModelProtocolBindings,
	              [modelName]: protocolName,
	            }));
	          }
	          if (activeConfigForButlerApply) {
	            let updatedStoredConfigs = (storedGlobalConfigs || []).map((globalConfig) =>
	              globalConfig.id === activeStoredGlobalConfigId ? {
	                ...globalConfig,
	                updatedAt: Date.now(),
	                config: {
	                  ...(globalConfig.config || {}),
	                  ...currentStoredConfigPatch,
	                },
	              } : globalConfig,
	            );
	            (setStoredGlobalConfigs(updatedStoredConfigs),
	              setActiveStoredGlobalConfigId(activeStoredGlobalConfigId),
	              typeof chrome < `u` &&
	              chrome.storage?.local?.set({
	                storedGlobalConfigs: updatedStoredConfigs,
	                activeStoredGlobalConfigId: activeStoredGlobalConfigId,
	              }));
	          }
          protocolName &&
            protocolConfig &&
            typeof protocolConfig == `object` &&
            (setProtocolNamesText(
                Object.keys({
	                  ...nextProtocolRegistry
	                }).join(`
`),
              ),
              setActiveProtocolName(protocolName),
              setActiveProtocolConfigText(JSON.stringify(protocolConfig, null, 2)),
              setProtocolFormatsExpanded(true));
	          setConfigButlerExpanded(true);
	          showToast2(`配置管家已应用 ${modelName} 的配置`);
	        };
  return { applyConfigButlerResult };
}
