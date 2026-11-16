#!/usr/bin/env node
// Exercise the actual generation hook with synthetic state and a closed-network transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    });
    module._compile(result.outputText, filename);
  };
}
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'react') return { ...originalLoad.apply(this, arguments), useCallback: (fn) => fn };
  return originalLoad.apply(this, arguments);
};

let uploadCalls = 0;
global.window = {
  addEventListener() {},
  dispatchEvent() {},
  wanjuanDesktop: {
    uploadPublicMedia: async () => { uploadCalls += 1; return { ok: true, url: 'https://fixture.invalid/uploaded' }; },
    uploadCustomPublicMedia: async () => { uploadCalls += 1; return { ok: true, url: 'https://fixture.invalid/uploaded' }; },
    uploadTosMedia: async () => { uploadCalls += 1; return { ok: true, url: 'https://fixture.invalid/uploaded' }; },
    uploadQiniuMedia: async () => { uploadCalls += 1; return { ok: true, url: 'https://fixture.invalid/uploaded' }; },
  },
};
global.localStorage = { getItem: () => null, setItem() {} };

const { useVideoGeneration } = require('../src/renderer/hooks/useVideoGeneration.ts');
const catalog = require('../src/renderer/lib/jixin-catalog.ts');
const h3 = require('../src/renderer/lib/jixin-h3.ts');
const H3_MODEL = h3.JIXIN_H3_MODEL;

function mediaFixture(kind, { imageUrl = 'data:image/png;base64,aGVsbG8=', staleOriginalImageUrl = '' } = {}) {
  if (kind === 'image' || kind === 'first-frame') return {
    node: {
      id: `${kind}-source`, type: 'imageNode', data: {
        imageUrl, mediaKind: 'image',
        ...(staleOriginalImageUrl ? {
          projectAssetBindings: {
            imageUrl: { localPath: '/fixture/original-before-edit.png', sourceSignature: staleOriginalImageUrl, ok: true },
          },
        } : {}),
      },
    },
    edge: { id: `${kind}-edge`, source: `${kind}-source`, target: 'video-test', ...(kind === 'first-frame' ? { sourceHandle: 'first-frame' } : {}) },
  };
  if (kind === 'video') return {
    node: { id: 'video-source', type: 'videoNode', data: { videoUrl: 'data:video/mp4;base64,aGVsbG8=', mediaKind: 'video' } },
    edge: { id: 'video-edge', source: 'video-source', target: 'video-test' },
  };
  if (kind === 'audio') return {
    node: { id: 'audio-source', type: 'audioNode', data: { audioUrl: 'data:audio/mpeg;base64,aGVsbG8=', mediaKind: 'audio' } },
    edge: { id: 'audio-edge', source: 'audio-source', target: 'video-test' },
  };
  if (kind === 'extracted-frame') return {
    node: { id: 'extract-source', type: 'videoExtractNode', data: { allExtractedImages: ['data:image/png;base64,aGVsbG8='], extractedImages: ['data:image/png;base64,aGVsbG8='], hiddenIndices: [] } },
    edge: { id: 'extract-edge', source: 'extract-source', target: 'video-test', sourceHandle: 'frame-0' },
  };
  if (kind === 'generated-result') return {
    node: { id: 'generated-source', type: 'customNode', data: { config: { outputType: 'image' }, resultData: 'data:image/png;base64,aGVsbG8=' } },
    edge: { id: 'generated-edge', source: 'generated-source', target: 'video-test' },
  };
  return null;
}

async function runCase({
  model = H3_MODEL,
  profileName,
  profile,
  prompt = 'Synthetic text-only test',
  duration = '8',
  resolution = '720p',
  ratio = '16:9',
  mediaKind = '',
  selectedContextKind = '',
  staleContextKind = '',
  connectedImageUrl = 'data:image/png;base64,aGVsbG8=',
  staleOriginalImageUrl = '',
  uploadedReferenceUrl = 'https://fixture.invalid/uploaded',
  previousResult = false,
  productionGate = false,
  pollPayloads = [{ status: 'completed', progress: 100, url: 'https://fixture.invalid/result.mp4' }],
  submitPayload = { id: 'fixture-task', status: 'queued' },
  apiUrl = 'https://fixture.invalid',
  apiConfigs = [],
  apiBindings = {},
  selectedApiConfigId,
  apiBindingId,
  bindingModel,
  nodeProtocolBindings,
  protocolRegistry,
  nodeType = 'videoNode',
  tianjiMode = false,
  tianjiGenerationMode,
  tianjiStaleStop = false,
  tianjiReboundNode = false,
  execution,
  nodeData = {},
  tianjiConfig = {},
  tianjiStored = {},
  secondImage = false,
} = {}) {
  const resolvedProfileName = profileName === undefined
    ? catalog.WANJUAN_JIXIN_BUILTIN_VIDEO_PROTOCOL_BINDINGS[model]
    : profileName;
  const sourceProfile = profile || catalog.WANJUAN_JIXIN_BUILTIN_PROTOCOLS[resolvedProfileName] || undefined;
  // Remove the billing gate only in this closed-network fixture, never in shipping defaults.
  const resolvedProfile = sourceProfile && { ...sourceProfile, ...(!productionGate ? { blockedReason: undefined } : {}) };
  let targetData = {
    selectedModel: model,
    videoModel: model,
    selectedApiConfigId,
    ...(tianjiMode ? {seedanceMode:'tianji',tianjiSeedanceModel:'fixture-model',tianjiSelectedModel:'fixture-model',...(tianjiGenerationMode?{tianjiSeedanceGenerationMode:tianjiGenerationMode}:{})} : {}),
    ...(nodeProtocolBindings ? { videoModelProtocolBindings: nodeProtocolBindings } : {}),
    ...(previousResult ? { videoUrl: 'https://fixture.invalid/previous-result.mp4', resultData: { url: 'https://fixture.invalid/previous-result.mp4' } } : {}),
    ...nodeData,
  };
  const contextFor = (kind) => kind === 'video'
    ? { kind: 'video', url: 'data:video/mp4;base64,aGVsbG8=' }
    : kind === 'audio'
      ? { kind: 'audio', url: 'data:audio/mpeg;base64,aGVsbG8=' }
      : { kind: 'image', url: 'data:image/png;base64,aGVsbG8=' };
  if (selectedContextKind) targetData.selectedContextResources = [contextFor(selectedContextKind)];
  let nodes = [{ id: 'video-test', type: nodeType, data: targetData }];
  let edges = [];
  const media = mediaFixture(mediaKind, { imageUrl: connectedImageUrl, staleOriginalImageUrl });
  if (media) {
    nodes.push(media.node);
    edges.push(media.edge);
  }
  if(secondImage){nodes.push({id:'second-image-source',type:'imageNode',data:{imageUrl:'data:image/png;base64,c2Vjb25k',mediaKind:'image'}});edges.push({id:'second-image-edge',source:'second-image-source',target:'video-test'});}
  let refNodes = nodes;
  if (staleContextKind) {
    refNodes = nodes.map((node) => node.id === 'video-test'
      ? { ...node, data: { ...node.data, selectedContextResources: [contextFor(staleContextKind)] } }
      : node);
  }
  let tasks = [];
  const requests = [];
  const notices = [];
  const taskSnapshots = [];
  const generatedAssets = [];
  const nodesRef = { current: refNodes };
  let stored = { nodes };
  let pollIndex = 0;
  uploadCalls = 0;
  const uploadedReferenceSources = [];
  for (const method of ['uploadPublicMedia', 'uploadCustomPublicMedia', 'uploadTosMedia', 'uploadQiniuMedia']) {
    window.wanjuanDesktop[method] = async ({ url }) => {
      uploadCalls += 1;
      uploadedReferenceSources.push(url);
      return { ok: true, url: uploadedReferenceUrl };
    };
  }
  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    assert.ok(requestUrl.includes('fixture') || ['ark.cn-beijing.volces.com', 'aigc.x-see.cn'].includes(new URL(requestUrl).hostname), `unexpected mocked host: ${requestUrl}`);
    requests.push({ url: requestUrl, init });
    if (tianjiMode && requests.length === 1) return Response.json({code:200,data:{execute_id:'fixture-task'}});
    if (tianjiMode && tianjiStaleStop){tasks=tasks.map(t=>({...t,status:'failed',stoppedByUser:true,errorMsg:'已取消'}));nodes=nodes.map(n=>({...n,data:{...n.data,loading:false,manuallyStopped:true,errorMessage:'已取消'}}));nodesRef.current=nodes;stored={nodes};}
    if (tianjiMode && tianjiReboundNode){nodes=nodes.map(n=>({...n,data:{...n.data,seedanceTaskId:'new-task',tianjiExecuteId:'new-task',loading:true}}));nodesRef.current=nodes;stored={nodes};}
    if (!tianjiMode && init.method === 'POST') return Response.json(submitPayload);
    if (requestUrl.includes('/v1/files/retrieve')) {
      return Response.json({ file: { download_url: 'https://fixture.invalid/legacy-file-result.mp4' } });
    }
    const payload = pollPayloads[Math.min(pollIndex, pollPayloads.length - 1)];
    pollIndex += 1;
    return Response.json(payload);
  };

  const { generateVideo } = useVideoGeneration({
    videoApiKey: 'fixture-key',
    videoApiUrl: apiUrl,
    videoModel: model,
    videoDurations: '4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15',
    apiConfigs,
    videoModelApiBindings: apiBindings,
    videoModelProtocolBindings: resolvedProfileName ? { [bindingModel || model]: resolvedProfileName } : {},
    modelProtocolRegistry: protocolRegistry || (resolvedProfileName && resolvedProfile ? { [resolvedProfileName]: resolvedProfile } : {}),
    videoModelRequestProfiles: {},
    planLimits: {},
    membership: {},
    showToast: (text) => notices.push(text),
    getNodes: () => nodes,
    getEdges: () => edges,
    setNodes: (fn) => { nodes = typeof fn === 'function' ? fn(nodes) : fn; nodesRef.current = nodes; },
    setEdges: (fn) => { edges = typeof fn === 'function' ? fn(edges) : fn; },
    updateTaskList: (fn) => { tasks = typeof fn === 'function' ? fn(tasks) : fn; taskSnapshots.push(JSON.stringify(tasks)); },
    addGeneratedAsset: (...args) => generatedAssets.push(args),
    abortControllersRef: { current: new Map() },
    canvasStateKeyPrefix: 'fixture-',
    localforageModule: { default: { getItem: async () => stored, setItem: async (_, value) => { stored = value; } } },
    nodesRef,
    projectIdRef: { current: 'fixture-project' },
    pollIntervalMs: 1,
    timeoutSeconds: 5,
    setDailyGenerationCount() {},
  });
  const originalConsoleError = console.error, originalConsoleWarn = console.warn, originalChrome = global.chrome, originalWindowStorage = window.localStorage, warnings = [], tianjiStorageWrites = [];
  try {
    if(tianjiMode){window.localStorage=global.localStorage;global.chrome={storage:{local:{get:(_keys,cb)=>cb({...tianjiStored,tianjiSeedanceConfig:{baseUrl:'https://fixture.invalid',token:'synthetic-key',syncSource:'manual',models:'fixture-model',durations:'5',resolutions:'720p',ratios:'16:9',...tianjiConfig}}),set:(value,cb)=>{tianjiStorageWrites.push(value);cb();}}}};}
    console.error = (...args) => warnings.push(args.map(String).join(' '));
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    await generateVideo('video-test', prompt, resolution, model, duration, apiBindingId, ratio, execution);
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    global.chrome = originalChrome;window.localStorage=originalWindowStorage;
  }
  return {
    requests,
    tasks,
    node: nodes.find((node) => node.id === 'video-test'),
    stored,
    notices,
    uploadCalls,
    uploadedReferenceSources,
    generatedAssets,
    taskSnapshots,
    warnings,
    tianjiStorageWrites,
  };
}

async function main() {
  // Exercise the real canvas submission and polling path, not just normalization.
  // A newly applied documented protocol must win over model-name heuristics.
  const explicitGrok = await runCase({
    model: 'grok-imagine-video',
    profileName: 'fixture-explicit-gateway',
    profile: {
      category: 'video', requestType: 'json-video',
      submitPath: '/gateway/tasks', pollPath: '/gateway/tasks/{taskId}',
      fieldMapping: { model: 'model', prompt: 'prompt', duration: 'duration', resolution: 'resolution', aspectRatio: 'aspect_ratio' },
      __wanjuanPreferExplicitProtocol: true,
    },
  });
  assert.equal(explicitGrok.node.data.errorMessage, undefined, explicitGrok.node.data.errorMessage);
  assert.equal(explicitGrok.requests[0].url, 'https://fixture.invalid/gateway/tasks');
  assert.equal(explicitGrok.requests[1].url, 'https://fixture.invalid/gateway/tasks/fixture-task');
  const explicitBody = JSON.parse(explicitGrok.requests[0].init.body);
  assert.equal(explicitBody.model, 'grok-imagine-video');
  assert.equal(Object.hasOwn(explicitBody, 'preset'), false);
  assert.equal(Object.hasOwn(explicitBody, 'resolution_name'), false);
  assert.equal(explicitGrok.node.data.videoUrl, 'https://fixture.invalid/result.mp4');

  const explicitVeo = await runCase({
    model:'veo-portrait', apiUrl:'https://aigc.x-see.cn', profileName:'fixture-veo-gateway',
    profile:{category:'video',requestType:'json-video',submitPath:'/v2/create',pollPath:'/v2/jobs/{taskId}',
      fieldMapping:{model:'model',prompt:'prompt',duration:'duration',resolution:'resolution',aspectRatio:'aspect_ratio'},
      __wanjuanPreferExplicitProtocol:true},
  });
  assert.equal(explicitVeo.node.data.errorMessage, undefined, explicitVeo.node.data.errorMessage);
  assert.equal(explicitVeo.requests[0].url, 'https://aigc.x-see.cn/v2/create');
  assert.equal(explicitVeo.requests[1].url, 'https://aigc.x-see.cn/v2/jobs/fixture-task');
  assert.equal(explicitVeo.node.data.videoUrl, 'https://fixture.invalid/result.mp4');

  const profileName = catalog.WANJUAN_JIXIN_BUILTIN_VIDEO_PROTOCOL_BINDINGS[H3_MODEL];
  assert.equal(profileName, h3.JIXIN_H3_PROTOCOL_NAME);
  const profile = catalog.WANJUAN_JIXIN_BUILTIN_PROTOCOLS[profileName];
  assert.equal(profile.requestType, 'json-video');
  assert.equal(profile.submitPath, '/v1/videos');
  assert.equal(profile.pollPath, '/v1/videos/{taskId}');
  assert.equal(profile.blockedReason, h3.JIXIN_H3_BILLING_BLOCKED_REASON);
  const gated = await runCase({ productionGate: true, previousResult: true });
  assert.equal(gated.requests.length, 0);
  assert.equal(gated.uploadCalls, 0);
  assert.equal(gated.tasks.length, 0);
  assert.ok(gated.notices.some((message) => message.includes('计费仍待确认')));
  assert.equal(gated.node.data.videoUrl, 'https://fixture.invalid/previous-result.mp4');
  assert.deepEqual(profile.parameterOptions.qualities, ['720p']);
  assert.deepEqual(profile.parameterOptions.durations, ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);

  const result = await runCase();
  assert.equal(result.node.data.loading, false);
  assert.equal(result.node.data.errorMessage, undefined, result.node.data.errorMessage);
  assert.equal(result.node.data.videoUrl, 'https://fixture.invalid/result.mp4');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].status, 'completed');
  assert.equal(result.generatedAssets.length, 1);
  assert.equal(result.requests.filter((request) => request.init.method === 'POST').length, 1);
  const submission = result.requests.find((request) => request.init.method === 'POST');
  assert.equal(submission.url, 'https://fixture.invalid/v1/videos');
  assert.equal(submission.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(submission.init.body);
  assert.deepEqual(body, {
    model: H3_MODEL,
    prompt: 'Synthetic text-only test',
    duration: 8,
    resolution: '720p',
    ratio: '16:9',
  });
  for (const deprecated of ['seconds', 'size', 'input_reference', 'images', 'videos', 'audios']) {
    assert.equal(Object.hasOwn(body, deprecated), false, `H3 text request must omit ${deprecated}`);
  }
  assert.equal(result.stored.nodes[0].data.videoUrl, result.node.data.videoUrl);

  const inProgress = await runCase({
    pollPayloads: [
      { status: 'in_progress', progress: 42 },
      { status: 'completed', progress: 100, video_url: 'https://fixture.invalid/result-2.mp4' },
    ],
  });
  assert.equal(inProgress.node.data.videoUrl, 'https://fixture.invalid/result-2.mp4');
  assert.equal(inProgress.requests.length, 3, 'submit plus two polls');
  const repeated = await runCase({ previousResult: true });
  assert.equal(repeated.node.data.errorMessage, undefined);
  assert.equal(repeated.requests.filter((request) => request.init.method === 'POST').length, 1);
  const failedWithUrl = await runCase({ pollPayloads: [{ status: 'failed', url: 'https://fixture.invalid/stale.mp4', error: { message: 'Synthetic failed with stale URL' } }] });
  assert.equal(failedWithUrl.tasks[0].status, 'failed');
  assert.equal(failedWithUrl.requests.length, 2);
  const privateFailure = await runCase({ pollPayloads: [{status:'failed',error:{message:'HTTP 429 rate limit SYNTHETIC_PRIVATE_PROMPT https://synthetic.invalid/private'}}] });
  assert.equal(privateFailure.tasks[0].status,'failed');
  assert.match(privateFailure.node.data.errorMessage,/HTTP 429/);
  for(const value of [privateFailure.node.data.errorMessage,privateFailure.tasks[0].errorMsg,...privateFailure.taskSnapshots,...privateFailure.notices,...privateFailure.warnings]) assert.doesNotMatch(value,/SYNTHETIC_PRIVATE_PROMPT|synthetic\.invalid\/private/,'provider error must not reach state, notices or error logs');
  const completedWithoutMedia = await runCase({ pollPayloads: [{ status: 'completed' }] });
  assert.equal(completedWithoutMedia.tasks[0].status, 'failed');
  assert.match(completedWithoutMedia.node.data.errorMessage, /未返回视频地址/);
  const invalidResolution = await runCase({ resolution: '1080p' });
  assert.equal(invalidResolution.requests.length, 0);
  assert.match(invalidResolution.node.data.errorMessage, /720p/);

  for (const terminalStatus of ['failed', 'cancelled']) {
    const terminal = await runCase({
      pollPayloads: [{ status: terminalStatus, error: { message: `Synthetic ${terminalStatus}` } }],
    });
    assert.equal(terminal.tasks.length, 1);
    assert.equal(terminal.tasks[0].status, terminalStatus === 'cancelled' ? 'cancelled' : 'failed');
    assert.doesNotMatch(terminal.node.data.errorMessage, new RegExp(`Synthetic ${terminalStatus}`), 'provider error text is not persisted into the node');
    assert.match(terminal.node.data.errorMessage, terminalStatus === 'cancelled' ? /服务商报告视频任务已取消/ : /生成任务执行失败/);
    assert.equal(terminal.requests.length, 2, `${terminalStatus} must stop polling immediately`);
    const withStaleUrl = await runCase({pollPayloads:[{status:terminalStatus,url:'https://fixture.invalid/stale.mp4'}]});
    assert.equal(withStaleUrl.tasks[0].status, terminalStatus === 'cancelled' ? 'cancelled' : 'failed');
    assert.notEqual(withStaleUrl.node.data.videoUrl,'https://fixture.invalid/stale.mp4');assert.equal(withStaleUrl.generatedAssets.length,0);
  }

  for (const illegalDuration of ['3', '16', '4.5', 'invalid']) {
    const invalid = await runCase({ duration: illegalDuration });
    assert.equal(invalid.requests.length, 0, `illegal duration ${illegalDuration} rejected before network`);
    assert.equal(invalid.uploadCalls, 0);
    assert.match(invalid.node.data.errorMessage, /4–15/);
  }
  const invalidRatio = await runCase({ ratio: '2:3' });
  assert.equal(invalidRatio.requests.length, 0);
  assert.match(invalidRatio.node.data.errorMessage, /画幅比例/);

  const mediaCases = [
    { mediaKind: 'image' },
    { mediaKind: 'first-frame' },
    { mediaKind: 'video' },
    { mediaKind: 'audio' },
    { mediaKind: 'extracted-frame' },
    { mediaKind: 'generated-result' },
    { selectedContextKind: 'image' },
    { selectedContextKind: 'video' },
    { selectedContextKind: 'audio' },
  ];
  for (const mediaCase of mediaCases) {
    const blocked = await runCase(mediaCase);
    assert.equal(blocked.requests.length, 0, `media-conditioned H3 must make zero fetches: ${JSON.stringify(mediaCase)}`);
    assert.equal(blocked.uploadCalls, 0, `media-conditioned H3 must make zero uploads: ${JSON.stringify(mediaCase)}`);
    assert.match(blocked.node.data.errorMessage, /仅开放文生视频/);
  }

  const staleSnapshot = await runCase({ staleContextKind: 'image' });
  assert.equal(staleSnapshot.node.data.errorMessage, undefined, 'stale ref-only context must not override the current topology');
  assert.equal(Object.hasOwn(JSON.parse(staleSnapshot.requests.find((request) => request.init.method === 'POST').init.body), 'images'), false);
  const rerunWithPreviousResult = await runCase({ previousResult: true });
  assert.equal(rerunWithPreviousResult.node.data.errorMessage, undefined, 'the target node previous output is not a new reference input');
  assert.equal(Object.hasOwn(JSON.parse(rerunWithPreviousResult.requests.find((request) => request.init.method === 'POST').init.body), 'videos'), false);

  const customProfileName = '用户 H3 自定义协议';
  const custom = await runCase({
    profileName: customProfileName,
    profile: {
      category: 'video',
      requestType: 'json-video',
      submitPath: '/custom/videos',
      pollPath: '/custom/videos/{taskId}',
      referenceImageMode: 'url',
      referenceImageAsArray: true,
      fieldMapping: { duration: 'duration', resolution: 'resolution', aspectRatio: 'ratio', referenceImage: 'images' },
      fieldValueTypes: { duration: 'number' },
      parameterAdapter: { resolutionValueMode: 'quality', resolutionValueCase: 'lower', aspectRatioValueMode: 'ratio' },
    },
    mediaKind: 'image',
  });
  assert.equal(custom.node.data.errorMessage, undefined, custom.node.data.errorMessage);
  const customBody = JSON.parse(custom.requests.find((request) => request.init.method === 'POST').init.body);
  assert.equal(Array.isArray(customBody.images), true, 'explicit custom protocols remain independent');

  const channelFixture = {
    model: 'fixture.video/v1', bindingModel: 'fixture-video-v1',
    profileName: 'fixture-global-video',
    profile: { category: 'video', requestType: 'json-video', submitPath: '/custom/videos', pollPath: '/custom/videos/{taskId}' },
    apiConfigs: [
      { id: 'relay', url: 'https://fixture-relay.invalid', key: 'fixture-relay-key', videoProtocolBindings: { 'fixture-video-v1': 'fixture-relay-video' } },
      { id: 'official', url: 'https://fixture-official.invalid', key: 'fixture-official-key', videoProtocolBindings: { 'fixture-video-v1': 'fixture-official-video' } },
    ],
    apiBindings: { 'fixture-video-v1': 'relay' },
    nodeProtocolBindings: {}, // An older node's empty snapshot must not hide live settings.
    protocolRegistry: {
      'fixture-global-video': { category: 'video', requestType: 'json-video', submitPath: '/global/videos', pollPath: '/global/videos/{taskId}' },
      'fixture-relay-video': { category: 'video', requestType: 'json-video', submitPath: '/relay/videos', pollPath: '/relay/videos/{taskId}', parameterOptions: { durations: ['5', '7'] } },
      'fixture-official-video': { category: 'video', requestType: 'json-video', submitPath: '/official/videos', pollPath: '/official/videos/{taskId}', parameterOptions: { durations: ['6', '10'] } },
    },
  };
  for (const selection of [{}, { selectedApiConfigId: 'official' }, { selectedApiConfigId: 'relay', apiBindingId: 'official' }]) {
    const selected = selection.selectedApiConfigId === 'official' || selection.apiBindingId === 'official' ? 'official' : 'relay';
    const channel = await runCase({ ...channelFixture, ...selection });
    assert.equal(channel.node.data.errorMessage, undefined, channel.node.data.errorMessage);
    assert.equal(channel.node.data.videoUrl, 'https://fixture.invalid/result.mp4');
    const submission = channel.requests.find((request) => request.init.method === 'POST');
    assert.equal(submission.url, `https://fixture-${selected}.invalid/${selected}/videos`);
    assert.equal(submission.init.headers.Authorization, `Bearer fixture-${selected}-key`);
    assert.equal(JSON.parse(submission.init.body).model, channelFixture.model, 'binding normalization must not rename wire model');
    assert.equal(channel.requests.filter((request) => request.init.method === 'POST').length, 1);
    assert.equal(channel.tasks[0].apiConfigId, selected);
    assert.equal(channel.tasks[0].requestProfile.protocolName, selected === 'relay' ? 'fixture-relay-video' : 'fixture-official-video');
    assert.equal(channel.tasks[0].requestProfile.pollUrl, `https://fixture-${selected}.invalid/${selected}/videos/fixture-task`);
    assert.equal(channel.tasks[0].status, 'completed');
  }

  // The same canvas edge must feed the selected channel's own request shape.
  // This covers the actual interaction path: connected image -> model/channel
  // contract -> submit -> channel-specific poll -> persisted result.
  const connectedReferenceChannels = {
    ...channelFixture,
    apiConfigs: [
      { id: 'relay', url: 'https://fixture-relay.invalid', key: 'fixture-relay-key', videoProtocolBindings: { 'fixture-video-v1': 'fixture-relay-video' } },
      { id: 'official', url: 'https://fixture-official.invalid', key: 'fixture-official-key', videoProtocolBindings: { 'fixture-video-v1': 'fixture-official-video' } },
    ],
    protocolRegistry: {
      ...channelFixture.protocolRegistry,
      'fixture-relay-video': {
        category: 'video', requestType: 'json-video', submitPath: '/relay/videos', pollPath: '/relay/videos/{taskId}',
        referenceImageMode: 'url', referenceImageAsArray: true, referenceImageItemShape: 'image_url_object',
        fieldMapping: { referenceImage: 'references' },
      },
      'fixture-official-video': {
        category: 'video', requestType: 'json-video', submitPath: '/official/videos', pollPath: '/official/videos/{taskId}',
        referenceImageMode: 'url', referenceImageAsArray: false,
        fieldMapping: { referenceImage: 'first_frame_image' },
      },
    },
  };
  for (const selected of ['relay', 'official']) {
    const editedReferenceUrl = 'data:image/png;base64,ZWRpdGVk';
    const channel = await runCase({
      ...connectedReferenceChannels,
      selectedApiConfigId: selected,
      mediaKind: 'image',
      connectedImageUrl: editedReferenceUrl,
      staleOriginalImageUrl: 'data:image/png;base64,b3JpZ2luYWw=',
      uploadedReferenceUrl: 'https://fixture.invalid/uploaded-edited-reference',
    });
    assert.equal(channel.node.data.errorMessage, undefined, channel.node.data.errorMessage);
    assert.equal(channel.uploadCalls, 1, 'the single connected image is normalized exactly once');
    assert.deepEqual(channel.uploadedReferenceSources, [editedReferenceUrl], 'an edited connected image wins over its stale original asset binding');
    const submission = channel.requests.find((request) => request.init.method === 'POST');
    assert.equal(submission.url, `https://fixture-${selected}.invalid/${selected}/videos`);
    const body = JSON.parse(submission.init.body);
    if (selected === 'relay') {
      assert.deepEqual(body.references, [{ image_url: 'https://fixture.invalid/uploaded-edited-reference' }]);
      assert.equal(Object.hasOwn(body, 'first_frame_image'), false);
    } else {
      assert.equal(body.first_frame_image, 'https://fixture.invalid/uploaded-edited-reference');
      assert.equal(Object.hasOwn(body, 'references'), false);
    }
    assert.equal(channel.requests.at(-1).url, `https://fixture-${selected}.invalid/${selected}/videos/fixture-task`);
    assert.equal(channel.node.data.videoUrl, 'https://fixture.invalid/result.mp4');
    assert.equal(channel.stored.nodes[0].data.videoUrl, channel.node.data.videoUrl);
  }

  const prefixed = await runCase({ apiUrl: 'https://fixture.invalid/v1' });
  assert.equal(prefixed.requests.find((request) => request.init.method === 'POST').url, 'https://fixture.invalid/v1/videos');
  assert.equal(prefixed.requests.at(-1).url, 'https://fixture.invalid/v1/videos/fixture-task');
  assert.equal(prefixed.node.data.videoUrl, 'https://fixture.invalid/result.mp4');

  const unknown = await runCase({ model: 'unknown-video-fixture', profileName: '', previousResult: true });
  assert.equal(unknown.requests.length, 0, 'unbound video must not submit a guessed protocol');
  assert.equal(unknown.uploadCalls, 0);
  assert.equal(unknown.node.data.videoUrl, 'https://fixture.invalid/previous-result.mp4', 'preflight must preserve the old result');
  assert.ok(unknown.notices.some((text) => text.includes('尚未选择视频请求协议')));

  const seedance25 = await runCase({
    model: 'doubao-seedance-2-5-260628', profileName: '',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3', duration: '20',
    pollPayloads: [{ status: 'succeeded', content: { video_url: 'https://fixture.invalid/result.mp4' } }],
  });
  assert.equal(seedance25.node.data.errorMessage, undefined, seedance25.node.data.errorMessage);
  const arkSubmit = seedance25.requests.find((request) => request.init.method === 'POST');
  assert.equal(arkSubmit.url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  const arkBody = JSON.parse(arkSubmit.init.body);
  assert.equal(arkBody.model, 'doubao-seedance-2-5-260628');
  assert.equal(arkBody.duration, 20);
  assert.equal(Object.hasOwn(arkBody, 'prompt'), false);
  assert.ok(arkBody.content.some((part) => part.type === 'text'));
  assert.equal(seedance25.requests.at(-1).url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/fixture-task');
  assert.equal(seedance25.node.data.videoUrl, 'https://fixture.invalid/result.mp4');
  for(const terminalStatus of ['failed','cancelled']){
    const terminal=await runCase({model:'doubao-seedance-2-5-260628',profileName:'',apiUrl:'https://ark.cn-beijing.volces.com/api/v3',duration:'20',pollPayloads:[{status:terminalStatus,content:{video_url:'https://fixture.invalid/stale.mp4'}}]});
    assert.equal(terminal.tasks[0].status,terminalStatus);assert.notEqual(terminal.node.data.videoUrl,'https://fixture.invalid/stale.mp4');assert.equal(terminal.generatedAssets.length,0);assert.equal(terminal.requests.length,2);
  }
  for(const terminalStatus of ['failed','cancelled','cancel']){
    const terminal=await runCase({nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,pollPayloads:[{code:200,status:terminalStatus,video_url:'https://fixture.invalid/stale.mp4',message:'PRIVATE_TIANJI_ERROR'}]});
    assert.equal(terminal.tasks.length,1,'Tianji terminal result does not add a duplicate local failure');assert.equal(terminal.tasks[0].status,terminalStatus==='failed'?'failed':'cancelled');assert.notEqual(terminal.node.data.videoUrl,'https://fixture.invalid/stale.mp4');assert.equal(terminal.generatedAssets.length,0);assert.equal(terminal.requests.length,2);assert.doesNotMatch(JSON.stringify({task:terminal.tasks[0].errorMsg,node:terminal.node.data.errorMessage,notices:terminal.notices}),/PRIVATE_TIANJI_ERROR/);
    assert.equal(terminal.stored.nodes[0].data.loading,false,'terminal status is persisted for the matching node');
  }
  const tianjiStopped=await runCase({nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,tianjiStaleStop:true,pollPayloads:[{code:200,status:'failed',message:'PRIVATE_TIANJI_ERROR'}]});
  assert.equal(tianjiStopped.tasks.length,1);assert.equal(tianjiStopped.tasks[0].stoppedByUser,true);assert.equal(tianjiStopped.tasks[0].errorMsg,'已取消');assert.equal(tianjiStopped.node.data.errorMessage,'已取消');assert.equal(tianjiStopped.stored.nodes[0].data.errorMessage,'已取消');
  const tianjiRebound=await runCase({nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,tianjiReboundNode:true,pollPayloads:[{code:200,status:'failed'}]});
  assert.equal(tianjiRebound.node.data.seedanceTaskId,'new-task');assert.equal(tianjiRebound.node.data.loading,true);assert.equal(tianjiRebound.stored.nodes[0].data.loading,true);
  for(const terminalStatus of ['failed','cancelled']){
    const terminal=await runCase({nodeType:'tongyiWanxiangNode',model:'wan-fixture',profileName:'',pollPayloads:[{status:terminalStatus,video_url:'https://fixture.invalid/stale.mp4'}]});
    assert.equal(terminal.tasks[0].status,terminalStatus);assert.notEqual(terminal.node.data.videoUrl,'https://fixture.invalid/stale.mp4');assert.equal(terminal.generatedAssets.length,0);assert.equal(terminal.requests.length,2);
  }
  for(const terminalStatus of ['failed','cancelled']){
    const terminal=await runCase({model:'multipart-fixture',profileName:'fixture-multipart',profile:{category:'video',requestType:'multipart-video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',fieldMapping:{model:'model',prompt:'prompt'},__wanjuanPreferExplicitProtocol:true},pollPayloads:[{status:terminalStatus,video_url:'https://fixture.invalid/stale.mp4'}]});
    assert.equal(terminal.tasks[0].status,terminalStatus);assert.notEqual(terminal.node.data.videoUrl,'https://fixture.invalid/stale.mp4');assert.equal(terminal.generatedAssets.length,0);assert.equal(terminal.requests.length,2);
  }

  const invalidSeedance25 = await runCase({
    model: 'doubao-seedance-2-5-260628', profileName: '',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3', duration: '31', previousResult: true,
  });
  assert.equal(invalidSeedance25.requests.length, 0);
  assert.equal(invalidSeedance25.uploadCalls, 0);
  assert.equal(invalidSeedance25.node.data.videoUrl, 'https://fixture.invalid/previous-result.mp4');
  assert.ok(invalidSeedance25.notices.some((text) => text.includes('视频时长须为')));

  const legacyFile = await runCase({
    model: 'MiniMax-Hailuo-2.3',
    profileName: '',
    apiUrl: 'https://fixture.xpclaw.ai',
    resolution: '1280x720',
    duration: '6',
    pollPayloads: [{ status: 'completed', file_id: 'fixture-file' }],
  });
  assert.equal(legacyFile.node.data.errorMessage, undefined, legacyFile.node.data.errorMessage);
  assert.equal(legacyFile.node.data.videoUrl, 'https://fixture.invalid/legacy-file-result.mp4');
  assert.equal(legacyFile.requests.filter((request) => request.url.includes('/v1/files/retrieve')).length, 1);

  const {describeApplicationGeneration}=require('../src/renderer/lib/application-generation.ts');
  const reviewCases=[
    {model:'sora-2',profile:{requestType:'multipart-video'}},
    {model:'sora-2',profile:{requestType:'multipart-video',resolutionValueMode:'dimension',fieldMapping:{prompt:'input_prompt',duration:'duration'}}},
    {model:'fixture-json',profile:{requestType:'json-video',resolutionValueMode:'quality',resolutionValueMap:{'720P':'HD'},resolutionValueCase:'lower',fieldValueTypes:{seconds:'string'}}},
    {model:'fixture-json',profile:{requestType:'json-video',extraBody:{model:'provider-alias',prompt:'ACTUAL_PROMPT',n:2}}},
    {model:'fixture-json',profile:{requestType:'json-video',omitDuration:true}},
    {model:'grok-video-3',profile:{requestType:'json-video'}},
    {model:'grok-imagine-video',profile:{requestType:'json-video'}},
    {model:'veo-portrait',profile:{requestType:'json-video',__wanjuanPreferExplicitProtocol:true}},
  ];
  for(const row of reviewCases){
    const profile={category:'video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',...row.profile},model=row.model;
    const args={prompt:'QA_PARITY',model,resolution:'1280x720',duration:5,aspectRatio:'16:9'};
    const configuration={models:[model],apiConfigs:[],url:'https://fixture.invalid',key:'QA_SYNTHETIC_KEY',protocolBindings:{[model]:'qa-review'},registry:{'qa-review':profile},probe:{id:'probe',type:'videoNode',data:{videoModel:model,videoDurations:'5 6 8 10 15',videoModelProtocolBindings:{[model]:'qa-review'},modelProtocolRegistry:{'qa-review':profile}}}};
    const preview=describeApplicationGeneration('video',args,configuration).requestPreview;
    assert(preview,'generic video must expose its actual wire-field review');
    const actual=await runCase({...row,profile,profileName:'qa-review',prompt:args.prompt,resolution:args.resolution,duration:args.duration,ratio:args.aspectRatio});
    assert.equal(actual.node.data.errorMessage,undefined,actual.node.data.errorMessage);
    const first=actual.requests[0];assert(first&&first.init.method==='POST');
    if(typeof first.init.body==='string')assert.deepEqual(Object.fromEntries(preview.fields.map(f=>[f.name,f.value])),JSON.parse(first.init.body),'JSON review must match the normal sender after overrides');
    else assert.deepEqual(preview.fields.map(f=>[f.name,f.value]),[...first.init.body.entries()],'multipart review must match every sent field and order');
    assert.equal(preview.hiddenFields,0);assert.equal(actual.uploadCalls,0);
  }
  console.log('H3 actual generation hook: existing lifecycle/media compatibility plus eight actual sender/paid-review wire-parity cases PASS');
}
module.exports = { runCase };
if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
