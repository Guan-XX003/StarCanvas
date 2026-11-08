import { wanjuanBuildProjectAssetBinding } from "./project-asset-binding";
import { buildProjectMediaFileUrl, wanjuanClearProjectAssetBindingsFromData } from "./resource";
import { wanjuanNextTianjiPortraitBindingRevision } from "./tianji-portrait";

const imageMimeFromUrl = (value: any) => {
  const path = String(value || ``).split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith(`.jpg`) || path.endsWith(`.jpeg`)) return `image/jpeg`;
  if (path.endsWith(`.webp`)) return `image/webp`;
  if (path.endsWith(`.gif`)) return `image/gif`;
  if (path.endsWith(`.avif`)) return `image/avif`;
  return `image/png`;
};

const responseHeader = (headers: any, name: string) => {
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    const pair = headers.find((item) => Array.isArray(item) && String(item[0] || ``).toLowerCase() === target);
    return String(pair?.[1] || ``).trim();
  }
  if (headers && typeof headers === `object`) {
    const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
    return String(key ? headers[key] : ``).trim();
  }
  return ``;
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ``));
    reader.onerror = () => reject(reader.error || new Error(`图片读取失败`));
    reader.readAsDataURL(blob);
  });

export function wanjuanImageEditorSourceFromNodeData(data: any) {
  const currentUrl = String(data?.imageUrl || ``).trim();
  const binding = data?.projectAssetBindings?.imageUrl;
  const localPath = String(binding?.localPath || ``).trim();
  const sourceSignature = String(binding?.sourceSignature || ``).trim();
  const bindingMatchesCurrent = !sourceSignature || sourceSignature === currentUrl;
  return localPath && binding?.ok !== false && binding?.missing !== true && bindingMatchesCurrent
    ? buildProjectMediaFileUrl(localPath)
    : currentUrl;
}

export function wanjuanClearEditedImageReviewIdentity(data: any) {
  return {
    ...(data || {}),
    arkTrustedAssetId: undefined,
    arkTrustedAssetGroupId: undefined,
    arkTrustedAssetContentHash: undefined,
    arkTrustedAssetSourceUrl: undefined,
    arkTrustedAssetStatus: undefined,
    arkTrustedAssetMessage: undefined,
    arkTrustedAssetReviewedAt: undefined,
    tianjiPortraitAssetId: undefined,
    tianjiPortraitGroupType: undefined,
    tianjiPortraitPreviewUrl: undefined,
    tianjiPortraitLocalPreviewUrl: undefined,
    tianjiPortraitBindingLookupUrl: undefined,
    tianjiPortraitBindingName: undefined,
    tianjiPortraitBindingSourceUrl: undefined,
    tianjiPortraitSourceId: undefined,
    tianjiPortraitBindingStatus: undefined,
    tianjiPortraitBindingMessage: undefined,
    tianjiPortraitReviewedAt: undefined,
    tianjiPortraitBoundAt: undefined,
    tianjiPortraitBindingRevision: wanjuanNextTianjiPortraitBindingRevision(data),
    isTianjiPortrait: false,
    sourceOrigin: data?.sourceOrigin === `tianji-portrait` ? `generated` : data?.sourceOrigin,
  };
}

/** Resolve remote/local images to an origin-safe data URL before drawing them on canvas. */
export async function wanjuanPrepareImageEditorSource(
  imageUrl: any,
  desktop: any = typeof window !== `undefined` ? window.wanjuanDesktop : undefined,
  fetcher: typeof fetch | undefined = typeof fetch === `function` ? fetch.bind(globalThis) : undefined,
) {
  const sourceUrl = String(imageUrl || ``).trim();
  if (!sourceUrl) throw new Error(`没有可编辑的图片`);
  if (/^data:image\//i.test(sourceUrl)) return sourceUrl;

  if (/^file:/i.test(sourceUrl) && typeof desktop?.readLocalFileAsDataUrl === `function`) {
    const local = await desktop.readLocalFileAsDataUrl({ url: sourceUrl });
    if (local?.ok && /^data:image\//i.test(String(local.dataUrl || ``))) return local.dataUrl;
    throw new Error(local?.error || `本地图片读取失败`);
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(sourceUrl) && typeof desktop?.readLocalFileAsDataUrl === `function`) {
    const local = await desktop.readLocalFileAsDataUrl({ localPath: sourceUrl });
    if (local?.ok && /^data:image\//i.test(String(local.dataUrl || ``))) return local.dataUrl;
    throw new Error(local?.error || `本地图片读取失败`);
  }

  if (/^https?:/i.test(sourceUrl) && typeof desktop?.proxyFetch === `function`) {
    const result = await desktop.proxyFetch({
      requestId: `image-editor-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      url: sourceUrl,
      method: `GET`,
      headers: { Accept: `image/*` },
      bodyBase64: ``,
    });
    const status = Number(result?.status || 0);
    if (result?.ok !== false && status >= 200 && status < 300 && result?.bodyBase64) {
      const declaredMime = responseHeader(result.headers, `content-type`).split(`;`, 1)[0].trim();
      const mime = declaredMime.startsWith(`image/`) ? declaredMime : imageMimeFromUrl(sourceUrl);
      return `data:${mime};base64,${result.bodyBase64}`;
    }
    throw new Error(result?.error || `远程图片读取失败${status ? `（HTTP ${status}）` : ``}`);
  }

  if (!fetcher) throw new Error(`当前环境无法读取这张图片`);
  const response = await fetcher(sourceUrl);
  if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
  const dataUrl = await blobToDataUrl(await response.blob());
  if (!/^data:image\//i.test(dataUrl)) throw new Error(`读取结果不是有效图片`);
  return dataUrl;
}

export function wanjuanBuildEditedImageNodeData(data: any, options: any) {
  const persisted = options?.persisted;
  const transientDataUrl = String(options?.dataUrl || ``).trim();
  const editedAt = Number(options?.editedAt || Date.now());
  const persistedImageUrl = persisted?.localPath ? buildProjectMediaFileUrl(persisted.localPath) : ``;
  const imageUrl = persistedImageUrl
    ? `${persistedImageUrl}${persistedImageUrl.includes(`?`) ? `&` : `?`}wanjuan-edit=${editedAt}`
    : transientDataUrl;
  if (!imageUrl) throw new Error(`编辑结果没有可用的图片地址`);
  const persistedThumbnailUrl = persisted?.thumbnailLocalPath
    ? buildProjectMediaFileUrl(persisted.thumbnailLocalPath)
    : imageUrl;
  const thumbnailUrl = persisted?.thumbnailLocalPath
    ? `${persistedThumbnailUrl}${persistedThumbnailUrl.includes(`?`) ? `&` : `?`}wanjuan-edit=${editedAt}`
    : imageUrl;
  const clearedIdentity = wanjuanClearEditedImageReviewIdentity(data || {});
  const clearedData = wanjuanClearProjectAssetBindingsFromData(clearedIdentity, [`imageUrl`, `thumbnailUrl`]);
  const binding = persisted
    ? wanjuanBuildProjectAssetBinding(persisted, { sourceOrigin: `image-editor` })
    : null;
  if (binding) binding.sourceSignature = imageUrl;
  const nextData: any = {
    ...clearedData,
    imageUrl,
    thumbnailUrl,
    mediaKind: `image`,
    localPath: persisted?.localPath || undefined,
    filePath: persisted?.localPath || undefined,
    imageEditedAt: editedAt,
  };
  if (binding) {
    nextData.projectAssetBindings = {
      ...(clearedData?.projectAssetBindings || {}),
      imageUrl: binding,
    };
  }
  return nextData;
}

/**
 * Keep the source image intact and place every saved edit in a new image node.
 * Edited nodes are laid out beside the source in a small grid so repeated edits
 * remain visible instead of stacking on top of the original or one another.
 */
export function wanjuanAppendEditedImageToCanvasNodes(nodes: any[], sourceNodeId: any, options: any) {
  if (!Array.isArray(nodes)) return nodes;
  const sourceId = String(sourceNodeId || ``);
  const sourceNode = nodes.find((node) => String(node?.id || ``) === sourceId);
  if (!sourceNode) return nodes;

  const editedNodeId = String(options?.editedNodeId || ``).trim();
  if (!editedNodeId || nodes.some((node) => String(node?.id || ``) === editedNodeId)) return nodes;

  const priorEdits = nodes.filter((node) => String(node?.data?.imageEditorSourceNodeId || ``) === sourceId);
  const editIndex = Math.max(
    priorEdits.length,
    ...priorEdits.map((node) => Number(node?.data?.imageEditorEditIndex || 0)).filter(Number.isFinite),
  ) + 1;
  const nodeDimension = (value: any, fallback: number) => {
    const parsed = typeof value === `string` ? Number.parseFloat(value) : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const sourceWidth = nodeDimension(sourceNode?.style?.width || sourceNode?.measured?.width, 224);
  const sourceHeight = nodeDimension(sourceNode?.style?.height || sourceNode?.measured?.height, 224);
  const column = Math.floor((editIndex - 1) / 3) + 1;
  const row = (editIndex - 1) % 3;
  const sourcePosition = (() => {
    const absolute = sourceNode?.positionAbsolute;
    if (Number.isFinite(Number(absolute?.x)) && Number.isFinite(Number(absolute?.y))) {
      return { x: Number(absolute.x), y: Number(absolute.y) };
    }
    const byId = new Map(nodes.map((node) => [String(node?.id || ``), node]));
    const visited = new Set([sourceId]);
    let current = sourceNode;
    let x = Number(current?.position?.x || 0);
    let y = Number(current?.position?.y || 0);
    while (current?.parentId) {
      const parentId = String(current.parentId);
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);
      current = byId.get(parentId);
      if (!current) break;
      x += Number(current?.position?.x || 0);
      y += Number(current?.position?.y || 0);
    }
    return { x, y };
  })();
  const sourceData = sourceNode?.data || {};
  const runtimeData = Object.fromEntries([
    `onCrop`,
    `onZoom`,
    `onEdit`,
    `onVideoEdit`,
    `onSendToActiveTab`,
    `onTianjiPortraitReview`,
    `onArkTrustedAssetReview`,
    `onShowToast`,
  ].flatMap((key) => typeof sourceData[key] === `function` ? [[key, sourceData[key]]] : []));
  const nextData = wanjuanBuildEditedImageNodeData({
    ...runtimeData,
    label: sourceData.label,
    originalName: sourceData.originalName,
    arkTrustedAssetEnabled: sourceData.arkTrustedAssetEnabled,
  }, options);
  const editedNode = {
    id: editedNodeId,
    type: `imageNode`,
    selected: false,
    dragging: false,
    position: {
      x: Number(sourcePosition.x || 0) + column * (sourceWidth + 32),
      y: Number(sourcePosition.y || 0) + row * (sourceHeight + 32),
    },
    style: sourceNode?.type === `imageNode` && sourceNode?.style
      ? { ...sourceNode.style }
      : { width: 224, height: 224 },
    data: {
      ...nextData,
      sourceOrigin: `image-editor`,
      selectedContextResources: undefined,
      imageEditorSourceNodeId: sourceId,
      imageEditorEditIndex: editIndex,
    },
  };
  return [...nodes, editedNode];
}

const mediaValues = (value: any) => {
  if (!value || typeof value !== `object`) return [];
  return [
    value.url,
    value.imageUrl,
    value.thumbnailUrl,
    value.localPath,
    value.path,
    value.filePath,
    value.projectAssetBindings?.imageUrl?.localPath,
  ].map((item) => String(item || ``).trim()).filter(Boolean);
};

/** Legacy replacement helper retained for older project migrations and compatibility tests. */
export function wanjuanApplyEditedImageToCanvasNodes(nodes: any[], sourceNodeId: any, options: any) {
  if (!Array.isArray(nodes)) return nodes;
  const sourceId = String(sourceNodeId || ``);
  const sourceNode = nodes.find((node) => String(node?.id || ``) === sourceId);
  if (!sourceNode) return nodes;
  const oldValues = new Set(mediaValues(sourceNode.data));
  const nextSourceData = wanjuanBuildEditedImageNodeData(sourceNode.data, options);
  const nextImageUrl = String(nextSourceData.imageUrl || ``);
  const nextLocalPath = String(nextSourceData.localPath || ``);

  return nodes.map((node) => {
    if (String(node?.id || ``) === sourceId) return { ...node, data: nextSourceData };
    const resources = node?.data?.selectedContextResources;
    if (!Array.isArray(resources) || resources.length === 0) return node;
    let changed = false;
    const nextResources = resources.map((resource) => {
      if (!resource || typeof resource !== `object`) return resource;
      const linkedSourceId = String(resource.sourceNodeId || resource.sourceId || resource.nodeId || ``);
      const matchesSource = linkedSourceId === sourceId;
      const matchesOldMedia = mediaValues(resource).some((value) => oldValues.has(value));
      if (!matchesSource && !matchesOldMedia) return resource;
      changed = true;
      const clearedIdentity = wanjuanClearEditedImageReviewIdentity(resource);
      const clearedResource = wanjuanClearProjectAssetBindingsFromData(clearedIdentity, [`imageUrl`, `thumbnailUrl`]);
      const nextBindings = {
        ...(clearedResource?.projectAssetBindings || {}),
        ...(nextSourceData.projectAssetBindings || {}),
      };
      return {
        ...clearedResource,
        url: nextImageUrl,
        imageUrl: nextImageUrl,
        thumbnailUrl: nextSourceData.thumbnailUrl,
        localPath: nextLocalPath || undefined,
        path: nextLocalPath || undefined,
        sourceNodeId: linkedSourceId ? sourceId : resource.sourceNodeId,
        projectAssetBindings: Object.keys(nextBindings).length > 0 ? nextBindings : undefined,
      };
    });
    return changed ? { ...node, data: { ...node.data, selectedContextResources: nextResources } } : node;
  });
}
