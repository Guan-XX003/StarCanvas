/** Fixed error text only: provider paths and project content must not leak. */
export function backupExportFailureMessage(error:unknown, language:string) {
  let code="";try {if (error && typeof error === "object" && typeof (error as any).code === "string") code=(error as any).code;} catch {}
  const index=language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0;
  if (code === "BACKUP_PASSWORD_MISMATCH") return ["两次输入的密码不一致，未导出备份。","兩次輸入的密碼不一致，未匯出備份。","The passwords do not match. No backup was exported."][index];
  if (code === "BACKUP_PASSWORD_INVALID") return ["备份密码至少需要 12 个字符，未导出备份。","備份密碼至少需要 12 個字元，未匯出備份。","The backup password must have at least 12 characters. No backup was exported."][index];
  if (code === "BACKUP_PASSWORD_UI_UNAVAILABLE") return ["无法打开密码输入框，未导出备份。","無法開啟密碼輸入框，未匯出備份。","The password dialog could not be opened. No backup was exported."][index];
  if (code === "BACKUP_CONTENT_TOO_LARGE") return ["备份 JSON 超过 64 MiB，无法加密导出。","備份 JSON 超過 64 MiB，無法加密匯出。","The backup JSON exceeds 64 MiB and cannot be encrypted."][index];
  if (code === "BACKUP_FOLDER_EXISTS") return ["所选备份文件夹已存在，请选择一个新名称；原文件未更改。","所選備份資料夾已存在，請選擇新名稱；原檔案未更改。","The selected backup folder already exists. Choose a new name; existing files were not changed."][index];
  if (code === "BACKUP_ASSET_FOLDER_CONFLICT") return ["素材文件夹发生冲突，未生成加密备份 JSON；所选新文件夹可能留有未加密素材，请检查。","素材資料夾發生衝突，未產生加密備份 JSON；所選新資料夾可能留有未加密素材，請檢查。","The media folder conflicted, so no encrypted backup JSON was created. The new folder may contain unencrypted media; inspect it."][index];
  if (code === "CUSTOM_CONFIG_BACKUP_NOT_PORTABLE") return ["导出已中止：项目含需保护的节点配置，请使用密码加密备份；原项目未更改。","匯出已中止：專案含需保護的節點設定，請使用密碼加密備份；原專案未更改。","Export stopped: node configuration requires protection. Use password encryption; the original project was not changed."][index];
  if (code === "CUSTOM_CONFIG_PROTECTION_FAILED") return ["导出已中止：无法读取本机加密配置，原项目未更改。","匯出已中止：無法讀取本機加密設定，原專案未更改。","Export stopped: device-local encrypted configuration could not be read. The original project was not changed."][index];
  if (code === "PROJECT_BACKUP_READ_UNAVAILABLE") return ["导出已中止：无法读取项目画布，也没有可用镜像。请检查存储后重试。","匯出已中止：無法讀取專案畫布，亦無可用鏡像。請檢查儲存空間後重試。","Export stopped: the project canvas could not be read and no mirror was available. Check storage and try again."][index];
  return ["导出失败","匯出失敗","Export failed"][index];
}

/** Import errors are also fixed text; never expose backup content or paths. */
export function backupImportFailureMessage(error:unknown, language:string) {
  let code="";try {if (error && typeof error === "object" && typeof (error as any).code === "string") code=(error as any).code;} catch {}
  const index=language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0;
  if (code === "CUSTOM_CONFIG_BACKUP_NOT_PORTABLE") return ["导入已中止：备份包含不可跨设备恢复的本机加密配置，现有项目未更改。","匯入已中止：備份包含無法跨裝置還原的本機加密設定，現有專案未更改。","Import stopped: this backup contains device-local encrypted configuration that cannot be restored across devices. Existing projects were not changed."][index];
  if (code === "CUSTOM_CONFIG_PROTECTION_FAILED") return ["导入已中止：无法在本机安全保存节点配置，现有项目未更改。","匯入已中止：無法在本機安全儲存節點設定，現有專案未更改。","Import stopped: node configuration could not be stored securely on this device. Existing projects were not changed."][index];
  if (code === "PROJECT_BACKUP_ASSET_UNAVAILABLE") return ["导入已中止：找不到所选项目的备份素材，请检查备份素材文件夹；现有项目未更改。","匯入已中止：找不到所選專案的備份素材，請檢查備份素材資料夾；現有專案未更改。","Import stopped: backup assets for the selected project could not be found. Check the backup asset folder. Existing projects were not changed."][index];
  if (code === "BACKUP_DECRYPT_FAILED" || code === "BACKUP_PASSWORD_INVALID") return ["无法解密备份：密码不正确或备份已损坏，现有数据未更改。","無法解密備份：密碼不正確或備份已損壞，現有資料未更改。","Could not decrypt the backup: the password is incorrect or the backup is damaged. Existing data was not changed."][index];
  if (code === "BACKUP_ENVELOPE_INVALID") return ["无法读取加密备份：文件格式无效或版本不受支持，现有数据未更改。","無法讀取加密備份：檔案格式無效或版本不受支援，現有資料未更改。","Could not read the encrypted backup: its format is invalid or unsupported. Existing data was not changed."][index];
  if (code === "BACKUP_PASSWORD_UI_UNAVAILABLE") return ["无法打开备份密码输入框，现有数据未更改。","無法開啟備份密碼輸入框，現有資料未更改。","Could not open the backup password dialog. Existing data was not changed."][index];
  return ["导入失败","匯入失敗","Import failed"][index];
}
