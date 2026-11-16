import { buildAssistantLocalDiagnosis } from "./assistant-onboarding";

/** Render only the already-redacted local task metadata, in the current UI language. */
export function localButlerDiagnosisView(state:any, language:string) {
  const locale = language === "en-US" ? "en-US" : language === "zh-TW" ? "zh-TW" : "zh-CN";
  const copy = {
    "zh-CN": {task:"本地失败任务",check:"本地任务检查",limited:"仅使用必要的本地状态信息。",none:"任务清单中没有可诊断的失败记录。",uncertain:"任务状态无法确认。",order:"无法可靠判断失败任务的创建顺序。",hint:"请先查看任务清单；没有发送任务数据或修改配置。"},
    "zh-TW": {task:"本機失敗任務",check:"本機任務檢查",limited:"僅使用必要的本機狀態資訊。",none:"任務清單中沒有可排查的失敗紀錄。",uncertain:"無法確認任務狀態。",order:"無法可靠判斷失敗任務的建立順序。",hint:"請先查看任務清單；未傳送任務資料或修改設定。"},
    "en-US": {task:"Local failed task",check:"Local task check",limited:"Only necessary local status information is used.",none:"No failed task is available for diagnosis.",uncertain:"Task status could not be confirmed.",order:"The creation order of failed tasks cannot be determined reliably.",hint:"Check the task list; no task data was sent and no configuration was changed."},
  }[locale];
  const reason = state?.localReason;
  if (state?.noFailure || reason === "status_uncertain" || reason === "order_uncertain") {
    const message = state?.noFailure ? copy.none : reason === "order_uncertain" ? copy.order : copy.uncertain;
    return {title:copy.check, message, diagnosis:{classification:"unknown", summary:message, evidence:[], suggestedFix:copy.hint}};
  }
  const lines = buildAssistantLocalDiagnosis([{status:"failed", type:state?.task?.type, errorMsg:state?.task?.errorMsg}], locale, "selected").split("\n");
  return {title:copy.task, message:copy.limited, diagnosis:{classification:"unknown", summary:lines[0], evidence:lines.slice(1,-1), suggestedFix:lines.at(-1) || ""}};
}
