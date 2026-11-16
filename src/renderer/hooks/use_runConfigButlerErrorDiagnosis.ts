/**
 * The default error query is a local, minimal diagnostic. It must not send a
 * task, protocol, URL, prompt or documentation to a model or external reader.
 */
import type { Ref, SetAny } from "../lib/app-types";
import { buildAssistantLocalDiagnosis } from "../lib/assistant-onboarding";
import { safeGenerationError } from "../lib/custom-task-error";

interface UseRunConfigButlerErrorDiagnosisDeps {
  configButlerErrorAssistantInFlightRef: Ref;
  setConfigButlerErrorAssistant: SetAny;
  [key:string]: unknown;
}

export function use_runConfigButlerErrorDiagnosis(deps: UseRunConfigButlerErrorDiagnosisDeps) {
  const {configButlerErrorAssistantInFlightRef, setConfigButlerErrorAssistant} = deps;
  const runConfigButlerErrorDiagnosis = async (diagnosisContext:any, diagnosisOptions:any) => {
    try {
      if (diagnosisContext?.reason === "status_uncertain" || diagnosisContext?.reason === "order_uncertain") {
        const message = diagnosisContext.reason === "status_uncertain" ? "部分任务状态无法确认，无法可靠识别失败任务。" : "存在失败任务，但无法可靠判断创建顺序。";
        setConfigButlerErrorAssistant({
          id:String(Date.now()), status:"ready", localOnly:true, localReason:diagnosisContext.reason, title:"配置管家本地排查",
          task:{modelName:"", errorMsg:message}, failures:[], triggeredAt:Date.now(),
          diagnosis:{classification:"unknown", confidence:null, summary:message, evidence:[], suggestedFix:"请先查看任务清单，本次没有发送任务数据或修改配置。", shouldApplyPatch:false, suggestedProtocol:null},
        });
        return;
      }
      const task = diagnosisContext?.task || {};
      const safeError = safeGenerationError(task.errorMsg, "media");
      const rawType = typeof task.customOutputType === "string" ? task.customOutputType : task.type;
      const type = typeof rawType === "string" && ["text","image","video","audio","music"].includes(rawType.toLowerCase()) ? rawType.toLowerCase() : "other";
      const summary = buildAssistantLocalDiagnosis([{status:"failed", type, errorMsg:safeError}], "zh-CN", "selected").split("\n");
      setConfigButlerErrorAssistant({
        id: String(Date.now()),
        status: "ready",
        localOnly: true,
        title: "配置管家本地排查",
        // Keep only the model binding needed by the explicitly opened manual
        // protocol editor. Do not copy prompt, URL, request or raw error.
        task: {modelName: typeof task.modelName === "string" ? task.modelName : "", type, errorMsg:safeError},
        failures: [],
        triggeredAt: Date.now(),
        diagnosis: {
          classification:"unknown",
          confidence:null,
          summary:summary[0],
          evidence:summary.slice(1, -1),
          suggestedFix:summary.at(-1) || "",
          shouldApplyPatch:false,
          suggestedProtocol:null,
        },
      });
    } finally {
      configButlerErrorAssistantInFlightRef.current.delete(diagnosisOptions);
    }
  };
  return {runConfigButlerErrorDiagnosis};
}
