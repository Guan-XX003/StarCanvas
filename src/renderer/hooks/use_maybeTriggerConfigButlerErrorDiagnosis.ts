/**
 * The error query is user-initiated. Do not guess the latest failed task when
 * statuses or creation timestamps do not permit a reliable selection.
 */
import type { Ref } from "../lib/app-types";
import { classifyAssistantTaskStatus, selectLatestAssistantTask } from "../lib/assistant-local-operations";

interface UseMaybeTriggerConfigButlerErrorDiagnosisDeps {
  configButlerErrorAssistant: any;
  configButlerErrorAssistantInFlightRef: Ref;
  runConfigButlerErrorDiagnosis: any;
}

export function use_maybeTriggerConfigButlerErrorDiagnosis(deps: UseMaybeTriggerConfigButlerErrorDiagnosisDeps) {
  const {configButlerErrorAssistantInFlightRef, runConfigButlerErrorDiagnosis} = deps;
  const maybeTriggerConfigButlerErrorDiagnosis = (tasksInput:any, _existingSignatures:any[] = [], triggerOptions:any = {}) => {
    if (triggerOptions?.manual !== true) return false;
    const tasks = Array.isArray(tasksInput) ? tasksInput : [];
    const statusesUnknown = !Array.isArray(tasksInput) || tasks.some((task:any) => classifyAssistantTaskStatus(task) === "unknown");
    const failures = tasks.filter((task:any) => classifyAssistantTaskStatus(task) === "failed");
    if (!statusesUnknown && failures.length === 0) return false;
    const selected = statusesUnknown ? null : selectLatestAssistantTask(failures);
    const reason = statusesUnknown ? "status_uncertain" : selected ? "" : "order_uncertain";
    const dedupeKey = "manual-local-error-query";
    if (configButlerErrorAssistantInFlightRef.current.has(dedupeKey)) return false;
    configButlerErrorAssistantInFlightRef.current.add(dedupeKey);
    runConfigButlerErrorDiagnosis({task:selected, reason}, dedupeKey);
    return true;
  };
  return {maybeTriggerConfigButlerErrorDiagnosis};
}
