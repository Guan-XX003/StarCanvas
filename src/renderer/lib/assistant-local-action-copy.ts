import {assistantPreferenceLabel} from './assistant-preferences';
export function assistantPreferenceOperationReceipt(result:any,language:string){
 const {kind,value,wasAlready}=result;
 if(kind==='autoDownload')return language==='en-US'?`Automatic download of generated results is ${wasAlready?'already ':''}${value?'on':'off'}. This does not start generation.`:language==='zh-TW'?`${wasAlready?'生成結果自動下載原本已':'已'}${value?'開啟':'關閉'}${wasAlready?'':'生成結果自動下載'}，不會開始產生。`:`${wasAlready?'生成结果自动下载原本已':'已'}${value?'开启':'关闭'}${wasAlready?'':'生成结果自动下载'}，不会开始生成。`;
 const label=assistantPreferenceLabel(kind,value,language);
 return language==='en-US'?`${kind==='theme'?'Theme':'Language'} is ${wasAlready?'already':'now'} ${label}.`:language==='zh-TW'?(wasAlready?`目前${kind==='theme'?'主題':'語言'}已是${label}。`:`已切換${kind==='theme'?'主題':'語言'}為${label}。`):(wasAlready?`当前${kind==='theme'?'主题':'语言'}已是${label}。`:`已切换${kind==='theme'?'主题':'语言'}为${label}。`);
}
export function assistantNavigationDestinationLabel(destination:string,language:string){
 const labels={canvas:['画布','畫布','Canvas'],resources:['资源','資源','Resources'],agents:['智能体','智慧體','Agents'],workspace:['工作空间','工作空間','Workspace'],settings:['设置','設定','Settings'],account:['账号设置','帳號設定','Account settings'],appearance:['外观设置','外觀設定','Appearance settings'],api:['API 配置','API 設定','API settings'],models:['模型配置','模型設定','Model settings'],generation:['生成与下载','生成與下載','Generation and downloads']};
 return labels[destination]?.[language==='en-US'?2:language==='zh-TW'?1:0]||'';
}
export function assistantNavigationOperationReceipt(destination:string,language:string){
 const label=assistantNavigationDestinationLabel(destination,language);
 return language==='en-US'?`Opened ${label}.`:language==='zh-TW'?`已開啟${label}。`:`已打开${label}。`;
}
