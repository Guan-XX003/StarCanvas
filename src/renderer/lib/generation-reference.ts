export interface WanjuanOpenAiImageReferencePlanOptions {
  requestProtocol?: string;
  referenceCount?: number;
  modelName?: string;
  isLconaiDoubaoImage?: boolean;
  vectorengineOpenAiCompatRequest?: boolean;
  editPath?: string;
  editSubmitPath?: string;
  referenceImageField?: string;
}

/**
 * Decide whether an OpenAI-images compatible request with references must use
 * the multipart edits route. Explicit protocol capability wins over model-name
 * inference so configured compatible models do not silently drop references.
 */
export const wanjuanBuildOpenAiImageReferencePlan = (
  options: WanjuanOpenAiImageReferencePlanOptions = {},
) => {
  const requestProtocol = String(options.requestProtocol || ``).trim();
  const referenceCount = Math.max(0, Number(options.referenceCount || 0));
  const modelName = String(options.modelName || ``).trim();
  const editPath = String(options.editPath || options.editSubmitPath || ``).trim();
  const referenceImageField = String(options.referenceImageField || ``).trim();
  const hasExplicitEditCapability = Boolean(editPath && referenceImageField);
  const useEdit = Boolean(
    requestProtocol === `openai-images` &&
    referenceCount > 0 &&
    options.vectorengineOpenAiCompatRequest !== true &&
    (/^gpt-image/i.test(modelName) || options.isLconaiDoubaoImage === true || hasExplicitEditCapability)
  );
  return {
    useEdit,
    editPath,
    referenceImageField,
    hasExplicitEditCapability,
  };
};

export const wanjuanAppendConnectedImageReferences = (
  images: any[] = [],
  append: (value: any, meta?: Record<string, any>) => void,
  meta: Record<string, any> = {},
) => {
  let appendedCount = 0;
  for (const image of Array.isArray(images) ? images : []) {
    if (!image) continue;
    append(image, meta);
    appendedCount++;
  }
  return appendedCount;
};

export const wanjuanAppendImageReferenceFiles = async (
  formData: FormData,
  references: string[] = [],
  options: {
    fieldTemplate?: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
) => {
  const fieldTemplate = String(options.fieldTemplate || `image`).trim() || `image`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let appendedCount = 0;
  for (let index = 0; index < references.length; index++) {
    const referenceImage = String(references[index] || ``).trim();
    if (!referenceImage) continue;
    let blob: Blob | null = null;
    let extension = `png`;
    let mimeType = `image/png`;
    const dataUrlMatch = referenceImage.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      extension = mimeType === `image/jpeg` ? `jpg` : mimeType === `image/webp` ? `webp` : `png`;
      const bytes = Uint8Array.from(atob(dataUrlMatch[2]), (character) => character.charCodeAt(0));
      blob = new Blob([bytes], { type: mimeType });
    } else if (/^https?:\/\//i.test(referenceImage) && fetchImpl) {
      const response = await fetchImpl(referenceImage, { signal: options.signal });
      if (!response.ok) throw new Error(`参考图读取失败（HTTP ${response.status}）`);
      const fetchedBlob = await response.blob();
      if (fetchedBlob.size > 0) {
        blob = fetchedBlob;
        mimeType = fetchedBlob.type || mimeType;
        extension = mimeType === `image/jpeg` ? `jpg` : mimeType === `image/webp` ? `webp` : `png`;
      }
    }
    if (!blob) throw new Error(`参考图无法转换为接口支持的图片文件`);
    formData.append(
      fieldTemplate.replace(/\{index\}/g, String(index)),
      blob,
      `reference_${index + 1}.${extension}`,
    );
    appendedCount++;
  }
  return appendedCount;
};
