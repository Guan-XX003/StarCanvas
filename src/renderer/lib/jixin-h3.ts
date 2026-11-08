/**
 * Jixin's supplier alias for MiniMax H3.
 *
 * This is the supplier-documented OpenAI-style task contract, not MiniMax's
 * native `/v2/video_generation` API. Production New API currently accepts the
 * text-only JSON shape, while role-bearing media input is not yet compatible
 * with its `images: string[]` decoder. Keep media-conditioned requests blocked
 * before any upload or submit until the relay adapter is deployed and verified.
 */
export const JIXIN_H3_MODEL = `MiniMax-H3-720p`;
export const JIXIN_H3_PROTOCOL_NAME = `极鑫 H3 视频兼容`;
export const JIXIN_H3_RESOLUTION = `720p`;
export const JIXIN_H3_DURATIONS = Array.from({ length: 12 }, (_, index) => String(index + 4));
export const JIXIN_H3_ASPECT_RATIOS = [`16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`];
export const JIXIN_H3_MEDIA_BLOCKED_REASON = `H3 当前仅开放文生视频；参考图、首尾帧、参考视频和音频尚未部署兼容适配，请移除参考素材后重试`;
export const JIXIN_H3_BILLING_BLOCKED_REASON = `H3 请求格式已适配，但服务器计费仍待确认；为避免按错误时长扣费，暂不可生成`;

export const JIXIN_H3_PROTOCOL = {
  blockedReason: JIXIN_H3_BILLING_BLOCKED_REASON,
  blockedLabel: `计费待确认`,
  category: `video`,
  requestType: `json-video`,
  submitPath: `/v1/videos`,
  pollPath: `/v1/videos/{taskId}`,
  contentType: `application/json`,
  fieldMapping: {
    model: `model`,
    prompt: `prompt`,
    duration: `duration`,
    resolution: `resolution`,
    aspectRatio: `ratio`,
    referenceImage: ``,
    referenceVideo: ``,
    referenceAudio: ``,
  },
  fieldValueTypes: {
    duration: `number`,
    resolution: `string`,
    ratio: `string`,
  },
  parameterMode: `ratio-quality`,
  parameterModeLocked: true,
  parameterOptions: {
    qualities: [JIXIN_H3_RESOLUTION],
    durations: JIXIN_H3_DURATIONS,
    aspectRatios: JIXIN_H3_ASPECT_RATIOS,
  },
  parameterAdapter: {
    resolutionValueMode: `quality`,
    resolutionValueCase: `lower`,
    aspectRatioValueMode: `ratio`,
  },
  mediaConditioningSupported: false,
  mediaBlockedReason: JIXIN_H3_MEDIA_BLOCKED_REASON,
  responseMapping: {
    taskId: [`id`, `task_id`, `taskId`, `data.id`, `data.task_id`],
    status: [`status`, `data.status`],
    video: [`video_url`, `url`, `data.video_url`, `data.url`, `data.result_url`],
    completedValues: [`completed`, `success`, `succeeded`],
    failedValues: [`failed`, `failure`, `error`, `cancelled`, `canceled`, `expired`],
  },
  validationNotes: [
    `仅文生视频已通过无费用 Mock 契约验证；生产仍无成功调用样本。`,
    `媒体参考在 New API 兼容适配部署前客户端零网络拦截。`,
  ],
};

export function validateJixinH3Input(profileName: string, input: {
  prompt?: unknown;
  duration?: unknown;
  seconds?: unknown;
  resolution?: unknown;
  ratio?: unknown;
  imageCount?: number;
  videoCount?: number;
  audioCount?: number;
}) {
  // Only the built-in profile is constrained; explicitly named custom
  // protocols remain independent even when they target the same model alias.
  if (profileName !== JIXIN_H3_PROTOCOL_NAME) return;
  if (Number(input.imageCount || 0) || Number(input.videoCount || 0) || Number(input.audioCount || 0))
    throw new Error(JIXIN_H3_MEDIA_BLOCKED_REASON);
  if (!String(input.prompt || ``).trim())
    throw new Error(`H3 文生视频需要非空提示词`);
  const duration = Number(input.duration ?? input.seconds);
  if (!Number.isSafeInteger(duration) || duration < 4 || duration > 15)
    throw new Error(`H3 时长必须是 4–15 秒的整数`);
  if (String(input.resolution || ``).trim().toLowerCase() !== JIXIN_H3_RESOLUTION)
    throw new Error(`H3 当前固定为 720p 分辨率`);
  const ratio = String(input.ratio || ``).trim();
  if (!JIXIN_H3_ASPECT_RATIOS.includes(ratio))
    throw new Error(`H3 画幅比例无效，请在节点中重新选择支持的比例`);
}
