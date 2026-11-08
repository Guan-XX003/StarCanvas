import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Cloud, Download, RefreshCw, Upload } from "lucide-react";
import { getCloudProjectStorage } from "../lib/cloud-project-app-storage";
import { restoreCloudProjectAsNew, syncCloudProject } from "../lib/cloud-project-sync";

const runtime = () => (globalThis as any).wanjuanI18nRuntime;
const subscribe = (listener: () => void) => runtime()?.subscribe?.(listener) || (() => {});
const language = () => runtime()?.getLanguage?.() || "zh-CN";
const words = {
  "zh-CN": { title: "云项目", note: "同步最近保存的画布；请先保存正在编辑的内容。", project: "本地项目",
    upload: "同步到云端", list: "查看云端项目", more: "加载更多", restore: "恢复为新项目", none: "云端还没有项目。",
    loading: "正在处理…", saved: "已同步版本", changed: "本地保存内容已变化，请再次同步。", removed: "密钥不会同步，其他设备需重新配置。",
    confirm: "恢复会新建项目并重新加载应用。请先保存当前画布，是否继续？", restored: "恢复完成，正在重新加载…",
    failed: "云项目操作未完成，请检查账号和网络后重试。", conflict: "云端版本已变化，本地画布未被覆盖；请恢复为新项目后比较。",
    missing: "没有找到已保存的画布，请先打开项目并保存。", mediaUnprepared: "部分素材仍只保存在本机，尚不能安全同步。请重新关联素材并保存项目后重试；本地项目不会受影响。", pending: "云端项目列表", unavailable: "本机存储暂不可用。",
    checking: "正在检查云项目服务…", serviceUnavailable: "云项目服务暂时不可用，本地项目不受影响。", retry: "重新检查" },
  "zh-TW": { title: "雲端專案", note: "同步最近儲存的畫布；請先儲存正在編輯的內容。", project: "本機專案",
    upload: "同步至雲端", list: "查看雲端專案", more: "載入更多", restore: "還原為新專案", none: "雲端尚無專案。",
    loading: "處理中…", saved: "已同步版本", changed: "本機儲存內容已變更，請再次同步。", removed: "金鑰不會同步，其他裝置需重新設定。",
    confirm: "還原會建立新專案並重新載入應用程式。請先儲存目前畫布，是否繼續？", restored: "還原完成，正在重新載入…",
    failed: "雲端專案操作未完成，請檢查帳號和網路後重試。", conflict: "雲端版本已變更，本機畫布未被覆蓋；請還原為新專案後比較。",
    missing: "找不到已儲存的畫布，請先開啟專案並儲存。", mediaUnprepared: "部分素材仍只儲存在本機，暫時無法安全同步。請重新連結素材並儲存專案後重試；本機專案不受影響。", pending: "雲端專案清單", unavailable: "本機儲存暫時無法使用。",
    checking: "正在檢查雲端專案服務…", serviceUnavailable: "雲端專案服務暫時無法使用，本機專案不受影響。", retry: "重新檢查" },
  en: { title: "Cloud projects", note: "Syncs the last saved canvas. Save your current edits first.", project: "Local project",
    upload: "Sync to cloud", list: "View cloud projects", more: "Load more", restore: "Restore as new", none: "No cloud projects yet.",
    loading: "Working…", saved: "Synced version", changed: "The saved local canvas changed; sync again.", removed: "API keys are not synced; configure them on the other device.",
    confirm: "Restore creates a new project and reloads the app. Save your current canvas first. Continue?", restored: "Restored. Reloading…",
    failed: "Cloud project operation failed. Check your account and connection and retry.", conflict: "The cloud version changed. Your local canvas was not overwritten; restore a new copy to compare.",
    missing: "No saved canvas found. Open and save the project first.", mediaUnprepared: "Some assets are still local and cannot be synced safely. Relink them and save the project, then retry. Your local project is unaffected.", pending: "Cloud projects", unavailable: "Local storage is unavailable.",
    checking: "Checking cloud project service…", serviceUnavailable: "Cloud projects are temporarily unavailable. Local projects are unaffected.", retry: "Check again" },
} as const;

type Project = { id: string; name?: string };
type Remote = { projectId: string; revision: number };

export function CloudProjectPanel({ projects }: { projects: Project[] }) {
  const lang = useSyncExternalStore(subscribe, language, () => "zh-CN");
  const text = words[lang === "zh-TW" ? "zh-TW" : lang.startsWith("en") ? "en" : "zh-CN"];
  const localProjects = useMemo(() => Array.isArray(projects) ? projects.filter((p) => p && typeof p.id === "string") : [], [projects]);
  const [selected, setSelected] = useState("");
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable" | "unsupported">("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const alive = useRef(true);
  const probeVersion = useRef(0);
  const pending = useRef(false);
  const selectedProject = localProjects.find((project) => project.id === selected) || localProjects[0];
  const invoke = (window as any).wanjuanDesktop?.cloudProjects as ((payload: any) => Promise<any>) | undefined;

  const checkAvailability = useCallback(async () => {
    const version = ++probeVersion.current;
    if (!invoke) { setAvailability("unsupported"); return; }
    setAvailability("checking");
    try {
      const result = await invoke({ operation: "capabilities" });
      if (!alive.current || version !== probeVersion.current) return;
      if (result?.ok !== true) setAvailability("unavailable");
      else if (result.enabled !== true) setAvailability("unsupported");
      else setAvailability(result.available === false ? "unavailable" : "ready");
    } catch {
      if (alive.current && version === probeVersion.current) setAvailability("unavailable");
    }
  }, [invoke]);
  useEffect(() => {
    alive.current = true;
    void checkAvailability();
    return () => { alive.current = false; probeVersion.current += 1; };
  }, [checkAvailability]);

  const errorMessage = (error: any) => error?.code === "PROJECT_REVISION_CONFLICT" ? text.conflict
    : error?.code === "CLOUD_PROJECT_LOCAL_MISSING" ? text.missing
    : error?.code === "MEDIA_NOT_PREPARED" ? text.mediaUnprepared : text.failed;
  const sync = async () => {
    if (pending.current || !invoke || !selectedProject) return;
    const storage = getCloudProjectStorage();
    if (!storage) { setMessage(text.unavailable); return; }
    pending.current = true;
    setBusy(true); setMessage("");
    try {
      const key = `canvas-state-v1-${selectedProject.id}`;
      const state = await storage.getItem(key);
      if (!state) throw Object.assign(new Error(), { code: "CLOUD_PROJECT_LOCAL_MISSING" });
      const result = await syncCloudProject({ bridge: invoke, storage, localProjectId: selectedProject.id,
        projectName: selectedProject.name || selectedProject.id, state, getCurrentState: () => storage.getItem(key) });
      if (alive.current) setMessage(`${text.saved} ${result.revision}. ${result.dirty ? text.changed : ""} ${result.removedSecretFields ? text.removed : ""}`.trim());
    } catch (error) { if (alive.current) setMessage(errorMessage(error)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const list = async (append = false) => {
    if (pending.current || !invoke) return;
    pending.current = true;
    setBusy(true); setMessage("");
    let handle = "";
    try {
      const start = await invoke({ operation: "begin", projectId: selectedProject?.id || "default" });
      if (!start?.ok) throw Object.assign(new Error(), { code: start?.code });
      handle = start.handle;
      const result = await invoke({ operation: "list", handle, cursor: append ? cursor : null, limit: 50 });
      if (!result?.ok) throw Object.assign(new Error(), { code: result?.code });
      if (alive.current) {
        setRemote((old) => append ? [...(old || []), ...result.items] : result.items);
        setCursor(result.nextCursor || null);
      }
    } catch (error) { if (alive.current) setMessage(errorMessage(error)); }
    finally {
      if (handle) await invoke({ operation: "end", handle }).catch(() => {});
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const restore = async (item: Remote) => {
    if (pending.current || !invoke || !window.confirm(text.confirm)) return;
    const storage = getCloudProjectStorage(), chromeStorage = (globalThis as any).chrome?.storage?.local;
    if (!storage || !chromeStorage || !globalThis.crypto?.randomUUID) { setMessage(text.unavailable); return; }
    pending.current = true;
    setBusy(true); setMessage("");
    try {
      await restoreCloudProjectAsNew({ bridge: invoke, storage, chromeStorage, remoteId: item.projectId,
        revision: item.revision, newProjectId: `recovered-${globalThis.crypto.randomUUID()}` });
      if (alive.current) { setMessage(text.restored); window.location.reload(); }
    } catch (error) { if (alive.current) setMessage(errorMessage(error)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };

  if (availability === "unsupported") return null;
  return (
    <section className="wanjuan-account-settings-band" aria-busy={busy || availability === "checking"}>
      <div className="wanjuan-account-band-heading"><Cloud size={18} /><div><strong>{text.title}</strong><span>{text.note}</span></div></div>
      {availability !== "ready" ? <div className="wanjuan-cloud-project-controls">
        <p role="status" className="wanjuan-account-band-note">{availability === "checking" ? text.checking : text.serviceUnavailable}</p>
        {availability === "unavailable" && <button type="button" className="wanjuan-account-outline-button" onClick={() => void checkAvailability()}>{text.retry}</button>}
      </div> : <>
      <div className="wanjuan-cloud-project-controls">
        <label>{text.project}<select aria-label={text.project} value={selectedProject?.id || ""} onChange={(event) => setSelected(event.target.value)} disabled={busy}>
          {localProjects.map((project) => <option key={project.id} value={project.id}>{project.name || project.id}</option>)}
        </select></label>
        <button type="button" className="wanjuan-account-outline-button" disabled={busy || !selectedProject} onClick={sync}><Upload size={15} />{text.upload}</button>
        <button type="button" className="wanjuan-account-outline-button" disabled={busy} onClick={() => list(false)}><RefreshCw size={15} />{text.list}</button>
      </div>
      {busy && <p role="status" className="wanjuan-account-band-note">{text.loading}</p>}
      {message && <p role="status" className="wanjuan-account-band-note">{message}</p>}
      {remote && <div className="wanjuan-cloud-project-list" aria-label={text.pending}>
        {!remote.length && <p className="wanjuan-account-band-note">{text.none}</p>}
        {remote.map((item) => <div className="wanjuan-cloud-project-item" key={item.projectId}>
          <span>{item.projectId.slice(0, 8)}… · v{item.revision}</span>
          <button type="button" className="wanjuan-account-outline-button" disabled={busy} onClick={() => restore(item)}><Download size={15} />{text.restore}</button>
        </div>)}
        {cursor && <button type="button" className="wanjuan-account-outline-button" disabled={busy} onClick={() => list(true)}>{text.more}</button>}
      </div>}
      </>}
    </section>
  );
}
