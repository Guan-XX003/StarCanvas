// UI copy and an owned, disposable preview. No upload, model invocation,
// filesystem path, persistent URL cache or retry lives here.
const copy={
 'zh-CN':{preview:'预览附件',title:'本机附件预览',close:'关闭附件预览',image:'图片',video:'视频',unknown:'不支持的类型',hint:'仅在本机预览；不会上传或发送给模型。',loading:'正在读取加密附件…',reading:'正在读取',saving:'正在加密保存',saved:'已加密保存在本机，尚未发送。',failed:'附件未更新，已添加的文件仍保留。',unsupported:'不支持此类型。请选择 PNG、JPEG、GIF、WebP 图片或 MP4、MOV、WebM 视频。',limit:'最多6个文件，单个32 MiB，总计96 MiB。已添加的文件仍保留。',missing:'本机附件丢失，请重新选择原文件。',corrupt:'附件完整性检查失败，原记录未改动。',scope:'该附件不属于此会话，或已从未发送的草稿中移除。',unavailable:'无法读取附件，请重新选择文件或稍后重试。',decode:'此文件无法在本机解码预览。原附件未改动；预览兼容性不代表模型支持。',pixels:'图片超过本机预览尺寸限制，原附件未改动。',busy:'另一个附件操作尚未结束，请稍后再试。',retry:'重新读取',remove:'移除附件',again:'再次附加'},
 'zh-TW':{preview:'預覽附件',title:'本機附件預覽',close:'關閉附件預覽',image:'圖片',video:'影片',unknown:'不支援的類型',hint:'僅在本機預覽；不會上傳或傳送給模型。',loading:'正在讀取加密附件…',reading:'正在讀取',saving:'正在加密儲存',saved:'已加密儲存在本機，尚未傳送。',failed:'附件未更新，已新增的檔案仍保留。',unsupported:'不支援此類型。請選擇 PNG、JPEG、GIF、WebP 圖片或 MP4、MOV、WebM 影片。',limit:'最多6個檔案，單檔32 MiB，合計96 MiB。已新增的檔案仍保留。',missing:'本機附件遺失，請重新選擇原檔案。',corrupt:'附件完整性檢查失敗，原紀錄未更動。',scope:'附件不屬於此對話，或已從未傳送的草稿中移除。',unavailable:'無法讀取附件，請重新選擇檔案或稍後重試。',decode:'無法在本機解碼預覽此檔案。原附件未更動；預覽相容性不代表模型支援。',pixels:'圖片超過本機預覽尺寸限制，原附件未更動。',busy:'另一個附件操作尚未結束，請稍後再試。',retry:'重新讀取',remove:'移除附件',again:'再次附加'},
 'en-US':{preview:'Preview attachment',title:'Local attachment preview',close:'Close attachment preview',image:'Image',video:'Video',unknown:'Unsupported type',hint:'Local preview only. Nothing is uploaded or sent to a model.',loading:'Reading encrypted attachment…',reading:'Reading',saving:'Encrypting and saving',saved:'Saved encrypted on this device. Not sent yet.',failed:'Attachment update failed. Files already added are retained.',unsupported:'Unsupported type. Choose PNG, JPEG, GIF, WebP images or MP4, MOV, WebM video.',limit:'Up to 6 files, 32 MiB each, 96 MiB total. Files already added are retained.',missing:'The local attachment is missing. Select the original file again.',corrupt:'Attachment integrity check failed. The original record is unchanged.',scope:'This attachment belongs to another conversation or was removed from an unsent draft.',unavailable:'Could not read the attachment. Select it again or retry later.',decode:'This file cannot be decoded for local preview. The original is unchanged; preview compatibility does not imply model support.',pixels:'The image exceeds the local preview dimension limit. The original is unchanged.',busy:'Another attachment operation is still pending. Try again later.',retry:'Read again',remove:'Remove attachment',again:'Attach again'},
};
export function assistantAttachmentCopy(language:string){return copy[language]||copy['zh-CN'];}
export function assistantAttachmentError(code:string,language:string){const c=assistantAttachmentCopy(language);return ({ASSISTANT_MEDIA_UNSUPPORTED:c.unsupported,ASSISTANT_MEDIA_LIMIT:c.limit,ASSISTANT_MEDIA_MISSING:c.missing,ASSISTANT_MEDIA_CORRUPT:c.corrupt,ASSISTANT_MEDIA_SCOPE:c.scope,ASSISTANT_MEDIA_PREVIEW_DECODE:c.decode,ASSISTANT_MEDIA_PREVIEW_LIMIT:c.pixels,ASSISTANT_BUSY:c.busy})[code]||c.unavailable;}
export function assistantAttachmentSize(size:number){return size>=1048576?`${(size/1048576).toFixed(1)} MiB`:size>=1024?`${(size/1024).toFixed(1)} KiB`:`${size} B`;}
const supported=new Set(['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/quicktime','video/webm']);
export function createAssistantMediaPreview({read,makeUrl,revokeUrl,onChange}:{read:(owner:string,id:string)=>Promise<any>;makeUrl:(bytes:Uint8Array,mime:string)=>string;revokeUrl:(url:string)=>void;onChange:(state:any)=>void}){
 let generation=0,url='',active=false;
 function dispose(){if(url){revokeUrl(url);url='';}}
 function failure(code:string){generation++;dispose();onChange({phase:'failed',code});}
 return {
  async open(owner:string,attachment:{id:string;mime:string;size:number}){
   const ticket=++generation;active=true;dispose();onChange({phase:'loading'});
   try{
    const result=await read(owner,attachment.id);if(ticket!==generation)return;
    const raw=result?.bytes,bytes=ArrayBuffer.isView(raw)?new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength):raw instanceof ArrayBuffer?new Uint8Array(raw):null;
    if(!bytes||!bytes.length||bytes.length>32*1024*1024||result.id!==attachment.id||result.mime!==attachment.mime||bytes.length!==attachment.size||!supported.has(result.mime)||result.type!==result.mime.split('/')[0])throw Object.assign(Error(),{code:'ASSISTANT_MEDIA_CORRUPT'});
    url=makeUrl(bytes,result.mime);onChange({phase:'ready',url,type:result.type});
   }catch(error:any){if(ticket===generation)failure(/^ASSISTANT_[A-Z_]+$/.test(error?.code||'')?error.code:'ASSISTANT_MEDIA_UNAVAILABLE');}
  },
  decodeFailed(source:string){if(active&&source===url)failure('ASSISTANT_MEDIA_PREVIEW_DECODE');},
  imageSize(source:string,width:number,height:number){if(active&&source===url&&(!Number.isFinite(width)||!Number.isFinite(height)||width*height>64*1024*1024))failure('ASSISTANT_MEDIA_PREVIEW_LIMIT');},
  close(){active=false;generation++;dispose();},
 };
}
