/**
 * $t。自 bundle 抽出，逐字搬运、行为不变。
 */
import { useCallback, useMemo } from "react";
import { backupExportFailureMessage } from "../lib/backup-export-errors";
import { encryptPortableBackup } from "../lib/portable-backup-crypto";
import { makeEncryptedBackupConfigsPortable } from "../lib/custom-node-config-transform";
import type { Toast } from "../lib/app-types";
import { normalizeModuleSelection } from "../lib/project-normalize";

interface Use$tDeps {
  BACKUP_MODULE_LABELS: any;
  buildBackupPayload: any;
  collectExternalUploadProjectAssetFiles: any;
  collectSelectedLocalforageBackup: any;
  compactBackupPortableAssets: any;
  getBackupChromeStorageKeys: any;
  readChromeStorageSnapshot: any;
  showToast2: Toast;
  projects: any;
}

export function use_$t(deps: Use$tDeps) {
  const {
    BACKUP_MODULE_LABELS,
    buildBackupPayload,
    collectExternalUploadProjectAssetFiles,
    collectSelectedLocalforageBackup,
    compactBackupPortableAssets,
    getBackupChromeStorageKeys,
    readChromeStorageSnapshot,
    showToast2,
    projects,
  } = deps;
  const $t = async (moduleSelection, options: any = {}) => {
    try {
      const encrypted = options.encrypted === true;
      const language = globalThis.wanjuanI18nRuntime?.getLanguage?.() || `zh-CN`;
      let password;
      if (encrypted) {
        const prompt = window.wanjuanDesktop?.showInputDialog;
        if (typeof prompt !== `function`) throw Object.assign(Error(`BACKUP_PASSWORD_UI_UNAVAILABLE`),{code:`BACKUP_PASSWORD_UI_UNAVAILABLE`});
        const common = {password:true,cancelLabel:language===`en-US`?`Cancel`:`取消`,confirmLabel:language===`en-US`?`Continue`:language===`zh-TW`?`繼續`:`继续`};
        try {
          password = await prompt({...common,title:language===`en-US`?`Protect backup JSON`:language===`zh-TW`?`保護備份 JSON`:`保护备份 JSON`,message:language===`en-US`?`Use at least 12 characters. Losing this password makes the backup JSON unrecoverable. External media and filenames are not encrypted.`:language===`zh-TW`?`請使用至少 12 個字元。遺失密碼將無法還原備份 JSON；外部素材與檔名不會加密。`:`请使用至少 12 个字符。丢失密码将无法恢复备份 JSON；外部素材和文件名不会加密。`});
          if (password === null) {showToast2(language===`en-US`?`Export cancelled`:`已取消导出`);return {ok:false,canceled:true};}
          const confirmation = await prompt({...common,title:language===`en-US`?`Confirm backup password`:language===`zh-TW`?`確認備份密碼`:`确认备份密码`,message:language===`en-US`?`Enter the same password again.`:language===`zh-TW`?`請再次輸入相同密碼。`:`请再次输入相同密码。`});
          if (confirmation === null) {showToast2(language===`en-US`?`Export cancelled`:`已取消导出`);return {ok:false,canceled:true};}
          if (typeof password !== `string` || password !== confirmation) throw Object.assign(Error(`BACKUP_PASSWORD_MISMATCH`),{code:`BACKUP_PASSWORD_MISMATCH`});
        } catch (error) {
          if (error?.code === `BACKUP_PASSWORD_MISMATCH`) throw error;
          throw Object.assign(Error(`BACKUP_PASSWORD_UI_UNAVAILABLE`),{code:`BACKUP_PASSWORD_UI_UNAVAILABLE`});
        }
      }
      let selectedModules = normalizeModuleSelection(moduleSelection, [`settings`, `projects`, `agents`]),
        storageSnapshot = await readChromeStorageSnapshot(getBackupChromeStorageKeys(selectedModules, options)),
        backupPayload = await buildBackupPayload(
          storageSnapshot,
          await collectSelectedLocalforageBackup(selectedModules, options, storageSnapshot),
          selectedModules,
          options,
        ),
        externalAssetFiles = selectedModules.includes(`projects`) ? collectExternalUploadProjectAssetFiles(backupPayload) : [],
        exportPayload = compactBackupPortableAssets(backupPayload, externalAssetFiles),
        scopeLabel =
        selectedModules.length === 3 ?
        `all` :
        selectedModules.length === 1 ?
        selectedModules[0] :
        selectedModules.join(`-`),
        exportFilename = `wanjuan-backup-${scopeLabel}-${new Date().toISOString().split(`T`)[0]}${encrypted ? `-encrypted` : ``}.json`,
        exportFolderName = exportFilename.replace(/\.json$/i, ``),
        externalAssetFolderName = exportFilename.replace(/\.json$/i, `-external-assets`),
        externalAssetSummary = externalAssetFiles.length ? {
          version: 2,
          manifestVersion: 2,
          folderName: externalAssetFolderName,
          fileCount: externalAssetFiles.length,
          // The envelope is only written after all media copies succeed.
          copied: encrypted ? externalAssetFiles.length : 0,
          failed: 0,
          assets: externalAssetFiles.map((asset) => ({
            projectId: asset.projectId,
            nodeId: asset.nodeId,
            field: asset.field,
            assetId: asset.assetId,
            kind: asset.kind,
            mime: asset.mime,
            filename: asset.filename,
            originalName: asset.originalName,
            sourceOrigin: asset.sourceOrigin,
            size: asset.size || 0,
            sha256: asset.sha256 || ``,
          })),
        } : null,
        exportData =
            externalAssetSummary && exportPayload?.modules?.projects ?
            {
              ...exportPayload,
              modules: {
                ...exportPayload.modules,
                projects: {
                  ...exportPayload.modules.projects,
                  externalAssetBundle: externalAssetSummary,
                },
              },
            } :
            exportPayload,
        finalData = encrypted ? await encryptPortableBackup(await makeEncryptedBackupConfigsPortable(exportData,window.wanjuanDesktop),password) : exportData,
        saveResult = await window.wanjuanDesktop?.saveDownload?.({
          text: JSON.stringify(finalData, null, 2),
          mime: `application/json`,
          filename: exportFilename,
          saveAsFolder: true,
          folderName: exportFolderName,
          externalAssetFiles,
          externalAssetFolderName,
          ...(encrypted ? {encryptedBackup:true} : {}),
        });
      if (saveResult?.canceled) {
        showToast2(`已取消导出`);
        return {ok:false,canceled:true};
      }
      if (!saveResult?.ok) {
        if (Array.isArray(saveResult?.missingAssets) && saveResult.missingAssets.length) {
          let missingAssetsText = saveResult.missingAssets
            .slice(0, 12)
            .map((missingAsset, index) => `${index + 1}. ${missingAsset.nodeId || `未知节点`} / ${missingAsset.field || `素材`} / ${missingAsset.assetId || missingAsset.originalName || `未命名`}${missingAsset.sourcePath ? `\n   ${missingAsset.sourcePath}` : ``}`)
            .join(`\n`);
          window.alert(`导出已中止：检测到 ${saveResult.missingAssets.length} 个素材源文件缺失。\n\n${missingAssetsText}${saveResult.missingAssets.length > 12 ? `\n...` : ``}\n\n请先在画布中重连这些素材，或删除对应节点后再导出。`);
          showToast2(`导出失败：素材源文件缺失`);
          return {ok:false};
        }
        throw Object.assign(Error(`BACKUP_SAVE_FAILED`),{code:saveResult?.code || `BACKUP_SAVE_FAILED`});
      }
      showToast2(`导出成功：${selectedModules.map((moduleKey) => BACKUP_MODULE_LABELS[moduleKey]).join(`、`)}，已生成备份文件夹${saveResult.externalAssetBundle?.copied ? `，同步打包外部素材 ${saveResult.externalAssetBundle.copied} 个` : ``}${saveResult.externalAssetBundle?.failed ? `，${saveResult.externalAssetBundle.failed} 个素材源文件缺失未能打包` : ``}`);
      return {ok:true};
    } catch (error) {
      (console.error(`Backup export failed`), showToast2(backupExportFailureMessage(error, globalThis.wanjuanI18nRuntime?.getLanguage?.() || `zh-CN`)));
      return {ok:false};
    }
  };
  return { $t };
}
