// Only fixed editor labels pass through this dictionary. User role names,
// prompts, file contents, model IDs and API names must never be translated.
export const roleEditorCopy:Record<string,readonly [string,string]>={
  '智能体配置':['智慧體設定','Agent settings'],
  '角色设置':['角色設定','Role settings'],
  '实时生效':['即時生效','Applies immediately'],
  '保存后生效':['儲存後生效','Applies after saving'],
  '正在保存…':['正在儲存…','Saving…'],
  '完成并保存':['完成並儲存','Save changes'],
  '取消':['取消','Cancel'],
  '记忆范围（仅开启长期记忆时使用）':['記憶範圍（僅啟用長期記憶時使用）','Memory scope (when long-term memory is enabled)'],
  '仅当前会话（默认）':['僅目前對話（預設）','This conversation only (default)'],
  '此角色的全部会话（明确共享）':['此角色的所有對話（明確共享）','All conversations of this role (explicit sharing)'],
  '保存后用于此角色的新请求；正在运行的任务继续使用提交时的配置。':['儲存後用於此角色的新請求；執行中的任務仍使用提交時的設定。','Saved changes apply to new requests. Running tasks keep the configuration they started with.'],
  '修改角色定位、模型绑定和知识内容，当前页会实时生效。':['修改角色定位、模型綁定與知識內容，目前頁面會即時生效。','Role, model and knowledge changes apply immediately on this page.'],
  '基础信息':['基本資訊','Basics'],
  '名称':['名稱','Name'],
  '简介':['簡介','Description'],
  '图标':['圖示','Icon'],
  '灵感':['靈感','Idea'],
  '机器人':['機器人','Robot'],
  '火花':['火花','Spark'],
  '对话':['對話','Chat'],
  '创作':['創作','Writing'],
  '视觉':['視覺','Vision'],
  '长期记忆 · Mem0':['長期記憶 · Mem0','Long-term memory · Mem0'],
  '已开启':['已啟用','Enabled'],
  '已关闭':['已停用','Disabled'],
  'Mem0 服务地址':['Mem0 服務位址','Mem0 service URL'],
  '请输入可选的 Mem0 服务地址':['輸入選填的 Mem0 服務位址','Optional Mem0 service URL'],
  'AUTH_DISABLED 时可留空':['AUTH_DISABLED 時可留空','Optional when AUTH_DISABLED is set'],
  '用户记忆 ID':['使用者記憶 ID','Memory user ID'],
  '检索条数':['檢索筆數','Search result count'],
  '开启后，每次发送会先检索相关长期记忆并加入上下文；模型回复成功后，会把本轮对话写入 Mem0。':['啟用後，每次傳送會先檢索相關長期記憶並加入上下文；模型回覆成功後，會將本輪對話寫入 Mem0。','When enabled, relevant memories are retrieved before each request. After a successful reply, this turn is sent to your configured Mem0 service.'],
  '模型绑定':['模型綁定','Model binding'],
  '绑定文本模型':['綁定文字模型','Conversation model'],
  '请选择文本模型':['選擇文字模型','Select a conversation model'],
  '绑定 API 配置':['綁定 API 設定','API configuration'],
  '不可用的 API 配置':['無法使用的 API 設定','Unavailable API configuration'],
  '未指定（跟随默认文本配置）':['未指定（使用模型綁定或預設文字設定）','Not specified (use model binding or text default)'],
  '温度':['溫度','Temperature'],
  '默认输出':['預設輸出','Output mode'],
  '普通对话':['一般對話','Chat'],
  '提示词':['提示詞','Prompt'],
  '画布节点草稿':['畫布節點草稿','Canvas node draft'],
  '角色设定':['角色設定','Role instructions'],
  '系统提示词':['系統提示詞','System prompt'],
  '知识库摘要':['知識庫摘要','Knowledge summary'],
  '导入文件':['匯入檔案','Import file'],
  '这里先记录角色长期知识、项目资料摘要、风格规范、FAQ 等。后续可以扩展成真正的文件知识库。':['記錄角色知識、專案資料摘要、風格規範或 FAQ；也可匯入檔案。','Add role knowledge, project notes, style guidelines or FAQs. You can also import knowledge files.'],
  '已导入文件':['已匯入檔案','Imported files'],
  '未命名文件':['未命名檔案','Untitled file'],
  '无可预览内容':['無可預覽內容','No preview available'],
  '移除':['移除','Remove'],
  '支持导入 txt、md、json、csv、rtf、doc、docx、pdf 等常见知识文件。导入后会和上方摘要一起作为智能体知识上下文参与回答。':['支援匯入 txt、md、json、csv、rtf、doc、docx、pdf 等知識檔案。匯入後將與上方摘要一起作為角色知識上下文。','Import txt, md, json, csv, rtf, doc, docx or pdf knowledge files. Their selected knowledge chunks and the summary above may be sent with your conversation requests.'],
  '底层逻辑保持和文本模型一致：文本模型里新增什么模型，智能体就能直接选什么模型；某个文本模型如果绑定了专属 API 配置，智能体也会优先复用那条关系。':['可使用設定中已新增的文字模型。明確指定的角色 API 優先；未指定時使用模型綁定或預設設定。','Use conversation models already added in Settings. An explicit role API takes priority; otherwise the model binding or text default is used.'],
};
export function roleEditorText(text:string,language:string){
  return language==='en-US'?(roleEditorCopy[text]?.[1]||text):language==='zh-TW'?(roleEditorCopy[text]?.[0]||text):text;
}
export function roleKnowledgeCount(count:number,kind:'characters'|'chunks',language:string){
  const value=Number.isFinite(count)?count:0;
  return language==='en-US'?`${value} ${kind}`:language==='zh-TW'?`${value} ${kind==='characters'?'字元':'段落'}`:`${value} ${kind==='characters'?'字符':'段'}`;
}
export function roleKnowledgeTime(value:number|string,language:string){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
  return new Intl.DateTimeFormat(language==='en-US'?'en-US':language==='zh-TW'?'zh-TW':'zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(date);
}
