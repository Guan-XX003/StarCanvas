// @ts-nocheck
/** Restore selected backup modules with a journaled cross-storage transaction. */
import type { TransitResource } from "../lib/app-types";
import {
  buildBackupRestoreReport,
  cloneBackupValue,
  extractProjectPortableDataRefs,
  normalizeBackupSettingsSections,
  normalizeProjectLocalforagePayload,
} from "../lib/backup";
import { buildProjectMediaFileUrl } from "../lib/resource";
import { mergeTransitResourceEntries } from "../lib/app-root-helpers";
import { normalizeAgentIdSelection } from "../lib/agent";
import {
  assertSafeBackupProjects,
  normalizeModuleSelection,
  normalizeProjectIdSelection,
  normalizeProjectResourceMap,
} from "../lib/project-normalize";
import { runBackupRestoreTransaction } from "../lib/backup-restore-transaction";
import { assertCanvasHasNoLocalConfigReferences, protectCanvasCustomConfigs } from "../lib/custom-node-config-transform";
declare const chrome: any;

interface UseRestoreSelectedBackupDeps {
  localforageModule: any;
  PROJECT_ASSET_MANIFEST_STORAGE_PREFIX: any;
  TRANSIT_RESOURCES_STORAGE_KEY: any;
  extractProjectAssetRefs: any;
  getAvailableBackupModules: any;
  getBackupSettingsSectionMap: any;
  getDesktopProjectMirrorStorageKey: any;
  getProjectCanvasStorageKey: any;
  normalizeBackupModules: any;
  normalizeResourceLocalforagePayload: any;
  agentConversations: any;
  projectGroups: any;
  projects: any;
  selectedAgentId: any;
  transitResources: TransitResource[];
}

const readChromeStorage = (storage: any) => new Promise<any>((resolve, reject) => {
  storage.get(null, (value: any) => {
    if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(value || {});
  });
});

export function use_restoreSelectedBackup(deps: UseRestoreSelectedBackupDeps) {
  const {
    localforageModule,
    PROJECT_ASSET_MANIFEST_STORAGE_PREFIX,
    TRANSIT_RESOURCES_STORAGE_KEY,
    extractProjectAssetRefs,
    getAvailableBackupModules,
    getBackupSettingsSectionMap,
    getDesktopProjectMirrorStorageKey,
    getProjectCanvasStorageKey,
    normalizeBackupModules,
    normalizeResourceLocalforagePayload,
  } = deps;

  const restoreSelectedBackup = async (backup, moduleSelection, options = {}) => {
    const modules = normalizeBackupModules(backup);
    const availableModules = getAvailableBackupModules(backup);
    const selectedModules = normalizeModuleSelection(moduleSelection, availableModules);
    const restoreSettings = selectedModules.includes(`settings`);
    const restoreProjects = selectedModules.includes(`projects`);
    const restoreResources = selectedModules.includes(`resources`);
    const shouldRestoreAgents = selectedModules.includes(`agents`);
    const settingsStorage = modules.settings?.chromeStorage && typeof modules.settings.chromeStorage === `object` ? modules.settings.chromeStorage : {};
    const projectsStorage = modules.projects?.chromeStorage && typeof modules.projects.chromeStorage === `object` ? modules.projects.chromeStorage : {};
    const projects2 = Array.isArray(projectsStorage.projects) ? cloneBackupValue(projectsStorage.projects) : [];
    if (restoreProjects) assertSafeBackupProjects(projects2);
    if (!(typeof chrome !== `undefined` && chrome.storage?.local)) throw new Error(`Chrome Storage API 不可用`);
    const localforage = localforageModule.default;
    if ((restoreProjects || restoreResources) && !localforage) throw new Error(`LocalForage API 不可用`);

    const projectPayload = normalizeProjectLocalforagePayload(modules.projects?.localforage);
    const resourcePayload = Object.keys(normalizeResourceLocalforagePayload(modules.resources?.localforage)).length
      ? normalizeResourceLocalforagePayload(modules.resources?.localforage)
      : normalizeResourceLocalforagePayload(modules.projects?.bundledResources);
    const settingsSectionMap = getBackupSettingsSectionMap(settingsStorage);
    const selectedSections = normalizeBackupSettingsSections(options.settingsSections, settingsSectionMap.availableSections);
    const mergedSections = selectedSections.reduce((acc, sectionKey) => ({ ...acc, ...(settingsSectionMap.sections[sectionKey] || {}) }), {});
    const selectedProjectIds = normalizeProjectIdSelection(options.projectIds, projects2.map((project) => project.id).filter(Boolean));
    const selectedProjects = projects2.filter((project) => selectedProjectIds.includes(project.id));
    const importedProjectGroups = Array.isArray(projectsStorage.projectGroups) ? cloneBackupValue(projectsStorage.projectGroups) : [];
    const selectedImportGroupIds = new Set(selectedProjects.map((project) => project.groupId).filter(Boolean));
    const restoredProjectGroups = selectedProjectIds.length === projects2.length ? importedProjectGroups : importedProjectGroups.filter((group) => selectedImportGroupIds.has(group.id));
    const agentChromeStorage = modules.agents?.chromeStorage && typeof modules.agents.chromeStorage === `object` ? modules.agents.chromeStorage : {};
    const importedAgents = Array.isArray(agentChromeStorage.agents) ? cloneBackupValue(agentChromeStorage.agents) : [];
    const importedAgentIds = normalizeAgentIdSelection(options.agentIds, importedAgents.map((agent) => agent.id).filter(Boolean));
    const selectedImportedAgents = importedAgents.filter((agent) => importedAgentIds.includes(agent.id));
    const selectedImportedAgentIdSet = new Set(selectedImportedAgents.map((agent) => agent.id));
    const importedAgentConversations = agentChromeStorage.agentConversations && typeof agentChromeStorage.agentConversations === `object` ? cloneBackupValue(agentChromeStorage.agentConversations) : {};
    const projectResourceMap = normalizeProjectResourceMap(modules.projects?.projectResources);
    const selectedCanvasStates = Object.fromEntries(selectedProjectIds.filter((id) => Object.prototype.hasOwnProperty.call(projectPayload.canvasStates, id)).map((id) => [id, cloneBackupValue(projectPayload.canvasStates[id])]));
    // A local vault reference is not portable and may not exist here. Reject
    // before reading or writing the destination, rather than overwriting a
    // working project with a configuration that cannot be restored.
    if (restoreProjects) for (const state of Object.values(selectedCanvasStates)) assertCanvasHasNoLocalConfigReferences(state);
    const allowedImportedAssetKeys = new Set([
      ...Object.values(selectedCanvasStates).flatMap((state) => extractProjectAssetRefs(state)),
      ...Object.values(selectedCanvasStates).flatMap((state) => extractProjectPortableDataRefs(state)),
    ]);
    const assets = Object.fromEntries(Object.entries(projectPayload.assets || {}).filter(([key]) => allowedImportedAssetKeys.has(key)).map(([key, value]) => [key, cloneBackupValue(value)]));
    // Export replaces some inline data with an external-file marker. If the
    // import did not resolve one, committing would overwrite a working canvas
    // while silently omitting its asset. Only inspect selected-project refs.
    if (restoreProjects && typeof PROJECT_ASSET_MANIFEST_STORAGE_PREFIX === `string` && PROJECT_ASSET_MANIFEST_STORAGE_PREFIX) {
      const isMarker = value => typeof value === `string` && value.startsWith(PROJECT_ASSET_MANIFEST_STORAGE_PREFIX);
      const unresolvedValue = value => isMarker(value) || (value && typeof value === `object` && value.__wanjuanExternalAssetFile === true && (typeof value.filePath !== `string` || !value.filePath));
      const unresolvedBinding = Object.values(selectedCanvasStates).some((state:any) => (Array.isArray(state?.nodes) ? state.nodes : []).some(node => {
        const bindings = node?.data?.projectAssetBindings;
        return bindings && typeof bindings === `object` && Object.values(bindings).some((binding:any) => {
          if (!binding || typeof binding !== `object` || !isMarker(binding.sourceSignature)) return false;
          const ref = binding.portableDataRef;
          return typeof ref !== `string` || !Object.hasOwn(assets,ref) || unresolvedValue(assets[ref]);
        });
      }));
      if (Object.values(assets).some(unresolvedValue) || unresolvedBinding) throw Object.assign(new Error(`PROJECT_BACKUP_ASSET_UNAVAILABLE`), {code:`PROJECT_BACKUP_ASSET_UNAVAILABLE`});
    }
    // Target-device encryption completes before reading or modifying any
    // destination project store or staging a restore journal. A failed vault
    // write leaves the existing projects intact; no raw-config fallback.
    if (restoreProjects) for (const [id,state] of Object.entries(selectedCanvasStates)) {
      if (Array.isArray((state as any)?.nodes)) selectedCanvasStates[id]=await protectCanvasCustomConfigs(state,
        typeof window !== 'undefined' ? window.wanjuanDesktop || {} : {});
    }
    const transitResources2 = Object.prototype.hasOwnProperty.call(resourcePayload, TRANSIT_RESOURCES_STORAGE_KEY) ? cloneBackupValue(resourcePayload[TRANSIT_RESOURCES_STORAGE_KEY]) : undefined;
    const currentStorage = await readChromeStorage(chrome.storage.local);
    const chromeSet: any = {};
    const chromeRemove = new Set<string>();
    const setChromeValue = (key: string, value: any) => { chromeSet[key] = cloneBackupValue(value); chromeRemove.delete(key); };
    const removeChromeValue = (key: string) => { delete chromeSet[key]; chromeRemove.add(key); };

    if (restoreSettings) for (const [key, value] of Object.entries(mergedSections)) setChromeValue(key, value);
    let restoredLastOpenedProjectId = ``;
    if (restoreProjects) {
      const existingProjects = Array.isArray(currentStorage.projects) ? cloneBackupValue(currentStorage.projects) : [];
      const selectedProjectIdSet = new Set(selectedProjects.map((project) => project.id));
      setChromeValue(`projects`, [...existingProjects.filter((project) => !selectedProjectIdSet.has(project.id)), ...selectedProjects]);
      const existingGroups = Array.isArray(currentStorage.projectGroups) ? cloneBackupValue(currentStorage.projectGroups) : [];
      const restoredGroupIds = new Set(restoredProjectGroups.map((group) => group.id));
      const mergedGroups = [...existingGroups.filter((group) => !restoredGroupIds.has(group.id)), ...restoredProjectGroups];
      if (mergedGroups.length > 0) setChromeValue(`projectGroups`, mergedGroups);
      restoredLastOpenedProjectId = selectedProjectIds.includes(projectsStorage.lastOpenedProjectId) && selectedProjectIdSet.has(projectsStorage.lastOpenedProjectId) ? projectsStorage.lastOpenedProjectId : selectedProjects[0]?.id || selectedProjectIds[0] || ``;
      if (restoredLastOpenedProjectId) setChromeValue(`lastOpenedProjectId`, restoredLastOpenedProjectId); else removeChromeValue(`lastOpenedProjectId`);
      for (const projectId of selectedProjectIds) removeChromeValue(getDesktopProjectMirrorStorageKey(projectId));
      for (const [projectId, value] of Object.entries(selectedCanvasStates)) setChromeValue(getDesktopProjectMirrorStorageKey(projectId), value);
    }

    let mergedTransitResources: any = undefined;
    if (restoreResources) {
      if (transitResources2 !== undefined) { mergedTransitResources = cloneBackupValue(transitResources2); setChromeValue(TRANSIT_RESOURCES_STORAGE_KEY, mergedTransitResources); }
      else removeChromeValue(TRANSIT_RESOURCES_STORAGE_KEY);
    } else if (restoreProjects && transitResources2 !== undefined) {
      mergedTransitResources = mergeTransitResourceEntries(transitResources2, Array.isArray(currentStorage[TRANSIT_RESOURCES_STORAGE_KEY]) ? currentStorage[TRANSIT_RESOURCES_STORAGE_KEY] : []);
      setChromeValue(TRANSIT_RESOURCES_STORAGE_KEY, mergedTransitResources);
    } else if (restoreProjects) {
      const merged = mergeTransitResourceEntries(selectedProjectIds.flatMap((projectId) => projectResourceMap[projectId] || []), Array.isArray(currentStorage[TRANSIT_RESOURCES_STORAGE_KEY]) ? currentStorage[TRANSIT_RESOURCES_STORAGE_KEY] : []);
      if (merged.length > 0) { mergedTransitResources = merged; setChromeValue(TRANSIT_RESOURCES_STORAGE_KEY, merged); }
    }
    if (shouldRestoreAgents) {
      const existingAgents = Array.isArray(currentStorage.agents) ? cloneBackupValue(currentStorage.agents) : [];
      const mergedAgents = [...existingAgents.filter((agent) => !selectedImportedAgentIdSet.has(agent.id)), ...selectedImportedAgents];
      const existingConversations = currentStorage.agentConversations && typeof currentStorage.agentConversations === `object` ? cloneBackupValue(currentStorage.agentConversations) : {};
      setChromeValue(`agents`, mergedAgents);
      setChromeValue(`agentConversations`, { ...existingConversations, ...Object.fromEntries(importedAgentIds.filter((id) => Object.prototype.hasOwnProperty.call(importedAgentConversations, id)).map((id) => [id, cloneBackupValue(importedAgentConversations[id])])) });
      const nextSelectedAgentId = typeof agentChromeStorage.selectedAgentId === `string` && selectedImportedAgentIdSet.has(agentChromeStorage.selectedAgentId) ? agentChromeStorage.selectedAgentId : selectedImportedAgents[0]?.id || currentStorage.selectedAgentId || mergedAgents[0]?.id || ``;
      if (nextSelectedAgentId) setChromeValue(`selectedAgentId`, nextSelectedAgentId);
    }

    const localforageSet = new Map<string, any>();
    const localforageRemove = new Set<string>();
    if (restoreProjects) {
      const oldAssetKeys = new Set<string>();
      const oldPortableKeys = new Set<string>();
      for (const projectId of selectedProjectIds) {
        const canvasKey = getProjectCanvasStorageKey(projectId);
        const existingState = await localforage.getItem(canvasKey);
        extractProjectAssetRefs(existingState).forEach((key) => oldAssetKeys.add(key));
        extractProjectPortableDataRefs(existingState).forEach((key) => oldPortableKeys.add(key));
        localforageRemove.add(canvasKey);
      }
      oldAssetKeys.forEach((key) => localforageRemove.add(key));
      oldPortableKeys.forEach((key) => localforageRemove.add(key));
      for (const [projectId, value] of Object.entries(selectedCanvasStates)) localforageSet.set(getProjectCanvasStorageKey(projectId), value);
      for (const [key, assetEntry] of Object.entries(assets)) {
        if (assetEntry && typeof assetEntry === `object` && assetEntry.__wanjuanExternalAssetFile && assetEntry.filePath) localforageSet.set(key, buildProjectMediaFileUrl(assetEntry.filePath) || assetEntry.filePath);
        else if (!(typeof assetEntry === `string` && assetEntry.startsWith(PROJECT_ASSET_MANIFEST_STORAGE_PREFIX))) localforageSet.set(key, assetEntry);
      }
    }
    if (restoreResources || (restoreProjects && transitResources2 !== undefined)) {
      if (mergedTransitResources !== undefined) localforageSet.set(TRANSIT_RESOURCES_STORAGE_KEY, mergedTransitResources);
      else if (restoreResources) localforageRemove.add(TRANSIT_RESOURCES_STORAGE_KEY);
    }

    const transaction = await runBackupRestoreTransaction({ localforage, chromeStorage: chrome.storage.local, chromeSet, chromeRemove: [...chromeRemove], localforageSet, localforageRemove: [...localforageRemove] });
    if (restoreProjects) restoredLastOpenedProjectId ? localStorage.setItem(`lastOpenedProjectId`, restoredLastOpenedProjectId) : localStorage.removeItem(`lastOpenedProjectId`);
    return {
      modules: selectedModules,
      settingsSections: selectedSections,
      projectIds: selectedProjectIds,
      agentIds: importedAgentIds,
      clearedChromeKeys: [...chromeRemove],
      report: buildBackupRestoreReport({ modules: selectedModules, settingsSections: selectedSections, projectIds: selectedProjectIds, agentIds: importedAgentIds, canvasStates: selectedCanvasStates, assets, transitResources: mergedTransitResources, projectResources: projectResourceMap }),
      transaction,
    };
  };
  return { restoreSelectedBackup };
}
