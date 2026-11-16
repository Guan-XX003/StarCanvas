import {memo} from 'react';
const copy={
 'zh-CN':{label:'未经验证的模型回答',note:'模型文字不能作为软件操作回执。',streaming:'回复正在接收，尚未完成；不会执行其中的操作建议。',incomplete:'回复未完整收到，仅保留已接收部分；没有自动重试。'},
 'zh-TW':{label:'未經驗證的模型回答',note:'模型文字不能作為軟體操作回執。',streaming:'正在接收回覆，尚未完成；不會執行其中的操作建議。',incomplete:'回覆未完整收到，僅保留已接收部分；沒有自動重試。'},
 'en-US':{label:'Unverified model response',note:'Model text is not an app action receipt.',streaming:'Receiving an unfinished reply. Its suggestions cannot execute actions.',incomplete:'Incomplete reply. Only the received portion was kept; nothing was retried automatically.'},
};
/** Partial model text never passes the action/proposal parser. */
export const AssistantModelQuote=memo(function AssistantModelQuote({text,language,streaming=false,incomplete=false}:{text:string;language:string;streaming?:boolean;incomplete?:boolean}){
 const c=copy[language]||copy['zh-CN'];
 return <blockquote className="wj-assistant-message wj-assistant-model-quote" aria-label={c.label} aria-busy={streaming||undefined} data-assistant-stream-phase={streaming?'receiving':incomplete?'incomplete':undefined}><span data-wanjuan-i18n-skip>{text}</span><footer data-wanjuan-i18n-skip>{streaming?c.streaming:incomplete?c.incomplete:c.note}</footer></blockquote>;
});
