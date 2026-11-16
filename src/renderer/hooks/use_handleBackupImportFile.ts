// @ts-nocheck
/**
 * handleBackupImportFile。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import type { SetAny, Toast } from "../lib/app-types";
import { getAgentOptionList } from "../lib/agent";
import { getProjectOptionList } from "../lib/app-root-helpers";
import { assertSafeBackupProjects } from "../lib/project-normalize";
import { decryptPortableBackup, isEncryptedPortableBackup } from "../lib/portable-backup-crypto";
import { backupImportFailureMessage } from "../lib/backup-export-errors";

interface UseHandleBackupImportFileDeps {
  applyExternalAssetBundleToBackupPayload: any;
  getAvailableBackupModules: any;
  getBackupSettingsSectionMap: any;
  normalizeBackupModules: any;
  setBackupDialogState: SetAny;
  setBackupDialogTab: SetAny;
  showToast2: Toast;
  projects: any;
}

export function use_handleBackupImportFile(deps: UseHandleBackupImportFileDeps) {
  const {
    applyExternalAssetBundleToBackupPayload,
    getAvailableBackupModules,
    getBackupSettingsSectionMap,
    normalizeBackupModules,
    setBackupDialogState,
    setBackupDialogTab,
    showToast2,
    projects,
  } = deps;
  const cancelled = Symbol(`backup-password-cancelled`);
  const language = () => globalThis.wanjuanI18nRuntime?.getLanguage?.() || `zh-CN`;
  const unlock = async (payload) => {
    if (!isEncryptedPortableBackup(payload)) return payload;
    const open = window.wanjuanDesktop?.showInputDialog;
    if (typeof open !== `function`) throw Object.assign(Error(`BACKUP_PASSWORD_UI_UNAVAILABLE`),{code:`BACKUP_PASSWORD_UI_UNAVAILABLE`});
    const lang=language();
    let password;
    try { password = await open({password:true,
      title:lang===`en-US`?`Unlock encrypted backup`:lang===`zh-TW`?`解鎖加密備份`:`解锁加密备份`,
      message:lang===`en-US`?`Enter the password used to encrypt this backup.`:lang===`zh-TW`?`請輸入加密此備份時設定的密碼。`:`请输入加密此备份时设置的密码。`,
      cancelLabel:lang===`en-US`?`Cancel`:lang===`zh-TW`?`取消`:`取消`,
      confirmLabel:lang===`en-US`?`Unlock`:lang===`zh-TW`?`解鎖`:`解锁`}); }
    catch { throw Object.assign(Error(`BACKUP_PASSWORD_UI_UNAVAILABLE`),{code:`BACKUP_PASSWORD_UI_UNAVAILABLE`}); }
    if (password === null) return cancelled;
    return decryptPortableBackup(payload,password);
  };
  const reportReadFailure = error => {
    console.error(`Backup file read failed`);
    let code=``;try {if(error && typeof error === `object` && typeof error.code === `string`) code=error.code;} catch {}
    showToast2(typeof code === `string` && code.startsWith(`BACKUP_`) ? backupImportFailureMessage(error,language()) : `导入失败：文件格式不正确`);
  };
  const handleBackupImportFile = async (event) => {
                                  if (window.wanjuanDesktop?.chooseBackupFile) {
                                    try {
                                      let backupFileResult = await window.wanjuanDesktop.chooseBackupFile({
                                        title: `选择StarCanvas备份 JSON`,
                                      });
                                      if (backupFileResult?.canceled) return;
                                      if (!backupFileResult?.ok) throw Error(backupFileResult?.error || `读取备份文件失败`);
                                      const unlocked = await unlock(JSON.parse(backupFileResult.content || `{}`));
                                      if (unlocked === cancelled) return;
                                      let backupPayload = applyExternalAssetBundleToBackupPayload(
                                          unlocked,
                                          backupFileResult.externalAssetBundle,
                                        ),
                                        availableModules = getAvailableBackupModules(backupPayload).filter((module) => [`settings`, `projects`, `agents`].includes(module));
                                      if (!availableModules.length) {
                                        showToast2(`导入失败：未识别到可导入内容`);
                                        return;
                                      }
                                      let normalizedModules = normalizeBackupModules(backupPayload),
                                        settingsSections = availableModules.includes(`settings`) ?
                                        getBackupSettingsSectionMap(normalizedModules.settings?.chromeStorage || {}).availableSections :
                                        [],
                                        projectOptions = availableModules.includes(`projects`) ?
                                        getProjectOptionList(normalizedModules.projects?.chromeStorage?.projects) :
                                        [],
                                        agentOptions = availableModules.includes(`agents`) ?
                                        getAgentOptionList(normalizedModules.agents?.chromeStorage?.agents) :
                                        [];
                                      availableModules.includes(`projects`) && assertSafeBackupProjects(normalizedModules.projects?.chromeStorage?.projects);
                                      setBackupDialogTab(availableModules.includes(`projects`) ? `projects` : availableModules.includes(`agents`) ? `agents` : `settings`),
                                        setBackupDialogState({
                                          mode: `import`,
                                          title: `确认导入内容`,
                                          sourceName: backupFileResult.name || `备份文件`,
                                          payload: backupPayload,
                                          modules: availableModules,
                                          settingsSections: [...settingsSections],
                                          availableSettingsSections: settingsSections,
                                          projectIds: projectOptions.map((project) => project.id),
                                          availableProjects: projectOptions,
                                          agentIds: agentOptions.map((agent) => agent.id),
                                          availableAgents: agentOptions,
                                        });
                                    } catch (error) {
                                      reportReadFailure(error);
                                    } finally {
                                      event?.target && (event.target.value = ``);
                                    }
                                    return;
                                  }
                                  let selectedFile = event?.target?.files?.[0];
                                  if (!selectedFile) return;
                                  let reader = new FileReader();
                                  ((reader.onload = async (event2) => {
                                      try {
                                        let parsedBackup = await unlock(JSON.parse(event2.target?.result || `{}`));
                                        if (parsedBackup === cancelled) return;
                                        let
                                          availableModules = getAvailableBackupModules(parsedBackup).filter((module) => [`settings`, `projects`, `agents`].includes(module));
                                        if (!availableModules.length) {
                                          showToast2(`导入失败：未识别到可导入内容`);
                                          return;
                                        }
                                        let normalizedModules = normalizeBackupModules(parsedBackup),
                                          settingsBackup = availableModules.includes(`settings`) ?
                                          getBackupSettingsSectionMap(normalizedModules.settings?.chromeStorage || {}).availableSections :
                                          [],
                                          projectList = availableModules.includes(`projects`) ?
                                          getProjectOptionList(normalizedModules.projects?.chromeStorage?.projects) :
                                          [],
                                          agentList = availableModules.includes(`agents`) ?
                                          getAgentOptionList(normalizedModules.agents?.chromeStorage?.agents) :
                                          [];
                                        availableModules.includes(`projects`) && assertSafeBackupProjects(normalizedModules.projects?.chromeStorage?.projects);
                                        setBackupDialogTab(availableModules.includes(`projects`) ? `projects` : availableModules.includes(`agents`) ? `agents` : `settings`),
                                          setBackupDialogState({
                                            mode: `import`,
                                            title: `确认导入内容`,
                                            sourceName: selectedFile.name,
                                            payload: parsedBackup,
                                            modules: availableModules,
                                            settingsSections: [...settingsBackup],
                                            availableSettingsSections: settingsBackup,
                                            projectIds: projectList.map((project) => project.id),
                                            availableProjects: projectList,
                                            agentIds: agentList.map((agent) => agent.id),
                                            availableAgents: agentList,
                                          });
                                      } catch (error) {
                                        reportReadFailure(error);
                                      }
                                    }),
                                    reader.readAsText(selectedFile),
                                    (event.target.value = ``));
                                };
  return { handleBackupImportFile };
}
