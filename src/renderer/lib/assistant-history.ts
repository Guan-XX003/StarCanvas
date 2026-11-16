// Presentation-only navigation. Full encrypted history/model context are never
// sliced or rewritten by these helpers. Queries stay in component memory.
export const ASSISTANT_HISTORY_PAGE_SIZE=24;
export function assistantHistoryRange(total:number,start:number|null){
  const count=Math.max(0,Math.floor(total)),last=Math.max(0,count-ASSISTANT_HISTORY_PAGE_SIZE);
  const from=start===null?last:Math.max(0,Math.min(last,Math.floor(start)));
  return {start:from,end:Math.min(count,from+ASSISTANT_HISTORY_PAGE_SIZE),total:count,older:from>0,newer:from+ASSISTANT_HISTORY_PAGE_SIZE<count};
}
export function assistantHistoryStartAfterChange(start:number|null,previous:{owner:string;total:number;start:number},owner:string,total:number,following:boolean){
  if(following)return null;
  // Reading upward inside the latest page must freeze its absolute start;
  // otherwise an arriving reply silently drops the first visible record.
  return start===null&&previous.owner===owner&&total>previous.total?previous.start:start;
}
export function assistantHistoryMatches(messages:readonly {text:string;attachments?:readonly {name:string}[]}[],query:string){
  const needle=query.trim().slice(0,120).toLocaleLowerCase();if(!needle)return [];
  const found:number[]=[];
  messages.forEach((item,index)=>{if(item.text.toLocaleLowerCase().includes(needle)||item.attachments?.some(file=>file.name.toLocaleLowerCase().includes(needle)))found.push(index);});
  return found;
}
export function assistantSessionMatches(name:string,query:string,untitled:string){return (name||untitled).toLocaleLowerCase().includes(query.trim().slice(0,120).toLocaleLowerCase());}
const copy={
 'zh-CN':{title:'会话记录导航',older:'较早',olderLabel:'查看较早记录',newer:'较新',newerLabel:'查看较新记录',latest:'回到最新',find:'查找记录',query:'查找当前会话文字或附件名',search:'查找',previous:'上一个匹配',next:'下一个匹配',close:'关闭查找',noMatches:'没有匹配记录',sessions:'按名称筛选会话',empty:'没有匹配会话',archivedEmpty:'没有匹配的归档会话',readonly:'归档记录 · 只读',readHint:'查看不会恢复会话或执行历史建议。',loading:'正在读取加密记录…',error:'无法读取归档记录，原记录未改动。',closeArchive:'关闭归档预览',past:'历史软件反馈 · 不代表当前操作'},
 'zh-TW':{title:'對話紀錄導覽',older:'較早',olderLabel:'查看較早紀錄',newer:'較新',newerLabel:'查看較新紀錄',latest:'回到最新',find:'尋找紀錄',query:'尋找目前對話文字或附件名稱',search:'尋找',previous:'上一個符合項目',next:'下一個符合項目',close:'關閉尋找',noMatches:'沒有符合的紀錄',sessions:'依名稱篩選對話',empty:'沒有符合的對話',archivedEmpty:'沒有符合的封存對話',readonly:'封存紀錄 · 唯讀',readHint:'查看不會還原對話或執行歷史建議。',loading:'正在讀取加密紀錄…',error:'無法讀取封存紀錄，原紀錄未更動。',closeArchive:'關閉封存預覽',past:'歷史軟體回饋 · 不代表目前操作'},
 'en-US':{title:'Conversation history navigation',older:'Earlier',olderLabel:'View earlier records',newer:'Later',newerLabel:'View later records',latest:'Latest',find:'Find in chat',query:'Find text or attachment names in this conversation',search:'Find',previous:'Previous match',next:'Next match',close:'Close search',noMatches:'No matching records',sessions:'Filter conversations by name',empty:'No matching conversations',archivedEmpty:'No matching archived conversations',readonly:'Archived history · Read only',readHint:'Viewing does not restore the conversation or execute earlier suggestions.',loading:'Reading encrypted history…',error:'Could not read archived history. The original is unchanged.',closeArchive:'Close archive preview',past:'Historical app feedback · Not a current action'},
};
export function assistantHistoryCopy(language:string){return copy[language]||copy['zh-CN'];}
