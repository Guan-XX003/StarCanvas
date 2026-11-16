// Basic, non-secret application settings only. This is not a generic config API.
export const APPLICATION_BASIC_THEMES=Object.freeze(['graphite','dark','light','warm-light','chrome-rose','sage-green','system']);
export const APPLICATION_BASIC_LANGUAGES=Object.freeze(['zh-CN','zh-TW','en-US']);
export const APPLICATION_DESTINATIONS=Object.freeze(['canvas','resources','agents','workspace','settings','account','appearance','api','models','generation']);
const fail=()=>{throw Object.assign(new Error('OPERATION_INVALID_REQUEST'),{code:'OPERATION_INVALID_REQUEST'});};
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(k=>!keys.includes(k)))fail();};
export function parseApplicationLocalArguments(operation,value){
 if(operation==='app.preferences.read'){exact(value,[]);return {};}
 if(operation==='app.navigate'){exact(value,['destination']);if(!APPLICATION_DESTINATIONS.includes(value.destination))fail();return {destination:value.destination};}
 if(operation!=='app.preferences.set')fail();
 exact(value,['kind','value']);
 if(value.kind==='theme'&&APPLICATION_BASIC_THEMES.includes(value.value)||value.kind==='language'&&APPLICATION_BASIC_LANGUAGES.includes(value.value)||value.kind==='autoDownload'&&typeof value.value==='boolean')return {kind:value.kind,value:value.value};
 fail();
}
