import {normalizeVideoAspectRatioValue,normalizeVideoSizeValue} from './video-aspect-ratio';

/** Existing provider overrides, shared by the normal sender and paid review. */
export function normalizeVideoRequestProfile(input:any,modelConfig:any={}) {
                let requestProfile = input && typeof input == `object` ? {
                    ...input
                  } : {},
                  modelName3 = String(modelConfig.modelName || ``).trim().toLowerCase(),
                  apiUrl = String(modelConfig.apiUrl || ``).trim().toLowerCase(),
                  requestType2 = String(requestProfile.requestType || ``).trim().toLowerCase();
                return (
                  requestProfile.fieldValueTypes &&
                  typeof requestProfile.fieldValueTypes == `object` &&
                  (requestProfile.fieldValueTypes = {
                    ...requestProfile.fieldValueTypes
                  }),
                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
                  modelConfig.category === `video` &&
                  (requestType2 === `openai-video` || requestType2 === `json-video`) &&
                  (/^wan/i.test(modelName3) || /aigc\.x-see\.cn|x-see\.cn/.test(apiUrl)) &&
                  (requestProfile.fieldValueTypes = {
                    ...(requestProfile.fieldValueTypes || {}),
                    seconds: `string`,
                    duration: `string`,
                  }),
                  requestType2 === `openai-video` &&
                  !requestProfile.submitPath &&
                  !/(^|\.)lconai\.com|\/\/[nsv]\.lconai\.com/i.test(apiUrl) &&
                  ((requestProfile.submitPath = `/v1/videos`),
                    (requestProfile.pollPath = requestProfile.pollPath || `/v1/videos/{taskId}`),
                    requestProfile.contentPath === undefined &&
                    (requestProfile.contentPath = `/v1/videos/{taskId}/content`)),
                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
                  modelConfig.category === `video` &&
                  /^veo/i.test(String(modelConfig.modelName || ``)) &&
                  /aigc\.x-see\.cn|x-see\.cn/i.test(apiUrl) &&
                  /(?:^|[-_])(portrait|landscape|fl|frame|reverse|gif|hd|4k|pro)(?:[-_]|$)/i.test(String(modelConfig.modelName || ``)) &&
                  ((requestProfile.requestType = `multipart-video`),
                    (requestProfile.submitPath = `/v1/videos`),
                    (requestProfile.pollPath = `/v1/videos/{taskId}`),
	                    delete requestProfile.contentPath,
	                    delete requestProfile.referenceImageMode,
	                    delete requestProfile.referenceImageAsArray,
	                    delete requestProfile.referenceImageItemShape,
	                    (requestProfile.requiresReferenceImage = true),
                    (requestProfile.omitDuration = true),
                    (requestProfile.fieldMapping = {
                      ...(requestProfile.fieldMapping || {}),
                      prompt: `prompt`,
                      resolution: `size`,
                      duration: ``,
                      referenceImage: `input_reference`,
                      aspectRatio: ``,
                    }),
                    (requestProfile.fieldValueTypes = {
                      ...(requestProfile.fieldValueTypes || {}),
                      size: `string`,
                    })),
                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
                  modelConfig.category === `video` &&
                  /^veo/i.test(String(modelConfig.modelName || ``)) &&
                  /(^|\.)lconai\.com|\/\/[nsv]\.lconai\.com/i.test(apiUrl) &&
	                  ((requestProfile.requestType = `multipart-video`),
	                    (requestProfile.submitPath = `/v1/videos`),
	                    (requestProfile.pollPath = `/v1/videos/{taskId}`),
	                    delete requestProfile.contentPath,
	                    (requestProfile.fieldMapping = {
	                      ...(requestProfile.fieldMapping || {}),
	                      prompt: `prompt`,
	                      resolution: `size`,
	                      duration: `seconds`,
	                      referenceImage: `input_reference`,
	                      aspectRatio: ``,
	                    }),
	                    (requestProfile.fieldValueTypes = {
	                      ...(requestProfile.fieldValueTypes || {}),
	                      size: `string`,
	                      seconds: `number`,
	                    })),
		                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
		                  modelConfig.category === `video` &&
		                  /^grok-(?:video|imagine)/i.test(String(modelConfig.modelName || ``)) &&
	                  (/^https?:\/\/jixing\.guancn\.uk/i.test(apiUrl) ||
		                    /(^|\.)lconai\.com|\/\/[nsv]\.lconai\.com/i.test(apiUrl)) &&
		                  ((requestProfile.requestType = `multipart-video`),
	          (requestProfile.submitPath = `/v1/videos`),
	          (requestProfile.pollPath = `/v1/videos/{taskId}`),
	          delete requestProfile.contentPath,
	          delete requestProfile.referenceImageMode,
	          delete requestProfile.referenceImageAsArray,
	          delete requestProfile.referenceImageItemShape,
                    (requestProfile.fieldMapping = {
                      ...(requestProfile.fieldMapping || {}),
                      prompt: `prompt`,
                      resolution: `size`,
                      duration: `seconds`,
                      referenceImage: `input_reference`,
                      aspectRatio: ``,
                    }),
                    (requestProfile.fieldValueTypes = {
                      ...(requestProfile.fieldValueTypes || {}),
                      size: `string`,
                      seconds: `number`,
                    })),
                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
                  modelConfig.category === `video` &&
                  /^grok-imagine-video$/i.test(String(modelConfig.modelName || ``)) &&
                  ((requestProfile.requestType = `openai-video`),
                    (requestProfile.submitPath = `/v1/videos`),
                    (requestProfile.pollPath = `/v1/videos/{taskId}`),
                    (requestProfile.referenceImageMode = `url`),
                    (requestProfile.referenceImageAsArray = true),
                    (requestProfile.referenceImageItemShape = `image_url_object`),
                    (requestProfile.fieldMapping = {
                      ...(requestProfile.fieldMapping || {}),
                      resolution: `size`,
                      duration: `seconds`,
                      referenceImage: `input_references`,
                      aspectRatio: ``,
                    }),
                    (requestProfile.extraBody = {
                      ...(requestProfile.extraBody || {}),
                      quality: `standard`,
                    }),
                    (requestProfile.fieldValueTypes = {
                      ...(requestProfile.fieldValueTypes || {}),
                      size: `string`,
                      seconds: `string`,
                    })),
                  requestProfile.__wanjuanPreferExplicitProtocol !== true &&
                  modelConfig.category === `video` &&
                  modelName3 === `grok-video-3` &&
                  /api\.vectorengine\.ai/i.test(apiUrl) &&
                  ((requestProfile.requestType = `json-video`),
                    (requestProfile.submitPath = `/v1/video/create`),
                    (requestProfile.pollPath = `/v1/video/query?id={taskId}`),
                    (requestProfile.omitDuration = true),
                    (requestProfile.requiresReferenceImage = true),
                    (requestProfile.referenceImageMode = `url`),
                    (requestProfile.referenceImageAsArray = true),
                    (requestProfile.fieldMapping = {
                      ...(requestProfile.fieldMapping || {}),
                      resolution: `size`,
                      aspectRatio: `aspect_ratio`,
                      referenceImage: `images`,
                    }),
                    (requestProfile.fieldValueTypes = {
                      ...(requestProfile.fieldValueTypes || {}),
                      size: `string`,
                      aspect_ratio: `string`,
                    })),
                  requestProfile
                );
}

/** Existing value conversions only: no nodes, credentials, files or network. */
export function createVideoParameterContext({profile,modelName,baseUrl,resolution,duration,videoDurations,aspectRatio:ratio,nodeAspectRatio}:{profile:any;modelName:string;baseUrl:string;resolution:any;duration?:any;videoDurations?:any;aspectRatio?:any;nodeAspectRatio?:any}) {
 const effectiveVideoRequestProfile=profile,aspectRatioOverride=ratio,seedanceSourceNode={data:{selectedAspectRatio:nodeAspectRatio}};
 const selectedVideoSizeValue=String(resolution||'1280x720').trim()||'1280x720',normalizedVideoSize=normalizeVideoSizeValue(selectedVideoSizeValue);
 const isLconaiVideoApi=/(^|\.)lconai\.com|\/\/[nsv]\.lconai\.com/i.test(String(baseUrl||''));
 const isVectorEngineGrokVideo3=/^grok-video-3$/i.test(String(modelName||''))&&/api\.vectorengine\.ai/i.test(String(baseUrl||''));
 const modelUsesDimensionSize=isLconaiVideoApi||(/\bgrok[-_]?videos\b/i.test(String(modelName||''))&&!isVectorEngineGrokVideo3);
 let getFieldValue = (fieldName, value) => {
                let fieldName2 = String(fieldName || ``).trim(),
                  valueType =
                  effectiveVideoRequestProfile?.fieldValueTypes &&
                  typeof effectiveVideoRequestProfile.fieldValueTypes == `object` &&
                  effectiveVideoRequestProfile.fieldValueTypes[fieldName2] ?
                  String(effectiveVideoRequestProfile.fieldValueTypes[fieldName2]).trim().toLowerCase() :
                  ``;
                return valueType === `string` ?
                  String(value ?? ``) :
                  valueType === `number` ?
                  Number(value) :
                  value;
              },
              videoSizeValue = ((sizeValue) => {
                let resolutionMatch = String(selectedVideoSizeValue || ``).trim().match(/^(\d{3,4})\s*p$/i);
                if (resolutionMatch) return `${resolutionMatch[1]}P`;
                if (!sizeValue) return `720P`;
                let [width, height] = String(sizeValue)
                  .split(`x`)
                  .map((part) => parseInt(part, 10));
                return !isNaN(width) && !isNaN(height) && Math.max(width, height) >= 1920 ?
                  `1080P` :
                  `720P`;
              })(normalizedVideoSize),
              aspectRatio = normalizeVideoAspectRatioValue(
                aspectRatioOverride ||
                seedanceSourceNode?.data?.selectedAspectRatio ||
                ``,
                normalizedVideoSize,
              ),
              requestAspectRatioValue = ((aspectRatioValue, sizeValue) => {
                if (!isVectorEngineGrokVideo3) return aspectRatioValue;
                if ([`2:3`, `3:2`, `1:1`].includes(aspectRatioValue)) return aspectRatioValue;
                let ratioMatch =
                  String(aspectRatioValue || ``).match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/) ||
                  String(sizeValue || ``).match(/^(\d+)\s*x\s*(\d+)$/i),
                  ratio = ratioMatch ? Number(ratioMatch[1]) / Number(ratioMatch[2]) : 1;
                return ratio > 1.05 ? `3:2` : ratio < 0.95 ? `2:3` : `1:1`;
              })(aspectRatio, normalizedVideoSize),
              videoParameterAdapter =
              effectiveVideoRequestProfile?.parameterAdapter &&
              typeof effectiveVideoRequestProfile.parameterAdapter == `object` ?
              effectiveVideoRequestProfile.parameterAdapter :
              {},
              mapVideoProtocolParameterValue = (key, mapping = {}) => {
                let key2 = String(key || ``).trim(),
                  mapping2 = mapping && typeof mapping == `object` ? mapping : {};
                return Object.prototype.hasOwnProperty.call(mapping2, key2) ? mapping2[key2] : key2;
              },
              applyVideoProtocolParameterCase = (value, caseMode) => {
                let value2 = String(value || ``);
                return caseMode === `lower` ?
                  value2.toLowerCase() :
                  caseMode === `upper` ?
                  value2.toUpperCase() :
                  value2;
              },
              getVideoResolutionAdapterValue = (resolutionValue) => {
                let resolutionMode = String(
                  effectiveVideoRequestProfile?.resolutionValueMode ||
                  videoParameterAdapter.resolutionValueMode ||
                  ``,
                ).trim().toLowerCase();
                return resolutionMode === `none` || resolutionMode === `omit` ?
                  `` :
                  resolutionMode === `dimension` || resolutionMode === `dimensions` || resolutionMode === `width-height` ?
                  normalizedVideoSize :
                  resolutionMode === `quality` || resolutionMode === `quality-preset` || resolutionMode === `preset` ?
                  applyVideoProtocolParameterCase(
                    mapVideoProtocolParameterValue(
                      videoSizeValue,
                      effectiveVideoRequestProfile?.resolutionValueMap ||
                      videoParameterAdapter.resolutionValueMap,
                    ),
                    effectiveVideoRequestProfile?.resolutionValueCase ||
                    videoParameterAdapter.resolutionValueCase,
                  ) :
                  resolutionMode === `aspect-ratio` || resolutionMode === `ratio` ?
                  requestAspectRatioValue :
                  resolutionMode === `aspect-ratio-x` || resolutionMode === `ratio-x` ?
                  String(requestAspectRatioValue || ``).replace(`:`, `x`) :
                  resolutionValue;
              },
              getVideoAspectRatioAdapterValue = () => {
                let aspectRatioMode = String(
                  effectiveVideoRequestProfile?.aspectRatioValueMode ||
                  videoParameterAdapter.aspectRatioValueMode ||
                  ``,
                ).trim().toLowerCase();
                return aspectRatioMode === `none` || aspectRatioMode === `omit` ?
                  `` :
                  aspectRatioMode === `dimension` || aspectRatioMode === `dimensions` || aspectRatioMode === `width-height` ?
                  normalizedVideoSize :
                  aspectRatioMode === `quality` || aspectRatioMode === `quality-preset` || aspectRatioMode === `preset` ?
                  videoSizeValue :
                  aspectRatioMode === `aspect-ratio-x` || aspectRatioMode === `ratio-x` ?
                  String(requestAspectRatioValue || ``).replace(`:`, `x`) :
                  applyVideoProtocolParameterCase(
                    mapVideoProtocolParameterValue(
                      requestAspectRatioValue,
                      effectiveVideoRequestProfile?.aspectRatioValueMap ||
                      videoParameterAdapter.aspectRatioValueMap,
                    ),
                    effectiveVideoRequestProfile?.aspectRatioValueCase ||
                    videoParameterAdapter.aspectRatioValueCase,
                  );
              },
	              durationValue =
	              duration ||
	              (videoDurations || `10`)
	              .split(
	                `
		`,
	              )[0]
	              .trim();
	            const normalizeGrokVideoDuration = (model, value) => {
	              let modelText = String(model || ``).trim().toLowerCase();
	              if (!/^grok-(?:video|imagine)/i.test(modelText)) return value;
	              if (modelText === `grok-video-3`) return `6`;
	              if (modelText === `grok-video-3-pro`) return `10`;
	              if (modelText === `grok-video-3-max`) {
	                let numericValue = Number(value);
	                return Number.isFinite(numericValue) && numericValue > 0 ?
	                  String(Math.round(numericValue)) :
	                  `10`;
	              }
	              if (/grok-imagine-video-1\.5-preview/i.test(modelText)) return `15`;
	              let numericValue = Number(value);
	              return Number.isFinite(numericValue) && numericValue > 0 ?
	                String(Math.round(numericValue)) :
	                value;
	            };
	            durationValue = normalizeGrokVideoDuration(modelName, durationValue);
 return {getFieldValue,videoSizeValue,aspectRatio,requestAspectRatioValue,getVideoResolutionAdapterValue,getVideoAspectRatioAdapterValue,durationValue,normalizedVideoSize,modelUsesDimensionSize,isLconaiVideoApi,isVectorEngineGrokVideo3};
}
