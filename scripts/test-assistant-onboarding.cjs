const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { shouldOfferAssistantOnboarding: offer, normalizeAssistantDocumentationUrl: url, assistantCanDiscloseTargetUrl: target, redactAssistantDocumentation: redact, parseAssistantReply: reply, isValidAssistantNodeContent: validNodeContent, assistantChatFailureMessage: failureMessage, buildAssistantFailureSummary: failure } = require("../src/renderer/lib/assistant-onboarding.ts");
const {markAssistantSessionBoundary: boundary, clearAssistantProposals: clearProposals} = require("../src/renderer/lib/assistant-onboarding.ts");
const {buildAssistantButlerHandoff: handoff} = require("../src/renderer/lib/assistant-onboarding.ts");
const {assistantNodeSubmissionNotice: nodeNotice} = require("../src/renderer/lib/assistant-onboarding.ts");
const {assistantNodeUncertainNotice: nodeUncertainNotice} = require("../src/renderer/lib/assistant-onboarding.ts");
const {isAssistantDiagnosticDraft: isDiagnosticDraft} = require("../src/renderer/lib/assistant-onboarding.ts");
const {containsLikelyAssistantSecret: rendererSecretCheck} = require('../src/renderer/lib/assistant-onboarding.ts');
const {containsLikelyAssistantSecret: mainSecretCheck} = require('../electron/main/assistant-context.cjs');
for (const [input, expected] of [
  ['sk-abcdefghijklmnop', true],
  ['Authorization: Bearer abcdefghijklmnop', true],
  ['Authorization: Basic c3ludGhldGlj', true],
  ['{"Authorization":"Basic eA=="}', true],
  ['Authorization: Bearer short', true],
  ['https://synthetic:short@example.test/path', true],
  ['https://example.test/?password=123456', true],
  ['https://example.test/?key=short', true],
  ['https://example.test/#session_id=short', true],
  ['https://example.test/?X-Amz-Credential=synthetic', true],
  ['https://example.test/%253Fkey%253Dshort', true],
  ['password=123456', true],
  ['{"password":"123456"}', true],
  ['密码：123456', true],
  ['我的密码：123456', true],
  ['密碼：123456', true],
  ['https://example.test/?token=syntheticvalue', true],
  ['{"api_key":"syntheticvalue"}', true],
  ['ｓｋ－abcdefghijklmnop', true],
  ['s\u200bk-abcdefghijklmnop', true],
  ['s%E2%80%8Bk-abcdefghijklmnop', true],
  ['s%25E2%2580%258Bk-abcdefghijklmnop', true],
  ['https://example.test/%FF%3Ftoken%3Dsyntheticvalue', true],
  ['https://example.test/%3F%74oken%3Dsyntheticvalue', true],
  ['https://example.test/%253Ftoken%253Dsyntheticvalue', true],
  ['https://example.test/?page=1&topic=canvas', false],
  ['请帮我打开 API 配置', false],
  ['How do I safely store an API key?', false],
  ['如何修改密码？', false],
  ['Why does the password reset fail?', false],
  [null, false],
]) {
  assert.equal(rendererSecretCheck(input), expected);
  assert.equal(mainSecretCheck(input), expected, 'main and renderer checks agree');
}
const {buildAssistantLocalDiagnosis: localDiagnosis} = require("../src/renderer/lib/assistant-onboarding.ts");
for (const language of ['zh-CN','zh-TW','en-US']) {
 const draft=failure([{status:'failed',type:'image',errorMsg:'HTTP 429 rate limit'}],language);
 assert.equal(isDiagnosticDraft(draft),true);
 assert.equal(isDiagnosticDraft(draft.split('\n').slice(1).join('\n')),true,'edited introduction retains diagnostic fields');
}
assert.equal(isDiagnosticDraft('打开设置'),false,'replacing the summary does not keep diagnostic routing');
assert.match(nodeUncertainNotice('zh-CN'),/无法确认.*检查原画布/);
assert.match(nodeUncertainNotice('zh-TW'),/無法確認.*檢查原畫布/);
assert.match(nodeUncertainNotice('en-US'),/Could not confirm.*check the original canvas/);
const {assistantPreferenceUncertainNotice: uncertainNotice} = require("../src/renderer/lib/assistant-onboarding.ts");
const {consumeAssistantNavigationProposal: consumeNavigation, assistantNavigationUnconfirmedNotice: navigationUnconfirmed} = require("../src/renderer/lib/assistant-onboarding.ts");
const {assistantMessageOrigin: messageOrigin, assistantMessageOriginLabel: originLabel} = require("../src/renderer/lib/assistant-onboarding.ts");
const {clampAssistantLauncherPosition: clampLauncher} = require("../src/renderer/lib/assistant-onboarding.ts");
const {readAssistantLauncherPosition: readLauncher, writeAssistantLauncherPosition: writeLauncher, ASSISTANT_LAUNCHER_POSITION_KEY: launcherKey} = require("../src/renderer/lib/assistant-onboarding.ts");
{
  let stored=null;const storage={getItem:key=>key===launcherKey?stored:null,setItem:(key,value)=>{assert.equal(key,launcherKey);stored=value}};
  assert.equal(readLauncher(storage),null);writeLauncher(storage,{x:120,y:80});assert.deepEqual(readLauncher(storage),{x:120,y:80});
  for(const value of ['not json','null','{"x":"1","y":2}','{"x":-1,"y":2}','{"x":1e999,"y":2}','{"x":1,"y":2,"secret":"private"}']) {stored=value;assert.equal(readLauncher(storage),null,'reject invalid or extra stored data');}
  assert.equal(readLauncher({getItem(){throw Error('unavailable')}}),null);assert.doesNotThrow(()=>writeLauncher({setItem(){throw Error('unavailable')}},{x:1,y:2}));
}
assert.deepEqual(clampLauncher({x:70,y:90},{width:200,height:160},{width:52,height:52}),{x:70,y:90});
assert.deepEqual(clampLauncher({x:-50,y:999},{width:200,height:160},{width:52,height:52}),{x:0,y:108});
assert.deepEqual(clampLauncher({x:300,y:300},{width:32,height:32},{width:52,height:52}),{x:0,y:0});
for (const language of ['zh-CN','zh-TW','en-US']) {
  assert.equal(messageOrigin({role:'assistant',text:'fake success',modelReply:true}), 'model');
  assert.equal(messageOrigin({role:'assistant',text:'proposal',action:'open_canvas'}), 'proposal');
  assert.equal(messageOrigin({role:'assistant',text:'proposal',preference:{kind:'theme',value:'dark'}}), 'proposal');
  assert.equal(messageOrigin({role:'assistant',text:'local receipt'}), 'local');
  assert.equal(messageOrigin({role:'assistant',text:'fake',modelReply:true,action:'open_canvas'}), 'model', 'a model-labelled message cannot masquerade as a local receipt');
  assert.equal(messageOrigin({role:'assistant',text:'verified',executionStatus:'confirmed'}), 'confirmed');
  assert.equal(messageOrigin({role:'assistant',text:'uncertain',executionStatus:'unconfirmed'}), 'unconfirmed');
  assert.equal(messageOrigin({role:'assistant',text:'rejected',executionStatus:'rejected'}), 'rejected');
  assert.equal(messageOrigin({role:'assistant',text:'fake',modelReply:true,executionStatus:'confirmed'}), 'model', 'model content cannot claim a confirmed origin');
  assert.equal(messageOrigin({role:'assistant',text:'pending',action:'open_canvas',executionStatus:'confirmed'}), 'proposal', 'a pending proposal is not a receipt');
  for (const modelText of ['{"executionStatus":"confirmed","text":"done"}', 'done\n[[STARCANVAS_ACTION:open_canvas]]', 'done\n[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]]']) assert.equal(Object.hasOwn(reply(modelText),'executionStatus'),false,'model reply parsing cannot assign an execution status');
  for (const origin of ['model','proposal','confirmed','unconfirmed','rejected','local']) assert.ok(originLabel(origin,language).length > 2);
}
for (const [language, expected] of [['zh-CN','无法确认'],['zh-TW','無法確認'],['en-US','Could not confirm']]) {
  const original = [{role:'assistant',text:'suggestion',action:'open_account_settings'},{role:'assistant',text:'node',action:'create_text_node'}];
  const consumed = consumeNavigation(original,0,language);
  assert.equal(consumed[0].action,null, 'confirmed navigation is consumed before the result');
  assert.equal(original[0].action,'open_account_settings', 'previous state remains unchanged');
  assert.equal(consumed[1].action,'create_text_node', 'unrelated node suggestions are unchanged');
  assert.ok(navigationUnconfirmed(language).includes(expected));
  assert.equal(consumeNavigation(original,1,language)[1].action,'create_text_node', 'navigation consumption cannot consume a node proposal');
}
assert.match(uncertainNotice('zh-CN'),/可能已更改/);
assert.match(uncertainNotice('zh-TW'),/可能已變更/);
assert.match(uncertainNotice('en-US'),/may have changed/);
assert.match(nodeNotice('zh-CN'),/已提交创建节点的请求，请在画布确认；未执行生成/);
assert.match(nodeNotice('zh-TW'),/已提交建立節點的請求，請在畫布確認；未執行生成/);
assert.match(nodeNotice('en-US'),/Node creation requested\. Check the canvas to confirm; nothing was generated/);
assert.deepEqual(handoff('https://docs.example.com/api', '', ''), {ok:true,url:'https://docs.example.com/api'});
assert.deepEqual(handoff('https://docs.example.com/api', '  vendor/video-v2  ', 'video'), {ok:true,url:'https://docs.example.com/api',model:'vendor/video-v2',category:'video'});
assert.equal(handoff('https://docs.example.com/api', 'model-v2', '').field, 'pair');
assert.equal(handoff('https://docs.example.com/api', '', 'image').field, 'pair');
assert.equal(handoff('https://docs.example.com/api', 'model', 'text').field, 'pair');
assert.equal(handoff('https://docs.example.com/api', 'sk-1234567890123456', 'video').field, 'model');
assert.equal(handoff('https://docs.example.com/api', 'a\nb', 'image').field, 'model');
assert.equal(handoff('https://docs.example.com/api?token=secret', 'model', 'image').field, 'url');
const earlier = [{role:'user',text:'question'}, {role:'assistant',text:'suggestion',action:'create_video_node',draft:'draft'}];
const reset = boundary(earlier, 'new session');
assert.equal(reset.length, 3);
assert.equal(reset[0].text, 'question');
assert.equal(reset[1].action, null, 'a stale action cannot be executed across a reset');
assert.equal(earlier[1].action, 'create_video_node', 'the old state was not mutated');
assert.equal(clearProposals(earlier)[1].action, null, 'a newer user message invalidates the older action');
assert.equal(clearProposals(earlier)[1].proposalExpired, true, 'invalidated proposals are visibly identified');
assert.equal(clearProposals([{role:'assistant',text:'old',preference:{kind:'theme',value:'dark'}}])[0].preference, null, 'a newer user message invalidates the older preference');
assert.deepEqual(reset[2], {role:'notice',text:'new session'});
assert.deepEqual(boundary(reset, 'new session'), reset, 'a repeated boundary is not shown twice');
assert.equal(boundary(reset, 'different notice').length, 4, 'a different notice is retained');
assert.equal(offer(false, false, false, false), false, "wait for settings hydration");
assert.equal(offer(true, false, false, false), true, "show to an unconfigured first-time profile");
assert.equal(offer(true, true, false, false), false, "do not reopen during this session");
assert.equal(offer(true, false, true, false), false, "respect skip");
assert.equal(offer(true, false, false, true), false, "do not interrupt an existing configuration");
assert.equal(url(" https://docs.example.com/guide?id=7 "), "https://docs.example.com/guide?id=7");
for (const input of ["", "javascript:alert(1)", "file:///tmp/a", "https://user:pass@example.com/", "https://docs.example.com/?token=sensitive", "https://docs.example.com/?api_key=sensitive", "https://docs.example.com/#access_token=sensitive"]) assert.equal(url(input), "", `reject ${input.split("?")[0].split("#")[0]}`);
for (const input of ['https://docs.example.com/?key=synthetic', 'https://docs.example.com/?passwd=123456', 'https://docs.example.com/#session_id=synthetic', 'https://docs.example.com/?next=https%3A%2F%2Fapi.example.com%2F%3Fkey%3Dsynthetic']) {
  assert.equal(url(input),'','credential-bearing documentation address must not reach the third-party reader');
  assert.equal(target(input),false,'credential-bearing target must not be disclosed to the model');
}
for (const input of ["http://localhost/", "http://gateway/", "http://printer.local/", "http://192.168.31.1/", "http://2130706433/", "http://[::1]/", "https://docs.example.com/?X-Amz-Credential=private", "https://docs.example.com/?X-Amz-Signature=private", "https://docs.example.com/#access%5Ftoken=private"]) assert.equal(url(input), "", "reject private-looking or credential-bearing link");
assert.equal(url("https://docs.example.com/guide#authentication"), "https://docs.example.com/guide#authentication");
assert.equal(target('http://192.168.1.1:3000/v1'), true, 'the target address may be a user-operated local gateway');
assert.equal(target('https://user:pass@example.com/'), false);
assert.equal(target('https://example.com/?X-Amz-Signature=secret'), false);
const redacted = redact('Authorization: Bearer abcdefghijkl\n{"api_key":"secret-value"}\nhttps://example.com/?token=abc123\nsk-1234567890123456');
const extendedRedacted = redact('https://name:SYNTHETIC_USERINFO@api.example.com/v1\nGET /?key=SYNTHETIC_QUERY&limit=20\nGET /#password=SYNTHETIC_PASSWORD\nGET /%3Fkey%3DSYNTHETIC_ENCODED%26limit%3D20\napi_key: SYNTHETIC_YAML');
assert.doesNotMatch(extendedRedacted,/SYNTHETIC_USERINFO|SYNTHETIC_QUERY|SYNTHETIC_PASSWORD|SYNTHETIC_ENCODED|SYNTHETIC_YAML/);
assert.match(extendedRedacted,/limit=20/,'ordinary documentation parameters remain available');
for (const secret of ['abcdefghijkl', 'secret-value', 'abc123', 'sk-1234567890123456']) assert.equal(redacted.includes(secret), false);
for (const secret of ['AIza'+'a'.repeat(20),'ghp_'+'a'.repeat(20),'AKIA'+'A'.repeat(16)]) assert.equal(redact(`Example: ${secret}`).includes(secret),false,'standalone credential-shaped values are removed');
const oneLineCurl = redact('curl https://example.com/chat -H "Authorization: Bearer synthetic-secret" -d \'{"model":"demo"}\'');
assert.equal(oneLineCurl.includes('synthetic-secret'), false);
assert.ok(oneLineCurl.includes('-d \'{"model":"demo"}\''), 'redaction preserves following curl body');
for (const sample of ['Authorization: Bearer "quotedsecret"', "Authorization: Bearer 'quotedsecret'", 'x-api-key: "quotedsecret"', 'Authorization: "quotedsecret"']) {
  assert.equal(redact(sample).includes('quotedsecret'), false, 'quoted credentials are not retained');
}
assert.deepEqual(reply('可以打开设置。\n[[STARCANVAS_ACTION:open_api_settings]]'), {text:'可以打开设置。',action:'open_api_settings'});
assert.deepEqual(reply('Open models.\n[[STARCANVAS_ACTION:open_model_settings]]'), {text:'Open models.',action:'open_model_settings'});
assert.deepEqual(reply('Open agents.\n[[STARCANVAS_ACTION:open_agents]]'), {text:'Open agents.',action:'open_agents'});
assert.deepEqual(reply('Open resources.\n[[STARCANVAS_ACTION:open_resources]]'), {text:'Open resources.',action:'open_resources'});
for (const action of ['open_canvas','open_workspace','open_account_settings','open_appearance_settings']) {
  assert.deepEqual(reply(`Open this page.\n[[STARCANVAS_ACTION:${action}]]`), {text:'Open this page.',action});
  assert.equal(reply(`[[STARCANVAS_ACTION:${action}]]`).action, null, 'navigation requires an explanation');
}
for (const kind of ['text','image','video']) assert.deepEqual(reply(`Create an empty node.\n[[STARCANVAS_ACTION:create_${kind}_node]]`), {text:'Create an empty node.',action:`create_${kind}_node`});
assert.deepEqual(reply('Confirm the change.\n[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]]'), {text:'Confirm the change.',action:null,preference:{kind:'theme',value:'dark'}});
for (const [kind,value,other] of [['theme','dark','light'],['language','en-US','zh-CN'],['autoDownload',true,false]]) {
  const item=reply(`Confirm.\n[[STARCANVAS_PREFERENCE:${JSON.stringify({kind,value})}]]`).preference;
  assert.ok(Object.isFrozen(item),'the value displayed in a confirmation cannot be changed in place');
  assert.equal(Reflect.set(item,'value',other),false);assert.equal(item.value,value);
}
assert.deepEqual(reply('Confirm the change.\n[[STARCANVAS_PREFERENCE:{"kind":"language","value":"zh-TW"}]]'), {text:'Confirm the change.',action:null,preference:{kind:'language',value:'zh-TW'}});
for (const value of [true,false]) assert.deepEqual(reply(`Confirm.\n[[STARCANVAS_PREFERENCE:${JSON.stringify({kind:'autoDownload',value})}]]`),{text:'Confirm.',action:null,preference:{kind:'autoDownload',value}});
for (const payload of [{kind:'theme',value:'__proto__'},{kind:'theme',value:'dark',extra:'x'},{kind:'delete',value:'dark'},{kind:'language',value:'xx'},{kind:'autoDownload',value:'false'},{kind:'autoDownload',value:1},{kind:'autoDownload',value:true,url:'https://example.com'},['theme','dark']]) assert.equal(reply(`Confirm.\n[[STARCANVAS_PREFERENCE:${JSON.stringify(payload)}]]`).preference, undefined, 'reject unapproved preference proposals');
assert.equal(reply('[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]]').preference, undefined, 'proposal requires explanation');
assert.equal(reply('Confirm.\n[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]] trailing').preference, undefined, 'proposal must be final');
assert.equal(boundary([{role:'assistant',text:'old proposal',preference:{kind:'theme',value:'dark'}}], 'new')[0].preference, null, 'reset invalidates preference proposals');
assert.equal(reply('Create.\n[[STARCANVAS_ACTION:create_custom_node]]').action, null, 'unapproved node types are rejected');
for (const [type, action] of [['text','create_text_node'], ['image','create_image_node'], ['video','create_video_node']]) {
  const draft = '可编辑内容\nsecond line';
  assert.deepEqual(reply(`Please review.\n[[STARCANVAS_NODE:${JSON.stringify({type,content:draft})}]]`), {text:'Please review.',action,draft});
}
for (const payload of [{type:'video',content:'a',url:'https://example.com'}, {type:'custom',content:'a'}, {type:'__proto__',content:'a'}, {type:'text',content:'a'.repeat(4001)}, {type:'image',content:'bad\u0000content'}, {type:'text',content:42}, ['text','draft']]) {
  assert.equal(reply(`Review.\n[[STARCANVAS_NODE:${JSON.stringify(payload)}]]`).action, null, 'reject non-allowlisted or malformed node proposals');
}
assert.equal(reply('[[STARCANVAS_NODE:{"type":"text","content":"x"}]]').action, null, 'proposal requires explanatory text');
assert.equal(reply('Review.\n[[STARCANVAS_NODE:{broken}]]').action, null, 'malformed JSON never executes');
assert.equal(validNodeContent('normal\ntext'), true);
assert.equal(validNodeContent('x\u0001y'), false);
for (const content of ['sk-1234567890abcdef','Authorization: Bearer 1234567890abcdef','https://fixture.invalid/?api_key=1234567890abcdef','{"client_secret":"1234567890abcdef"}']) {
  assert.equal(validNodeContent(content),false,'common credential shapes cannot be persisted via a node proposal');
  assert.equal(reply(`Review.\n[[STARCANVAS_NODE:${JSON.stringify({type:'text',content})}]]`).action,null);
}
assert.equal(validNodeContent('Explain how to create an API key, without showing one.'),true);
for (const lang of ['zh-CN','zh-TW','en-US']) {
  for (const code of ['ASSISTANT_PROVIDER_AUTH','ASSISTANT_PROVIDER_QUOTA','ASSISTANT_PROVIDER_RATE_LIMIT','ASSISTANT_PROVIDER_SERVER','ASSISTANT_PROVIDER_TIMEOUT','ASSISTANT_PROVIDER_NETWORK']) assert.ok(failureMessage(code, lang).length > 15);
  assert.equal(failureMessage('synthetic-secret-from-provider', lang).includes('synthetic-secret'), false, 'unknown codes cannot expose error text');
}
for (const content of ['[[STARCANVAS_ACTION:open_api_settings]]', 'text\n[[STARCANVAS_ACTION:delete_project]]', 'text [[STARCANVAS_ACTION:open_api_settings]] trailing']) assert.equal(reply(content).action, null, 'unknown or unexplained actions never become buttons');
for (const content of ['Done.\n[[STARCANVAS_ACTION:open_canvas]]\n[[STARCANVAS_ACTION:open_settings]]', 'Done.\n[[STARCANVAS_UNKNOWN:secret]]', 'Done.\n[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"invalid"}]]', 'Done.\n[[STARCANVAS_ACTION:open_canvas']) {
  const parsed = reply(content);
  assert.equal(parsed.invalidProtocol, true, 'malformed or multiple protocol markers fail closed');
  assert.equal(parsed.action, null);
  assert.equal(parsed.preference, undefined);
  assert.equal(parsed.text, '', 'unverified completion claims are not displayed');
}
assert.deepEqual(reply('Hello! How can I help?'), {text:'Hello! How can I help?',action:null}, 'ordinary conversation remains intact');
const summary = failure([{status:'failed',type:'image',createdAt:1,errorMsg:'HTTP 401'}, {status:'failed',type:'video',createdAt:2,errorMsg:'HTTP 429 rate limit secret=hidden prompt=private https://private.test/media',prompt:'PRIVATE_PROMPT',modelName:'PRIVATE_MODEL',taskId:'PRIVATE_TASK',apiBaseUrl:'https://private.test'}], 'en-US');
assert.match(summary, /Task type: video/); assert.match(summary, /HTTP status: 429/); assert.match(summary, /rate_limit/);
for (const secret of ['hidden','private','PRIVATE_PROMPT','PRIVATE_MODEL','PRIVATE_TASK','https://']) assert.equal(summary.includes(secret), false);
for (const [code,category,advice] of [['401','authentication',/credential/i],['408','timeout',/network/i],['429','rate_limit',/rate.*limit/i]]) {
  for (const language of ['zh-CN','zh-TW','en-US']) {
    const tasks=[{status:'failed',type:'image',errorMsg:`HTTP ${code} PRIVATE_ERROR https://private.invalid/asset`,prompt:'PRIVATE_PROMPT',apiKey:'PRIVATE_KEY'}];
    const draft=failure(tasks,language), diagnosis=localDiagnosis(tasks,language);
    assert.ok(draft.includes(category),`${code}: categorize status without relying on an English error phrase`);
    for (const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','https://']) assert.ok(!draft.includes(secret) && !diagnosis.includes(secret));
    if (language === 'en-US') assert.match(diagnosis,advice);
  }
}
assert.match(failure([{status:'failed',errorMsg:'HTTP 403'}], 'en-US'), /Possible error category: unknown/, '403 alone has multiple possible causes');
assert.match(failure([{status:'failed',errorMsg:'HTTP 429 insufficient quota'}], 'en-US'), /Possible error category: quota/, 'specific textual evidence takes precedence over the status-only hint');
assert.equal(failure([{status:'failed',stoppedByUser:true,errorMsg:'HTTP 401'}], 'zh-CN'), '');
assert.equal(failure([], 'zh-CN'), '');
assert.equal(failure([{status:'failed',errorMsg:'HTTP 429 SECRET_FAILURE'},{status:'mystery',errorMsg:'SECRET_UNKNOWN'}], 'zh-CN'), '', 'unknown statuses cannot produce a misleading diagnostic draft');
assert.match(failure([{status:'FAILED',type:'image',errorMsg:'HTTP 429 rate limit SECRET'}], 'en-US'), /HTTP status: 429/, 'recognized status casing remains consistent with local counts');
assert.equal(failure([{status:'failed',createdAt:2,errorMsg:'HTTP 401'}, {status:'failed',createdAt:2,errorMsg:'HTTP 429'}], 'zh-CN'), '', 'tied creation timestamps do not select an arbitrary failure');
assert.equal(failure([{status:'failed',createdAt:2,errorMsg:'HTTP 401'}, {status:'failed',errorMsg:'HTTP 429'}], 'zh-CN'), '', 'missing creation timestamps do not select an arbitrary failure');
for (const language of ['zh-CN','zh-TW','en-US']) {
  const mixed=[{status:'failed',createdAt:1735689600000,errorMsg:'HTTP 401 PRIVATE_OLD'}, {status:'failed',createdAt:1767225600,errorMsg:'HTTP 429 PRIVATE_NEW'}];
  assert.equal(failure(mixed,language),'','mixed second/millisecond timestamps cannot select a diagnostic record');
  assert.equal(failure([{...mixed[0],createdAt:'2025-01-01T00:00:00Z'},mixed[1]],language),'','ISO and seconds timestamps cannot be silently compared');
}
assert.match(failure([{status:'failed',createdAt:1735689600000,errorMsg:'HTTP 401'}, {status:'failed',createdAt:1767225600000,errorMsg:'HTTP 429'}],'en-US'),/429/);
assert.equal(failure([{status:'failed',createdAt:2,updatedAt:8,errorMsg:'HTTP 401'}, {status:'failed',createdAt:2,updatedAt:9,errorMsg:'HTTP 429'}], 'zh-CN'), '', 'updatedAt cannot break a creation-time tie');
assert.equal(failure([{status:'failed',createdAt:2,updatedAt:8,errorMsg:'HTTP 401'}, {status:'failed',updatedAt:9,errorMsg:'HTTP 429'}], 'zh-CN'), '', 'updatedAt cannot stand in for a missing creation time');
const creationOrdered = failure([{status:'failed',createdAt:1,updatedAt:9,type:'text',errorMsg:'HTTP 401'}, {status:'failed',createdAt:2,updatedAt:3,type:'image',errorMsg:'HTTP 429'}], 'en-US');
assert.match(creationOrdered,/selected by creation time, not failure time/); assert.match(creationOrdered,/Task type: image/); assert.match(creationOrdered,/HTTP status: 429/);
const css = fs.readFileSync(require("node:path").join(__dirname, "../src/renderer/styles/assistant-onboarding.css"), "utf8");
assert.match(css, /html body \.wj-assistant-drawer \.wj-assistant-drawer-body input#wj-assistant-doc\s*\{\s*border-radius:\s*22px\s*!important/, "desktop theme overrides must retain the rounded URL input");
assert.match(css, /html body \.wj-assistant-drawer \.wj-assistant-drawer-body input,\s*html body \.wj-assistant-drawer \.wj-assistant-drawer-body select\s*\{\s*border-radius:\s*16px\s*!important/, "global theme styles must not square the assistant input or select controls");
assert.match(css, /html body \.wj-assistant-generation-review textarea\[readonly\]\s*\{\s*border-radius:\s*12px\s*!important/, "dark and Graphite skins must retain the rounded read-only generation prompt review");
console.log("PASS_ASSISTANT_ONBOARDING_GATING_AND_URL_VALIDATION");
