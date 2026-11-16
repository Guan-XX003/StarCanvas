const labels:Record<string,readonly [string,string,string]>={
  queued:['排队中','排隊中','Queued'],
  running:['处理中','處理中','Working'],
  completed:['已完成','已完成','Completed'],
  failed:['失败','失敗','Failed'],
  cancelled:['已停止','已停止','Stopped'],
  interrupted:['已中断，未自动重试','已中斷，未自動重試','Interrupted; not retried'],
  unavailable:['暂时无法更新任务状态','暫時無法更新任務狀態','Task status temporarily unavailable'],
};
export function assistantWorkspaceTaskLabel(status:string,language:string){
  return labels[status]?.[language==='en-US'?2:language==='zh-TW'?1:0]||'';
}
