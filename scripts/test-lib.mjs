// 工具库行为回归测试：编译 src/renderer/lib 后，对若干纯逻辑函数跑用例，
// 验证反混淆后的实现与预期行为一致。
//
// 运行：npm run test:lib
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "wj-lib-"));

function compile() {
  execFileSync(
    "npx",
    [
      "tsc",
      "--skipLibCheck",
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--jsx", "react-jsx",
      "--outDir", outDir,
      join(root, "src/renderer/lib/resource.ts"),
      join(root, "src/renderer/lib/reference-media.ts"),
      join(root, "src/renderer/lib/generation-reference.ts"),
      join(root, "src/renderer/lib/gemini-image.ts"),
      join(root, "src/renderer/lib/project-asset-binding.ts"),
      join(root, "src/renderer/lib/node-runtime-contract.ts"),
      join(root, "src/renderer/lib/video-aspect-ratio.ts"),
      join(root, "src/renderer/lib/video-task.ts"),
      join(root, "src/renderer/lib/video-parameter-mode.ts"),
      join(root, "src/renderer/lib/global-tasks.ts"),
      join(root, "src/renderer/lib/global-config.ts"),
      join(root, "src/renderer/lib/model-selection.ts"),
      join(root, "src/renderer/lib/media-model-contract.ts"),
      join(root, "src/renderer/lib/membership-benefits.ts"),
      join(root, "src/renderer/lib/managed-relay.ts"),
      join(root, "src/renderer/lib/account-records.ts"),
      join(root, "src/renderer/lib/app-notifications.ts"),
      join(root, "src/renderer/lib/config-butler.ts"),
      join(root, "src/renderer/lib/jixin-catalog.ts"),
      join(root, "src/renderer/lib/tianji-api.ts"),
      join(root, "src/renderer/lib/tianji-local-previews.ts"),
      join(root, "src/renderer/lib/tianji-assets.ts"),
      join(root, "src/renderer/lib/tianji-portrait.ts"),
      join(root, "src/renderer/lib/tianji-manual-reference.ts"),
      join(root, "src/renderer/lib/ark-trusted-assets.ts"),
      join(root, "src/renderer/lib/image-editor.ts"),
      join(root, "src/renderer/lib/automation-result.ts"),
      join(root, "src/renderer/lib/suno-music-api.ts"),
    ],
    { cwd: root, stdio: "inherit" }
  );
}

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}: got ${a}, expected ${e}`);
  }
}

async function run() {
  console.log("编译工具库...");
  compile();

  const { wanjuanApplyPersistedTransitResource, wanjuanBuildGeneratedVideoResourcesFromNodes, wanjuanResourceKind, wanjuanResourceSourceKind, wanjuanTransitResourceNeedsPersistence } = await import(pathToFileURL(join(outDir, "resource.js")).href);
  const { wanjuanCollectNodeReferenceMedia, wanjuanIsPublicHttpMediaUrl } = await import(pathToFileURL(join(outDir, "reference-media.js")).href);
  const { wanjuanAppendConnectedImageReferences, wanjuanAppendImageReferenceFiles, wanjuanBuildOpenAiImageReferencePlan } = await import(pathToFileURL(join(outDir, "generation-reference.js")).href);
  const { wanjuanBuildGeminiImageTransport } = await import(pathToFileURL(join(outDir, "gemini-image.js")).href);
  const { normalizeVideoAspectRatioValue, normalizeVideoSizeValue } = await import(pathToFileURL(join(outDir, "video-aspect-ratio.js")).href);
  const { applyRunScopedStateUpdate, compactGlobalTasks, failGlobalTaskRefresh, indexGlobalTasks, supersedeActiveNodeTasks, updateTaskRunningProgress } = await import(pathToFileURL(join(outDir, "global-tasks.js")).href);
  const { collectTaskCredentialConfigs, isCurrentSettingsSave, mergeGlobalConfigApiConfigs, replaceGlobalConfigApiConfigs, resolveTaskApiCredential, resolveTaskPollUrl } = await import(pathToFileURL(join(outDir, "global-config.js")).href);
  const { WanJuanShouldAutoPreferredModel } = await import(pathToFileURL(join(outDir, "model-selection.js")).href);
  const membershipBenefits = await import(pathToFileURL(join(outDir, "membership-benefits.js")).href);
  const managedRelay = await import(pathToFileURL(join(outDir, "managed-relay.js")).href);
  const accountRecords = await import(pathToFileURL(join(outDir, "account-records.js")).href);
  const appNotifications = await import(pathToFileURL(join(outDir, "app-notifications.js")).href);
  const videoTask = await import(pathToFileURL(join(outDir, "video-task.js")).href);
  const videoParameterMode = await import(pathToFileURL(join(outDir, "video-parameter-mode.js")).href);
  const nodeRuntime = await import(pathToFileURL(join(outDir, "node-runtime-contract.js")).href);
  const configButler = await import(pathToFileURL(join(outDir, "config-butler.js")).href);
  const { WANJUAN_JIXIN_BUILTIN_GLOBAL_CONFIG_ID, WANJUAN_JIXIN_BUILTIN_IMAGE_MODELS, WANJUAN_JIXIN_BUILTIN_IMAGE_PROTOCOLS, WANJUAN_JIXIN_BUILTIN_TEXT_MODELS, WANJUAN_JIXIN_BUILTIN_TEXT_PROTOCOLS, WANJUAN_JIXIN_BUILTIN_UNIFIED_VIDEO_MODELS, WANJUAN_JIXIN_BUILTIN_PROTOCOLS, WANJUAN_JIXIN_BUILTIN_VIDEO_PROTOCOL_BINDINGS, WANJUAN_JIXIN_DEFAULT_API_CONFIG_ID, wanjuanApplyJixinBuiltinProtocolPatch, wanjuanBuildJixinBuiltinBasePatch, wanjuanMergeJixinVideoProtocolDefaults, wanjuanMigrateJixinBuiltinCatalog, wanjuanSyncJixinBuiltinStoredGlobalConfig } = await import(pathToFileURL(join(outDir, "jixin-catalog.js")).href);
  const {
    WANJUAN_TIANJI_DEFAULT_BASE_URL,
    WANJUAN_TIANJI_SYNC_SOURCE_JIXIN,
    WANJUAN_TIANJI_SYNC_SOURCE_MANUAL,
    wanjuanBuildSyncedTianjiConfigFromJixin,
    wanjuanMarkTianjiConfigManual,
    wanjuanNormalizeTianjiSeedanceConfig,
    wanjuanNormalizeTianjiGenerationMode,
    wanjuanBuildTianjiGenerationRequest,
    wanjuanBuildTianjiTaskQuery,
    wanjuanTianjiBalancePoints,
    wanjuanTianjiAuthHeaders,
    wanjuanTianjiDefaultPortraitGroupName,
    WANJUAN_TIANJI_PORTRAIT_ENDPOINTS,
    wanjuanTianjiFindPortraitTaskId,
    wanjuanBuildTianjiPortraitTaskParams,
    wanjuanTianjiRequest,
    wanjuanValidateTianjiReferenceMedia,
    wanjuanTianjiFindTaskId,
    wanjuanTianjiFindVideoUrl,
    wanjuanTianjiFindThumbUrl,
    wanjuanTianjiStatus,
    wanjuanTianjiFindProgress,
    wanjuanTianjiErrorMessage,
    wanjuanTianjiMediaUrl
  } = await import(pathToFileURL(join(outDir, "tianji-api.js")).href);
  const {
    wanjuanTianjiAssetListParams,
    wanjuanTianjiFinalPortraitAsset,
    wanjuanTianjiPortraitAssetIdFromItem,
    wanjuanTianjiPortraitAvailabilityFromItem,
    wanjuanTianjiPortraitDeleteDescriptor,
    wanjuanTianjiPortraitGroupTypeFromItem,
    wanjuanTianjiPortraitImageUrlFromItem,
    wanjuanTianjiPortraitDisplayPreviewUrlFromItem,
    wanjuanTianjiDecorateLocalPreviews,
    wanjuanTianjiResolvePendingLocalPreviewAssetId,
    wanjuanTianjiResolvePortraitAssetForNodeData,
    wanjuanTianjiStripLocalPreviewDecoration,
  } = await import(pathToFileURL(join(outDir, "tianji-assets.js")).href);
  const {
    wanjuanFindTianjiLocalPreview,
    wanjuanNormalizeTianjiLocalPreviewRegistry,
    wanjuanRemoveTianjiLocalPreviewFromRegistry,
    wanjuanTianjiLocalPreviewEntryKey,
    wanjuanTianjiLocalPreviewScope,
  } = await import(pathToFileURL(join(outDir, "tianji-local-previews.js")).href);
  const { WANJUAN_TIANJI_PORTRAIT_SYNC_ERROR, wanjuanHasTianjiPortraitClaim, wanjuanIsReadyTianjiPortraitBinding, wanjuanNextTianjiPortraitBindingRevision, wanjuanNormalizeTianjiPortraitAssets, wanjuanPreferCurrentCanvasNodes, wanjuanRecoverTianjiPortraitNodeData, wanjuanResetTianjiPortraitBindingForImage, wanjuanResolveTianjiGenerationCanvasSnapshot, wanjuanTianjiPortraitBindingRevision, wanjuanTianjiPortraitNodeDataFromAutomation, wanjuanTianjiPortraitReferenceFromNodeData, wanjuanTianjiPortraitToResource } = await import(pathToFileURL(join(outDir, "tianji-portrait.js")).href);
  const { wanjuanCollectTianjiManualPortraitInputs, wanjuanExcludeTianjiPortraitPreviews, wanjuanFilterTianjiPortraitPreviews, wanjuanRemoveTianjiPortraitContextsForSources } = await import(pathToFileURL(join(outDir, "tianji-manual-reference.js")).href);
  const { inspectTianjiGenerationRequest, validateTianjiGenerationRequest } = await import(pathToFileURL(join(root, "electron/main/tianji-request-guard.cjs")).href);
  const arkTrustedAssets = await import(pathToFileURL(join(outDir, "ark-trusted-assets.js")).href);
  const imageEditor = await import(pathToFileURL(join(outDir, "image-editor.js")).href);
  const automationResult = await import(pathToFileURL(join(outDir, "automation-result.js")).href);
  const { resolveMediaModelContract } = await import(pathToFileURL(join(outDir, "media-model-contract.js")).href);
  const { getModelBindingCandidatesHelper, updateModelBindingHelper } = await import(pathToFileURL(join(outDir, "model-binding.js")).href);

  console.log("运行用例...");
  const notificationFixtures = [
    { id: "win", title: "fixture", platforms: ["windows"] },
    { id: "mac", title: "fixture", platforms: ["macos"] },
    { id: "linux", title: "fixture", platforms: ["linux"] },
    { id: "desktop", title: "fixture", platforms: ["desktop"] },
    { id: "electron", title: "fixture", platforms: ["electron"] },
    { id: "all", title: "fixture", platforms: ["all"] },
    { id: "web", title: "fixture", platforms: ["web"] },
    { id: "mobile", title: "fixture", platforms: ["mobile"] },
  ];
  const notificationIds = platform => appNotifications.WanJuanFilterAppNotifications(notificationFixtures,
    { platform, version: "1.4.8" }).map(item => item.id);
  check("Windows notifications exclude Mac and Linux", notificationIds("windows"), ["win", "desktop", "electron", "all"]);
  check("win32 platform alias resolves to Windows", notificationIds("win32"), notificationIds("windows"));
  check("Mac notifications exclude Windows and Linux", notificationIds("darwin"), ["mac", "desktop", "electron", "all"]);
  check("Linux notifications exclude Mac and Windows", notificationIds("linux"), ["linux", "desktop", "electron", "all"]);
  check("web does not inherit desktop-only notifications", notificationIds("web"), ["all", "web"]);
  check("mobile does not inherit desktop notifications", notificationIds("android"), ["all", "mobile"]);
  check("unknown platform safely uses web", notificationIds("unknown"), ["all", "web"]);
  for (const [label, browser, expected] of [
    ["Windows UA", { userAgent: "Mozilla Windows NT 10.0; Win64; x64", platform: "Win32" }, "windows"],
    ["Windows UA data", { userAgentData: { platform: "Windows" } }, "windows"],
    ["Mac UA", { userAgent: "Mozilla Macintosh; Intel Mac OS X", platform: "MacIntel" }, "macos"],
    ["Mac UA data", { userAgentData: { platform: "macOS" } }, "macos"],
    ["Linux", { platform: "Linux x86_64" }, "linux"],
    ["Android with Linux", { userAgent: "Mozilla Linux; Android 14", platform: "Linux arm64" }, "android"],
    ["iPhone with Mac OS", { userAgent: "iPhone; CPU iPhone OS like Mac OS X" }, "ios"],
    ["iPad desktop UA", { platform: "MacIntel", maxTouchPoints: 5 }, "ios"],
    ["no navigator", null, "web"],
    ["unknown browser", {}, "web"],
  ]) check(`notification platform detects ${label}`, appNotifications.WanJuanGetNotificationPlatform(browser), expected);
  check("Windows legacy channel aliases remain compatible",
    appNotifications.WanJuanFilterAppNotifications(["win", "win32", "win64", "mac", "darwin"].map(id =>
      ({ id, title: "fixture", platforms: [id] })), { platform: "windows", version: "1.4.8" }).map(item => item.id), ["win", "win32", "win64"]);
  check("notification version/time boundaries still apply",
    appNotifications.WanJuanFilterAppNotifications([
      { id: "future-version", title: "fixture", platforms: ["windows"], min_version: "1.5.0" },
      { id: "future-start", title: "fixture", platforms: ["windows"], start_at: "2030-01-01" },
      { id: "expired", title: "fixture", platforms: ["windows"], end_at: "2020-01-01" },
      { id: "valid", title: "fixture", platforms: ["windows"], min_version: "1.4.8" },
    ], { platform: "windows", version: "1.4.8", now: Date.parse("2026-10-26T00:00:00Z") }).map(item => item.id), ["valid"]);
  const windowsNotificationContext = {
    exports: {}, navigator: { userAgent: "Windows NT 10.0", platform: "Win32" },
    localStorage: { getItem: () => JSON.stringify({ items: notificationFixtures }) },
  };
  runInNewContext(readFileSync(join(outDir, "app-notifications.js"), "utf8"), windowsNotificationContext);
  const windowsNotifications = windowsNotificationContext.exports;
  check("Windows module default is detected rather than hardcoded macOS", windowsNotifications.WANJUAN_APP_NOTIFICATION_PLATFORM, "windows");
  check("Windows default filter hides Mac-specific notifications",
    windowsNotifications.WanJuanFilterAppNotifications(notificationFixtures).map(item => item.id), ["win", "desktop", "electron", "all"]);
  check("cached notifications use the same Windows platform filter",
    windowsNotifications.WanJuanLoadCachedAppNotifications().map(item => item.id), ["win", "desktop", "electron", "all"]);
  const mediaProtocol = { category: "video", requestType: "json-video", parameterOptions: { durations: ["5", "10"] } };
  const mediaImageProtocol = { category: "image", requestType: "gemini-generate-content", parameterAdapter: { fixedImageSize: "1K" } };
  const mediaConfigs = [{ id: "relay", url: "https://relay.invalid", key: "relay-fixture" }, { id: "official", url: "https://official.invalid", key: "official-fixture" }];
  const mediaOptions = {
    category: "video", model: "fixture.video/v1", apiConfigs: mediaConfigs,
    apiBindings: { "fixture-video-v1": "relay" }, protocolBindings: { "fixture-video-v1": "custom-video" },
    registry: { "custom-video": mediaProtocol, "custom-image": mediaImageProtocol },
  };
  const resolvedMedia = resolveMediaModelContract(mediaOptions);
  check("media controls resolve normalized model aliases to request protocol", resolvedMedia.protocol, mediaProtocol);
  check("media model binding resolves normalized channel", resolvedMedia.apiConfig.id, "relay");
  check("media explicit node channel takes priority over global model default", resolveMediaModelContract({ ...mediaOptions, selectedApiConfigId: "official" }).apiConfig.id, "official");
  check("media generate callback channel takes priority over saved node channel", resolveMediaModelContract({ ...mediaOptions, selectedApiConfigId: "relay", apiBindingId: "official" }).apiConfig.id, "official");
  check("media protocol resolver preserves exact custom contract identity", resolvedMedia.protocol === mediaProtocol, true);
  check("media resolver does not overwrite manual configs", mediaConfigs[1].key, "official-fixture");
  const channelSpecificVideo = { ...mediaConfigs[0], videoProtocolBindings: { "fixture-video-v1": "relay-video" } };
  const officialSpecificVideo = { ...mediaConfigs[1], videoProtocolBindings: { "fixture-video-v1": "official-video" } };
  const channelSpecificRegistry = {
    "relay-video": mediaProtocol,
    "official-video": { category: "video", requestType: "multipart-video", parameterOptions: { durations: ["4", "6"] } },
    "global-video": { category: "video", requestType: "openai-video" },
  };
  const boundChannelOptions = { category: "video", model: "fixture.video/v1", apiConfigs: [channelSpecificVideo, officialSpecificVideo], apiBindings: { "fixture-video-v1": "relay" }, protocolBindings: { "fixture-video-v1": "global-video" }, registry: channelSpecificRegistry };
  check("media selected relay uses its per-channel protocol", resolveMediaModelContract(boundChannelOptions).protocolName, "relay-video");
  check("media selected official endpoint uses a distinct protocol for the same model", resolveMediaModelContract({ ...boundChannelOptions, selectedApiConfigId: "official" }).protocolName, "official-video");
  check("media explicit request channel selects the matching channel protocol", resolveMediaModelContract({ ...boundChannelOptions, apiBindingId: "official" }).protocolName, "official-video");
  check("media empty channel protocol falls back to the legacy global model profile", resolveMediaModelContract({ ...boundChannelOptions, apiConfigs: [{ ...channelSpecificVideo, videoProtocolBindings: {} }] }).protocolName, "global-video");
  check("media image channel protocol does not leak into video contract", resolveMediaModelContract({ ...boundChannelOptions, apiConfigs: [{ ...channelSpecificVideo, videoProtocolBindings: {}, imageProtocolBindings: { "fixture-video-v1": "relay-video" } }] }).protocolName, "global-video");
  check("media rejects a channel profile with the wrong category", resolveMediaModelContract({ ...boundChannelOptions, apiConfigs: [{ ...channelSpecificVideo, videoProtocolBindings: { "fixture-video-v1": "custom-image" } }], registry: { "custom-image": mediaImageProtocol } }).protocolCategoryMismatch, true);
  check("media flags a deleted per-channel profile instead of silently inferring another route", resolveMediaModelContract({ ...boundChannelOptions, apiConfigs: [{ ...channelSpecificVideo, videoProtocolBindings: { "fixture-video-v1": "deleted-profile" } }] }).protocolConfigMissing, true);
  check("media image UI and request share fixed size via alias", resolveMediaModelContract({ ...mediaOptions, category: "image", protocolBindings: { "fixture-video-v1": "custom-image" } }).protocol.parameterAdapter.fixedImageSize, "1K");
  check("media video cannot consume image protocol", resolveMediaModelContract({ ...mediaOptions, protocolBindings: { "fixture-video-v1": "custom-image" } }).protocol, undefined);
  check("media invalid category cannot leak protocol name to request inference", resolveMediaModelContract({ ...mediaOptions, protocolBindings: { "fixture-video-v1": "custom-image" } }).protocolName, "");
  check("media legacy category-less custom profiles are preserved", resolveMediaModelContract({ ...mediaOptions, registry: { "custom-video": { requestType: "json-video" } } }).protocol.requestType, "json-video");
  check("media empty node bindings fall back to live global bindings", resolveMediaModelContract({ ...mediaOptions, protocolBindings: {}, fallbackProtocolBindings: mediaOptions.protocolBindings }).protocol, mediaProtocol);
  check("media node protocol binding wins over global fallback", resolveMediaModelContract({ ...mediaOptions, fallbackProtocolBindings: { "fixture-video-v1": "custom-image" } }).protocol, mediaProtocol);
  check("media unknown selected channel does not resolve unrelated config", resolveMediaModelContract({ ...mediaOptions, selectedApiConfigId: "removed" }).apiConfig, undefined);
  check("media legacy unbound models remain unbound", resolveMediaModelContract({ category: "video", model: "unknown" }).protocol, undefined);
  check("media same exact custom model spelling wins over normalized candidate", resolveMediaModelContract({ ...mediaOptions, apiBindings: { "fixture.video/v1": "official", "fixture-video-v1": "relay" } }).apiConfig.id, "official");
  check("media alias graph expands despite normalized seed already in candidates", getModelBindingCandidatesHelper("veo_3_1-fast").includes("veo3-1-fast-components"), true);
  check("media alias graph cycles terminate without duplicates", new Set(getModelBindingCandidatesHelper("veo-3-1-fast")).size, getModelBindingCandidatesHelper("veo-3-1-fast").length);
  const aliasBindingsToClear = { "veo3-1-fast-components": "old", "veo_3_1-fast": "stale", other: "preserved" };
  check("media clearing a model binding removes imported aliases", updateModelBindingHelper(aliasBindingsToClear, "veo-3-1-fast", ""), { other: "preserved" });
  check("media changing a model binding consolidates only its aliases", updateModelBindingHelper(aliasBindingsToClear, "veo-3-1-fast", "new"), { other: "preserved", "veo-3-1-fast": "new" });
  check("media binding edits preserve input config", aliasBindingsToClear["veo_3_1-fast"], "stale");
  check("media relay alias resolves parameter protocol without renaming wire model", resolveMediaModelContract({ ...mediaOptions, model: "veo_3_1-fast", protocolBindings: { "veo3-1-fast-components": "custom-video" } }).protocol, mediaProtocol);
  managedRelay.setManagedRelayRuntimeState({ status: "pending", managed: true, keyVersion: "" });
  check("pending relay does not inject a managed credential", managedRelay.wanjuanResolveManagedRelayConfig([], ""), undefined);
  managedRelay.setManagedRelayRuntimeState({ status: "active", managed: true, keyVersion: "1" });
  check(
    "active relay injects an ephemeral managed configuration when no saved config exists",
    managedRelay.wanjuanResolveManagedRelayConfig([], "missing"),
    {
      id: "jixin-default",
      name: "极鑫托管配置",
      url: "https://jixing.guancn.uk",
      key: "__WANJUAN_MANAGED_RELAY__",
      protocolFormat: "auto",
      managed: true,
    },
  );
  const manualRelayConfig = { id: "manual", name: "Manual", url: "https://jixing.guancn.uk", key: "manual-secret" };
  check("saved manual configuration always wins over managed fallback", managedRelay.wanjuanResolveManagedRelayConfig([manualRelayConfig], "manual"), manualRelayConfig);
  check("renderer managed relay accepts only the exact HTTPS origin", [
    managedRelay.wanjuanIsManagedRelayUrl("https://jixing.guancn.uk/v1/models"),
    managedRelay.wanjuanIsManagedRelayUrl("https://user:secret@jixing.guancn.uk/v1/models"),
    managedRelay.wanjuanIsManagedRelayUrl("https://jixing.guancn.uk:8443/v1/models"),
    managedRelay.wanjuanIsManagedRelayUrl("http://jixing.guancn.uk/v1/models"),
  ], [true, false, false, false]);
  managedRelay.setManagedRelayRuntimeState(null);
  check("account record pagination normalizes nextCursor", accountRecords.wanjuanAccountRecordsPage({ records: [{ id: "r1" }], nextCursor: "page-2" }), { items: [{ id: "r1" }], nextCursor: "page-2", hasMore: true });
  check("account record pagination deduplicates overlapping pages", accountRecords.wanjuanMergeAccountRecordPages([{ id: "r1" }], [{ id: "r1" }, { id: "r2" }]).map((item) => item.id), ["r1", "r2"]);
  check("stale account record responses are rejected after account switch", accountRecords.wanjuanAccountRecordRequestIsCurrent({ cancelled: false, requestScope: "account-a", currentScope: "account-b", requestId: 3, currentRequestId: 3 }), false);
  check("superseded account record responses are rejected within one account", accountRecords.wanjuanAccountRecordRequestIsCurrent({ cancelled: false, requestScope: "account-a", currentScope: "account-a", requestId: 2, currentRequestId: 3 }), false);
  const recordTimeRange = accountRecords.wanjuanBuildAccountRecordTimeRange("2026-10-01", "2026-10-02");
  check("account record dates become timezone-explicit RFC3339 instants", [recordTimeRange.from.endsWith("Z"), recordTimeRange.to.endsWith("Z"), Date.parse(recordTimeRange.to) - Date.parse(recordTimeRange.from)], [true, true, 2 * 24 * 60 * 60 * 1000]);
  let invalidRecordRange = ``;
  try { accountRecords.wanjuanBuildAccountRecordTimeRange("2026-10-03", "2026-10-01"); } catch (error) { invalidRecordRange = error.message; }
  check("reversed account record date range fails closed", invalidRecordRange, "账单日期范围无效");
  const nativePanelSource = readFileSync(join(root, "src/renderer/components/tianji-settings-native.tsx"), "utf8");
  const preloadPanelSource = readFileSync(join(root, "electron/preload/desktop-patches.cjs"), "utf8");
  const cloudWorkspaceSource = readFileSync(join(root, "electron/preload/cloud-prompt-workspace.cjs"), "utf8");
  const accountGateSource = readFileSync(join(root, "src/renderer/components/account-gate.tsx"), "utf8");
  const accountLibSource = readFileSync(join(root, "src/renderer/lib/account.ts"), "utf8");
  const bootThemeSource = readFileSync(join(root, "electron/preload/boot-theme.cjs"), "utf8");
  const desktopWindowSource = readFileSync(join(root, "electron/main/window.cjs"), "utf8");
  const startupReadiness = await import(pathToFileURL(join(root, "electron/shared/startup-readiness.cjs")).href);
  const appBundleSource = readFileSync(join(root, "src/renderer/bundle/index.js"), "utf8");
  const videoGenerationSource = readFileSync(join(root, "src/renderer/hooks/useVideoGeneration.ts"), "utf8");
  const imageGenerationSource = readFileSync(join(root, "src/renderer/hooks/useImageGeneration.ts"), "utf8");
  const videoNodeSource = readFileSync(join(root, "src/renderer/components/video-node.tsx"), "utf8");
  const renderModeSource = readFileSync(join(root, "src/renderer/components/render-mode.tsx"), "utf8");
  const desktopIpcSource = readFileSync(join(root, "electron/main/ipc.cjs"), "utf8");
  const tianjiApiSource = readFileSync(join(root, "src/renderer/lib/tianji-api.ts"), "utf8");
  const accountSettingsSource = readFileSync(join(root, "src/renderer/components/settings-account-tab.tsx"), "utf8");
  const accountRelayWalletSource = readFileSync(join(root, "src/renderer/components/account-relay-wallet.tsx"), "utf8");
  const managedRelaySource = readFileSync(join(root, "src/renderer/lib/managed-relay.ts"), "utf8");
  const safeApiEffectSource = readFileSync(join(root, "src/renderer/hooks/useSafeEffect19.ts"), "utf8");
  const membershipDialogSource = readFileSync(join(root, "src/renderer/components/membership-benefits-dialog.tsx"), "utf8");
  const imageEditorModalSource = readFileSync(join(root, "src/renderer/components/image-annotate-modal.tsx"), "utf8");
  const mediaEditorsSource = readFileSync(join(root, "src/renderer/hooks/useMediaEditors.ts"), "utf8");
  const membershipSnapshot = { plan: "free", status: "inactive" };
  const successNotifications = [];
  const copiedValues = [];
  check("membership exposes two non-pricing benefits", membershipBenefits.WANJUAN_MEMBERSHIP_BENEFITS.length, 2);
  check("membership price stays informational", membershipDialogSource.includes("¥</span>19.9") && !membershipDialogSource.includes("已开通"), true);
  check("account registration is not described as invite-only", membershipDialogSource.includes("注册账号无需内测码；会员服务详情请联系 QQ：") && !membershipDialogSource.includes("开通会员需要内测码"), true);
  check("membership button opens an accessible dialog", accountSettingsSource.includes("会员权益") && membershipDialogSource.includes('role="dialog"') && membershipDialogSource.includes('aria-modal="true"'), true);
  check("account center exposes relay wallet and billing surfaces", ["极鑫托管服务", "模型余额", "账单与使用记录"].every((label) => accountRelayWalletSource.includes(label)), true);
  check("relay key is only held temporarily in renderer memory", accountRelayWalletSource.includes("setTimeout(() => setRevealedKey(``), 60_000)") && !accountRelayWalletSource.includes("localStorage"), true);
  check("managed relay uses only an opaque renderer placeholder", managedRelaySource.includes("__WANJUAN_MANAGED_RELAY__") && !managedRelaySource.includes("sk-"), true);
  check("managed relay never overrides a configured manual key", safeApiEffectSource.includes("String(config.key || ``).trim() || wanjuanManagedRelayPlaceholderFor(config)") && managedRelaySource.includes("if (selected) return selected"), true);
  check("managed relay creates only an ephemeral fallback", managedRelaySource.includes("wanjuanResolveManagedRelayConfig") && managedRelaySource.includes("if (!wanjuanManagedRelayAvailable()) return undefined"), true);
  check("account wallet obeys all four feature flags", ["relayAutoProvision", "relayManagedConfig", "relayWalletUi", "relayRedeem"].every((flag) => accountRelayWalletSource.includes(flag)), true);
  check("production auth defaults to OTP unless public capabilities explicitly enable password flows", accountGateSource.includes('useState<"password" | "otp" | "reset">("otp")') && accountGateSource.includes("passwordAuthEnabled") && accountGateSource.includes("passwordRegistrationEnabled") && accountGateSource.includes("passwordResetEnabled"), true);
  check("renderer account refreshes are scoped to the active identity epoch", accountLibSource.includes("accountStateEpoch") && accountLibSource.includes("requestScope === accountRequestScope()") && accountLibSource.includes("accountIdentityScopeKey"), true);
  check("wallet UI clears sensitive and billing state on account scope changes", ["setRevealedKey(``)", "setRedeemCode(``)", "setUsageRecords([])", "setWalletRecords([])", "accountScopeRef.current !== requestScope"].every((entry) => accountRelayWalletSource.includes(entry)), true);
  check("account wallet represents provisioning failure states", ["正在创建账号与 Key", "服务暂时不可用，后台重试中", "账号已暂停，模型调用已停用", "自动开通失败，请稍后刷新或联系客服"].every((label) => accountRelayWalletSource.includes(label)), true);
  check("legacy account linking uses a stable renderer idempotency key", accountRelayWalletSource.includes("linkIdempotencyKey.current") && accountRelayWalletSource.includes("confirmRelayLink(verificationCode, legacyChallenge, linkIdempotencyKey.current)"), true);
  check("legacy account linking clears ephemeral credentials and challenge together", accountRelayWalletSource.includes("const resetLinkFlow = () =>") && ["setLegacyPassword(``)", "setLegacyMfaCode(``)", "setLegacyChallenge(``)", "setVerificationCode(``)"].every((entry) => accountRelayWalletSource.includes(entry)), true);
  check("password auth is capability-gated and keeps OTP compatibility", accountGateSource.includes('activeLoginMethod === "otp"') && accountGateSource.includes('loginMethod === "reset"') && accountGateSource.includes("passwordRegistrationEnabled") && accountGateSource.includes("resetAccountPassword") && !accountGateSource.includes("inviteCode"), true);
  check("membership dialog supports escape, backdrop and focus return", membershipDialogSource.includes('event.key === "Escape"') && membershipDialogSource.includes("event.target === event.currentTarget") && membershipDialogSource.includes("previousFocus?.focus()"), true);
  check("image editor catches canvas export and async save errors", imageEditorModalSource.includes("canvasRef.current.toDataURL") && imageEditorModalSource.includes("await onSave(result)") && imageEditorModalSource.includes("catch (error: any)"), true);
  check("image editor zooms with an ordinary mouse wheel", imageEditorModalSource.includes("event.preventDefault();") && imageEditorModalSource.includes("event.stopPropagation();") && !imageEditorModalSource.includes("if (!(event.ctrlKey || event.metaKey)) return;"), true);
  check("image editor persists results before adding derived canvas media", mediaEditorsSource.includes("persistProjectAsset") && mediaEditorsSource.includes("wanjuanAppendEditedImageToCanvasNodes") && mediaEditorsSource.includes("if (!persisted?.ok || !persisted.localPath)"), true);
  check("membership state is not mutated by benefits dialog", membershipSnapshot, { plan: "free", status: "inactive" });
  check("membership copy succeeds", await membershipBenefits.copyMembershipContactQQ({ clipboard: { writeText: async (value) => copiedValues.push(value) }, notify: (message) => successNotifications.push(message) }), true);
  check("membership copy writes only contact QQ", copiedValues, [membershipBenefits.WANJUAN_MEMBERSHIP_CONTACT_QQ]);
  check("membership copy success toast", successNotifications, ["QQ 已复制"]);
  const failureNotifications = [];
  check("membership copy failure is handled", await membershipBenefits.copyMembershipContactQQ({ clipboard: null, notify: (message) => failureNotifications.push(message) }), false);
  check("membership copy failure toast", failureNotifications, ["复制失败，请手动复制 QQ"]);
  check("tianji panel exposes portrait group name", nativePanelSource.includes("素材组名称"), true);
  check("tianji virtual group sends generated name", nativePanelSource.includes("params: { name: groupName }"), true);
  check("tianji panel blocks task query without task credentials", nativePanelSource.includes("!bytedToken.trim() && !portraitTaskId.trim()"), true);
  check("tianji panel exposes local preview actions", nativePanelSource.includes("选择预览") && nativePanelSource.includes("更换预览") && nativePanelSource.includes("清除预览"), true);
  check("tianji local preview stays out of generation preview metadata", videoNodeSource.includes("tianjiPortraitLocalPreviewUrl") && !videoNodeSource.includes("tianjiPortraitPreviewUrl: resource.url"), true);
  check("tianji picker visibly disables non-Active portraits", videoNodeSource.includes("portraitAvailability !== `ready`") && videoNodeSource.includes("`处理失败`") && videoNodeSource.includes("`审核中`"), true);
  check("tianji reference dedupe prioritizes final portrait id", videoGenerationSource.includes("String(reference?.tianjiPortraitAssetId || ``).trim() === tianjiPortraitAssetId"), true);
  check("tianji preload persists portrait task id", preloadPanelSource.includes("tianjiSeedancePortraitTaskId"), true);
  check("tianji preload supports explicit form encoding", preloadPanelSource.includes('encoding = "json"') && preloadPanelSource.includes('headers["Content-Type"] = "application/x-www-form-urlencoded"'), true);
  check("tianji connection requires trusted source, ready status and final id", videoGenerationSource.includes('sourceHasTianjiPortraitClaim = Boolean(sourceNode?.data?.tianjiPortraitAssetId || sourceNode?.data?.isTianjiPortrait)') && videoGenerationSource.includes('sourceTianjiBindingStatus !== `ready` || !sourceTianjiPortraitAssetId') && !videoGenerationSource.includes('sourceTianjiPortraitPreviewUrl = String('), true);
  check("tianji manual collection keeps reviewed portraits out of image refs", videoGenerationSource.includes("wanjuanCollectTianjiManualPortraitInputs") && videoGenerationSource.includes("portraitAssetIds: seedanceConnectedPortraitAssetIds") && !videoGenerationSource.includes("addVideoReferenceImage(wanjuanTianjiPortraitReferenceFromNodeData(sourceNode.data))"), true);
  check("rendered node props are registered as the freshest runtime snapshot", renderModeSource.includes("renderedNodes?.set?.(props.id, { id: props.id, type: nodeType, data: props.data })") && renderModeSource.includes("renderedNodes.delete(props.id)"), true);
  check("manual video generation captures React Flow topology once and only supplements stale runtime snapshots", videoGenerationSource.includes("flowNodesSnapshot = [...(getNodes() || [])]") && videoGenerationSource.includes("flowEdgesSnapshot = [...(getEdges() || [])]") && videoGenerationSource.includes("wanjuanResolveTianjiGenerationCanvasSnapshot") && !videoGenerationSource.includes("wanjuanPreferCurrentCanvasNodes"), true);
  check("video generation preserves opaque connected image URLs", videoGenerationSource.includes("wanjuanAppendConnectedImageReferences(sourceReferenceImages, addVideoReferenceImage") && !videoGenerationSource.includes("/\\.(jpg|jpeg|png|webp|gif)($|\\?)/i.test(imageUrl)"), true);
  check("image generation selects edits from protocol capability", imageGenerationSource.includes("wanjuanBuildOpenAiImageReferencePlan") && imageGenerationSource.includes("openAiImageReferencePlan.useEdit"), true);
  check("image generation blocks instead of silently dropping unreadable connected references", imageGenerationSource.includes("Failed to normalize a connected image reference for image generation") && imageGenerationSource.includes("参考图读取失败，请重新连接图片后再试"), true);
  check("image generation blocks unsupported references instead of silently generating without them", imageGenerationSource.includes("当前图片模型协议未配置参考图字段或编辑接口，已停止生成以避免忽略参考图") && imageGenerationSource.includes("imageProtocolProfile.fieldMapping?.referenceImage"), true);
  check("Gemini image generation sends native inline reference parts and IMAGE modality", imageGenerationSource.includes("contentParts.push({\n                inlineData:") && imageGenerationSource.includes("responseModalities: [`IMAGE`]") , true);
  check("Gemini image generation applies the protocol fixed 1K limit before request serialization", /if \(geminiImageTransport\.fixedImageSize\) requestParams\.imageSize = geminiImageTransport\.fixedImageSize;[\s\S]{0,120}let requestBody = \{/.test(imageGenerationSource), true);
  check("Gemini gateway transport is used by the real image-generation path", imageGenerationSource.includes("wanjuanBuildGeminiImageTransport") && imageGenerationSource.includes("fetch(geminiImageTransport.requestUrl") && imageGenerationSource.includes("headers: geminiImageTransport.headers"), true);
  check("packaged Tianji preflight validates and blocks upstream", desktopIpcSource.includes("inspectTianjiGenerationRequest") && desktopIpcSource.includes("validateTianjiGenerationRequest") && desktopIpcSource.includes("if (preflight) return preflight"), true);
  check("tianji badges require ready id and trusted source", [readFileSync(join(root, "src/renderer/components/image-node.tsx"), "utf8"), readFileSync(join(root, "src/renderer/components/prompt-node.tsx"), "utf8")].every((source) => source.includes("String(data.tianjiPortraitAssetId || ``).trim()") && source.includes("data.sourceOrigin === `tianji-portrait`")), true);
  check("tianji request diagnostics expose only scheme counts", tianjiApiSource.includes('imageSchemes: referenceSchemeCounts([') && !tianjiApiSource.includes('promptPreview:') && !tianjiApiSource.includes('imageRefs: imageUrls.map'), true);
  check("cloud workspace label uses workspace name, not account id", cloudWorkspaceSource.includes("workspace.name || t(\"未命名空间\")"), true);
  check("cloud workspace label exposes full text accessibly", cloudWorkspaceSource.includes("title=\"${escape(selectedWorkspaceLabel)}\" aria-label=\"${escape(selectedWorkspaceLabel)}\""), true);
  check("cloud workspace select allows shrinking", preloadPanelSource.includes(".wanjuan-cloud-workspace-select{display:block;width:100%;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"), true);
  check("cloud workspace card clips long labels", preloadPanelSource.includes(".wanjuan-cloud-workspace-block{display:grid;gap:8px;min-width:0;max-width:100%"), true);
  check("fresh account gate does not cover app while loading", accountGateSource.includes("if (account.loading) return null;"), true);
  check("fresh account gate only opens after explicit auth request", accountGateSource.includes("if (!account.authOpen) return null;"), true);
  check("boot splash has a minimum visible duration", bootThemeSource.includes("if (elapsed < 720)"), true);
  check("boot splash timeout offers recovery", bootThemeSource.includes("wanjuan-boot-retry"), true);
  check("boot splash releases an already rendered shell", bootThemeSource.includes('root.dataset.wanjuanBootReady = "stable-shell-fallback"'), true);
  const startupRoot = {
    innerText: "Canvas Resources Agents Settings",
    childElementCount: 1,
    getBoundingClientRect: () => ({ width: 1280, height: 860 })
  };
  const startupDocument = {
    readyState: "complete",
    documentElement: { dataset: { wanjuanAppReady: "true", wanjuanProjectId: "default", wanjuanThemeMode: "graphite" } },
    getElementById: (id) => id === "root" ? startupRoot : null,
    querySelectorAll: (selector) => selector === ".wanjuan-app-top-nav .wanjuan-app-nav-tab" ? new Array(5).fill({}) : []
  };
  const startupWindow = {
    wanjuanDesktop: {
      proxyFetch() {}, abortProxyFetch() {}, saveDownload() {}, uploadPublicMedia() {}
    },
    __wanjuanMainWorldFetchProxyInstalled: true
  };
  const englishStartupStatus = startupReadiness.inspectRendererStartupDocument(startupDocument, startupWindow);
  check("startup readiness is structural and language independent", englishStartupStatus.hasMainNav && startupReadiness.isRendererBaseReady(englishStartupStatus), true);
  const startupLifecycle = startupReadiness.createRendererStartupLifecycle();
  const firstStartup = startupLifecycle.beginNavigation();
  check("first startup reveal is armed", startupLifecycle.beginReveal(), firstStartup);
  startupLifecycle.markRevealed(firstStartup);
  const retryStartup = startupLifecycle.beginNavigation();
  check("reload creates a fresh startup attempt", retryStartup, firstStartup + 1);
  check("stale startup attempt cannot reveal reloaded page", startupLifecycle.markRevealed(firstStartup), false);
  check("reloaded page can start readiness detection", startupLifecycle.beginReveal(), retryStartup);
  check("main process rearms readiness on navigation", desktopWindowSource.includes('startupLifecycle.beginNavigation()') && desktopWindowSource.includes('revealWindowWhenStable("did-finish-load")'), true);
  check("main process accepts a stable bridged shell fallback", desktopWindowSource.includes('readiness: rendererReady ? "app-ready" : "stable-shell-fallback"'), true);
  check("late first renderer response can still release a valid shell", desktopWindowSource.includes("Date.now() - startedAt >= maxWaitMs"), true);
  check("blank or unbridged startup still reaches recovery", desktopWindowSource.includes("if (!rendererReady && !shellReadyFallback)"), true);
  check("settings defaults to account tab", appBundleSource.includes("[activeSettingsTab, setActiveSettingsTab] = useState(`account`)") , true);
  check("opening settings resets only the new session default", appBundleSource.includes("setActiveSettingsTab(`account`);\n\t      setActiveView(`settings`);"), true);
  check("automation extracts direct custom image data", automationResult.wanjuanExtractAutomationMedia("https://cdn.example.com/result.png", "image"), "https://cdn.example.com/result.png");
  check("automation extracts nested JSON image URL", automationResult.wanjuanExtractAutomationMedia(JSON.stringify({ output: { images: [{ image_url: "https://cdn.example.com/nested.png" }] } }), "image"), "https://cdn.example.com/nested.png");
  check("automation recognizes video blob for persistence", automationResult.wanjuanExtractAutomationMedia({ result: { videoUrl: "blob:http://127.0.0.1/test" } }, "video"), "blob:http://127.0.0.1/test");
  check("automation does not expose arbitrary custom text", automationResult.wanjuanExtractAutomationMedia("API key: secret", "image"), "");
  check("automation builds encoded file URL", automationResult.wanjuanAutomationFileUrl("/Users/test/万卷 result.png"), "file:///Users/test/%E4%B8%87%E5%8D%B7%20result.png");
  check("automation builds Windows file URL", automationResult.wanjuanAutomationFileUrl("C:\\WanJuan\\result video.mp4"), "file:///C:/WanJuan/result%20video.mp4");
  check(
    "tianji image binding survives same result",
    wanjuanResetTianjiPortraitBindingForImage({ imageUrl: "https://cdn/a.png", tianjiPortraitAssetId: "asset-a", tianjiPortraitBindingStatus: "ready" }, "https://cdn/a.png"),
    { imageUrl: "https://cdn/a.png", tianjiPortraitAssetId: "asset-a", tianjiPortraitBindingStatus: "ready" }
  );
  check(
    "tianji image binding clears for new result",
    wanjuanResetTianjiPortraitBindingForImage({ imageUrl: "https://cdn/a.png", tianjiPortraitAssetId: "asset-a", tianjiPortraitBindingStatus: "ready", tianjiPortraitBindingMessage: "bound", isTianjiPortrait: true, sourceOrigin: "tianji-portrait" }, "https://cdn/b.png"),
    { imageUrl: "https://cdn/a.png", tianjiPortraitAssetId: undefined, tianjiPortraitGroupType: undefined, tianjiPortraitPreviewUrl: undefined, tianjiPortraitLocalPreviewUrl: undefined, tianjiPortraitBindingLookupUrl: undefined, tianjiPortraitBindingName: undefined, tianjiPortraitBindingSourceUrl: undefined, tianjiPortraitBindingStatus: undefined, tianjiPortraitBindingMessage: undefined, tianjiPortraitReviewedAt: undefined, tianjiPortraitBoundAt: undefined, isTianjiPortrait: false, sourceOrigin: "generated", tianjiPortraitBindingRevision: 1 }
  );
  check(
    "ark binding survives the same image",
    arkTrustedAssets.wanjuanResetArkTrustedAssetBindingForImage({ imageUrl: "https://cdn/a.png", arkTrustedAssetId: "ark-a", arkTrustedAssetSourceUrl: "https://cdn/a.png", arkTrustedAssetStatus: "ready" }, "https://cdn/a.png"),
    { imageUrl: "https://cdn/a.png", arkTrustedAssetId: "ark-a", arkTrustedAssetSourceUrl: "https://cdn/a.png", arkTrustedAssetStatus: "ready" }
  );
  check(
    "ark binding clears when the image changes",
    arkTrustedAssets.wanjuanResetArkTrustedAssetBindingForImage({ imageUrl: "https://cdn/a.png", arkTrustedAssetId: "ark-a", arkTrustedAssetGroupId: "group-a", arkTrustedAssetContentHash: "hash-a", arkTrustedAssetSourceUrl: "https://cdn/a.png", arkTrustedAssetStatus: "ready", arkTrustedAssetMessage: "ready", arkTrustedAssetReviewedAt: 1 }, "https://cdn/b.png"),
    { imageUrl: "https://cdn/a.png", arkTrustedAssetId: undefined, arkTrustedAssetGroupId: undefined, arkTrustedAssetContentHash: undefined, arkTrustedAssetSourceUrl: undefined, arkTrustedAssetStatus: undefined, arkTrustedAssetMessage: undefined, arkTrustedAssetReviewedAt: undefined }
  );
  check(
    "ark ready binding resolves without changing the generation API",
    await arkTrustedAssets.wanjuanResolveArkTrustedAssetReference({
      config: { enabled: true, reviewMode: "auto" },
      entry: { url: "https://cdn/a.png", arkTrustedAssetId: "ark-a", arkTrustedAssetSourceUrl: "https://cdn/a.png", arkTrustedAssetStatus: "ready", tianjiPortraitAssetId: "tianji-stays" },
      reviewAsset: () => { throw new Error("should not review"); }
    }),
    { url: "asset://ark-a", assetId: "ark-a", groupId: "", reviewed: false, cached: true }
  );
  let arkAutoReviewCalls = 0;
  check(
    "ark auto mode reviews and returns asset URL",
    await arkTrustedAssets.wanjuanResolveArkTrustedAssetReference({
      config: { enabled: true, reviewMode: "auto" },
      entry: { url: "file:///tmp/a.png", nodeId: "image-1" },
      reviewAsset: async () => { arkAutoReviewCalls++; return { ok: true, assetId: "ark-new", groupId: "group-a" }; }
    }),
    { ok: true, assetId: "ark-new", groupId: "group-a", url: "asset://ark-new", reviewed: true }
  );
  check("ark auto review runs once", arkAutoReviewCalls, 1);
  check(
    "ark manual mode leaves unreviewed reference unchanged",
    await arkTrustedAssets.wanjuanResolveArkTrustedAssetReference({
      config: { enabled: true, reviewMode: "manual" },
      entry: { url: "https://cdn/a.png", tianjiPortraitAssetId: "tianji-stays" },
      reviewAsset: () => { throw new Error("should not review"); }
    }),
    { url: "https://cdn/a.png", reviewed: false }
  );
  check(
    "ark reviewed reference remains usable with a relay generation configuration",
    await arkTrustedAssets.wanjuanResolveArkTrustedAssetReference({
      config: { enabled: true, reviewMode: "manual" },
      entry: { url: "https://cdn/a.png", arkTrustedAssetId: "ark-relay", arkTrustedAssetSourceUrl: "https://cdn/a.png", arkTrustedAssetStatus: "ready" },
      reviewAsset: () => { throw new Error("should not review"); }
    }),
    { url: "asset://ark-relay", assetId: "ark-relay", groupId: "", reviewed: false, cached: true }
  );
  check(
    "resource backfill prefers an existing local video binding over an expiring remote URL",
    (() => {
      const resource = wanjuanBuildGeneratedVideoResourcesFromNodes([
        {
          id: "video-node-local",
          type: "videoNode",
          data: {
            label: "已生成视频",
            videoUrl: "https://temporary.example.com/result.mp4",
            projectAssetBindings: {
              videoUrl: {
                ok: true,
                missing: false,
                localPath: "/Users/test/media/result.mp4",
                sourceSignature: "https://temporary.example.com/result.mp4",
                mime: "video/mp4",
                size: 2048,
              },
            },
          },
        },
      ], [], "project-a")[0];
      return {
        url: resource?.url,
        videoUrl: resource?.videoUrl,
        localPath: resource?.localPath,
        originalUrl: resource?.originalUrl,
        bindingPath: resource?.projectAssetBinding?.localPath,
      };
    })(),
    {
      url: "file:///Users/test/media/result.mp4",
      videoUrl: "file:///Users/test/media/result.mp4",
      localPath: "/Users/test/media/result.mp4",
      originalUrl: "https://temporary.example.com/result.mp4",
      bindingPath: "/Users/test/media/result.mp4",
    }
  );
  const expiringVideoResource = {
    id: "video-expiring",
    url: "https://temporary.example.com/result.mp4",
    videoUrl: "https://temporary.example.com/result.mp4",
    type: "video/mp4",
    source: "generated",
    pageUrl: "canvas:project-a",
  };
  check("generated remote video requires local persistence", wanjuanTransitResourceNeedsPersistence(expiringVideoResource), true);
  check(
    "persisted video rewrites both url and videoUrl to the local file",
    (() => {
      const resource = wanjuanApplyPersistedTransitResource(expiringVideoResource, {
        ok: true,
        assetId: "asset-video",
        localPath: "/Users/test/media/persisted.mp4",
        filename: "persisted.mp4",
        mime: "video/mp4",
        size: 4096,
        sha256: "abc",
        projectId: "project-a",
        nodeId: "transit-resource",
        field: "url",
        kind: "video",
        savedAt: "2026-07-15T00:00:00.000Z",
      });
      return {
        url: resource?.url,
        videoUrl: resource?.videoUrl,
        localPath: resource?.localPath,
        originalUrl: resource?.originalUrl,
        bindingPath: resource?.projectAssetBinding?.localPath,
      };
    })(),
    {
      url: "file:///Users/test/media/persisted.mp4",
      videoUrl: "file:///Users/test/media/persisted.mp4",
      localPath: "/Users/test/media/persisted.mp4",
      originalUrl: "https://temporary.example.com/result.mp4",
      bindingPath: "/Users/test/media/persisted.mp4",
    }
  );
  // wanjuanResourceKind
  check("kind text", wanjuanResourceKind({ type: "text" }), "text");
  check("kind audio mime", wanjuanResourceKind({ type: "audio/mp3" }), "audio");
  check("kind audio ext", wanjuanResourceKind({ url: "x.mp3" }), "audio");
  check("kind video", wanjuanResourceKind({ type: "video" }), "video");
  check("kind video ext", wanjuanResourceKind({ url: "clip.MOV" }), "video");
  check("kind image default", wanjuanResourceKind({ url: "a.webp" }), "image");
  check("kind data audio", wanjuanResourceKind({ url: "data:audio/wav;base64,xx" }), "audio");

  // Reference handles must only pass the selected output, and duplicate media must be removed.
  check(
    "reference grid cell excludes original image",
    wanjuanCollectNodeReferenceMedia({
      type: "gridSplitNode",
      data: { imageUrl: "https://cdn/original.png", extractedImages: ["https://cdn/cell-1.png", "https://cdn/cell-2.png"] }
    }, "cell-1"),
    { images: ["https://cdn/cell-2.png"], videos: [] }
  );
  check(
    "reference grid merge image is not duplicated",
    wanjuanCollectNodeReferenceMedia({ type: "gridMergeNode", data: { imageUrl: "https://cdn/merged.png" } }),
    { images: ["https://cdn/merged.png"], videos: [] }
  );
  check(
    "opaque generated image URL remains a connected image reference",
    wanjuanCollectNodeReferenceMedia({ type: "imageNode", data: { imageUrl: "https://media.example.invalid/content?id=opaque", mediaKind: "image" } }),
    { images: ["https://media.example.invalid/content?id=opaque"], videos: [] }
  );
  check(
    "explicit compatible image edit protocol uses multipart edits",
    wanjuanBuildOpenAiImageReferencePlan({ requestProtocol: "openai-images", referenceCount: 1, modelName: "Z-Image-Turbo", editPath: "/v1/images/edits", referenceImageField: "image[{index}]" }),
    { useEdit: true, editPath: "/v1/images/edits", referenceImageField: "image[{index}]", hasExplicitEditCapability: true }
  );
  check(
    "explicit edit endpoint uses the default image field when no custom field is needed",
    wanjuanBuildOpenAiImageReferencePlan({ requestProtocol: "openai-images", referenceCount: 1, modelName: "Z-Image-Turbo", editPath: "/v1/images/edits", referenceImageField: "image" }),
    { useEdit: true, editPath: "/v1/images/edits", referenceImageField: "image", hasExplicitEditCapability: true }
  );
  const capturedVideoReferences = [];
  check(
    "video request collection appends an opaque connected image",
    wanjuanAppendConnectedImageReferences(["https://media.example.invalid/content?id=opaque"], (url, meta) => capturedVideoReferences.push({ url, sourceNodeId: meta.sourceNodeId }), { sourceNodeId: "source-image" }),
    1
  );
  check(
    "video request capture contains the connected opaque image",
    capturedVideoReferences,
    [{ url: "https://media.example.invalid/content?id=opaque", sourceNodeId: "source-image" }]
  );
  const imageEditForm = new FormData();
  check(
    "image edit request appends one reference file",
    await wanjuanAppendImageReferenceFiles(imageEditForm, ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="], { fieldTemplate: "image[{index}]" }),
    1
  );
  check("image edit request uses indexed multipart field", [...imageEditForm.keys()], ["image[0]"]);
  let failedImageReferenceMessage = "";
  try {
    await wanjuanAppendImageReferenceFiles(new FormData(), ["https://media.example.invalid/missing"], {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
  } catch (error) {
    failedImageReferenceMessage = String(error?.message || error);
  }
  check("failed image edit reference blocks unreferenced fallback", failedImageReferenceMessage, "参考图读取失败（HTTP 404）");
  check(
    "plain OpenAI generation protocol does not invent edit support",
    wanjuanBuildOpenAiImageReferencePlan({ requestProtocol: "openai-images", referenceCount: 1, modelName: "dall-e-3" }),
    { useEdit: false, editPath: "", referenceImageField: "", hasExplicitEditCapability: false }
  );
  check(
    "vectorengine compatibility keeps its JSON reference path",
    wanjuanBuildOpenAiImageReferencePlan({ requestProtocol: "openai-images", referenceCount: 1, modelName: "gpt-image-1", vectorengineOpenAiCompatRequest: true, editPath: "/v1/images/edits", referenceImageField: "image" }),
    { useEdit: false, editPath: "/v1/images/edits", referenceImageField: "image", hasExplicitEditCapability: true }
  );
  check(
    "reference prefers matching local project binding over expiring public URL",
    wanjuanCollectNodeReferenceMedia({
      type: "imageNode",
      data: {
        imageUrl: "https://temporary.example.com/result.png",
        projectAssetBindings: {
          imageUrl: {
            ok: true,
            missing: false,
            localPath: "/Users/test/project/result.png",
            sourceSignature: "https://temporary.example.com/result.png"
          }
        }
      }
    }),
    { images: ["file:///Users/test/project/result.png"], videos: [] }
  );
  check(
    "reference ignores missing local project binding",
    wanjuanCollectNodeReferenceMedia({
      type: "imageNode",
      data: {
        imageUrl: "https://cdn.example.com/result.png",
        projectAssetBindings: {
          imageUrl: { ok: true, missing: true, localPath: "/Users/test/project/missing.png", sourceSignature: "https://cdn.example.com/result.png" }
        }
      }
    }),
    { images: ["https://cdn.example.com/result.png"], videos: [] }
  );
  check(
    "reference does not reuse binding from an older generated result",
    wanjuanCollectNodeReferenceMedia({
      type: "imageNode",
      data: {
        imageUrl: "https://cdn.example.com/new-result.png",
        projectAssetBindings: {
          imageUrl: { ok: true, missing: false, localPath: "/Users/test/project/old-result.png", sourceSignature: "https://cdn.example.com/old-result.png" }
        }
      }
    }),
    { images: ["https://cdn.example.com/new-result.png"], videos: [] }
  );
  const editedImagePersisted = {
    ok: true,
    assetId: "edited-asset",
    localPath: "/Users/test/project/edited.png",
    thumbnailLocalPath: "/Users/test/project/edited-thumb.png",
    filename: "edited.png",
    mime: "image/png",
    size: 2048,
    sha256: "edited-sha",
    projectId: "project-a",
    nodeId: "source-image",
    field: "imageUrl",
    kind: "image",
    savedAt: "2026-08-14T00:00:00.000Z",
  };
  const editedCanvasNodes = imageEditor.wanjuanApplyEditedImageToCanvasNodes([
    {
      id: "source-image",
      type: "imageNode",
      data: {
        imageUrl: "https://cdn.example.com/original.png",
        thumbnailUrl: "https://cdn.example.com/original-thumb.png",
        sourceOrigin: "tianji-portrait",
        tianjiPortraitAssetId: "portrait-id",
        tianjiPortraitBindingStatus: "ready",
        arkTrustedAssetId: "ark-id",
        arkTrustedAssetSourceUrl: "https://cdn.example.com/original.png",
        arkTrustedAssetStatus: "ready",
        projectAssetBindings: {
          imageUrl: { localPath: "/Users/test/project/original.png" },
          thumbnailUrl: { localPath: "/Users/test/project/original-thumb.png" },
        },
      },
    },
    {
      id: "target-node",
      data: {
        selectedContextResources: [{
          sourceNodeId: "source-image",
          url: "https://cdn.example.com/original.png",
          imageUrl: "https://cdn.example.com/original.png",
          tianjiPortraitAssetId: "portrait-id",
          tianjiPortraitBindingStatus: "ready",
        }],
      },
    },
    { id: "unrelated", data: { selectedContextResources: [{ url: "https://cdn.example.com/other.png" }] } },
  ], "source-image", { dataUrl: "data:image/png;base64,edited", persisted: editedImagePersisted, editedAt: 1723593600000 });
  const editedSourceData = editedCanvasNodes[0].data;
  check(
    "edited image replaces preview, binding and reviewed identity together",
    [
      editedSourceData.imageUrl,
      editedSourceData.thumbnailUrl,
      editedSourceData.projectAssetBindings.imageUrl.localPath,
      editedSourceData.projectAssetBindings.thumbnailUrl || null,
      editedSourceData.tianjiPortraitAssetId || null,
      editedSourceData.arkTrustedAssetId || null,
      editedSourceData.sourceOrigin,
    ],
    [
      "file:///Users/test/project/edited.png?wanjuan-edit=1723593600000",
      "file:///Users/test/project/edited-thumb.png?wanjuan-edit=1723593600000",
      "/Users/test/project/edited.png",
      null,
      null,
      null,
      "generated",
    ],
  );
  check(
    "edited image downstream reference resolves to the new local file",
    wanjuanCollectNodeReferenceMedia(editedCanvasNodes[0]),
    { images: ["file:///Users/test/project/edited.png"], videos: [] },
  );
  check(
    "edited image replaces matching cached context without touching unrelated context",
    [
      editedCanvasNodes[1].data.selectedContextResources[0].url,
      editedCanvasNodes[1].data.selectedContextResources[0].tianjiPortraitAssetId || null,
      editedCanvasNodes[2].data.selectedContextResources[0].url,
    ],
    ["file:///Users/test/project/edited.png?wanjuan-edit=1723593600000", null, "https://cdn.example.com/other.png"],
  );
  const samePathEditedData = imageEditor.wanjuanBuildEditedImageNodeData({
    imageUrl: "file:///Users/test/project/edited.png",
    sourceOrigin: "tianji-portrait",
    tianjiPortraitAssetId: "must-clear",
    tianjiPortraitBindingStatus: "ready",
    arkTrustedAssetId: "must-clear",
    arkTrustedAssetStatus: "ready",
  }, { persisted: editedImagePersisted, editedAt: 1723593600001 });
  check(
    "edited image clears reviewed identity even when persistence reuses the same path",
    [samePathEditedData.tianjiPortraitAssetId || null, samePathEditedData.arkTrustedAssetId || null, samePathEditedData.imageUrl],
    [null, null, "file:///Users/test/project/edited.png?wanjuan-edit=1723593600001"],
  );
  check(
    "image editor remote loader returns an origin-safe data URL",
    await imageEditor.wanjuanPrepareImageEditorSource(
      "https://cdn.example.com/result.webp",
      {
        proxyFetch: async () => ({
          ok: true,
          status: 200,
          headers: [["content-type", "image/webp"]],
          bodyBase64: "d2VicA==",
        }),
      },
    ),
    "data:image/webp;base64,d2VicA==",
  );
  check(
    "image editor opens the matching local project copy",
    imageEditor.wanjuanImageEditorSourceFromNodeData({
      imageUrl: "https://cdn.example.com/result.png",
      projectAssetBindings: {
        imageUrl: {
          ok: true,
          localPath: "/Users/test/project/result.png",
          sourceSignature: "https://cdn.example.com/result.png",
        },
      },
    }),
    "file:///Users/test/project/result.png",
  );
  check(
    "image editor refuses a local binding from an older result",
    imageEditor.wanjuanImageEditorSourceFromNodeData({
      imageUrl: "https://cdn.example.com/new.png",
      projectAssetBindings: {
        imageUrl: {
          ok: true,
          localPath: "/Users/test/project/old.png",
          sourceSignature: "https://cdn.example.com/old.png",
        },
      },
    }),
    "https://cdn.example.com/new.png",
  );
  check(
    "reference selected video frame excludes source video",
    wanjuanCollectNodeReferenceMedia({
      type: "videoExtractNode",
      data: {
        videoUrl: "https://cdn/source.mp4",
        extractedImages: ["https://cdn/frame-a.png"],
        allExtractedImages: ["https://cdn/frame-a.png"],
        hiddenIndices: []
      }
    }, "frame-0"),
    { images: ["https://cdn/frame-a.png"], videos: [] }
  );
  check("reference public https URL", wanjuanIsPublicHttpMediaUrl("https://cdn.example.com/audio.mp3"), true);
  check("reference localhost is private", wanjuanIsPublicHttpMediaUrl("http://localhost:8080/audio.mp3"), false);
  check("reference LAN URL is private", wanjuanIsPublicHttpMediaUrl("http://192.168.1.8/audio.mp3"), false);
  check("runtime Seedance receives API config", nodeRuntime.WANJUAN_API_CONFIG_NODE_TYPES.has("seedanceNode"), true);
  check("runtime Suno receives upload config", nodeRuntime.WANJUAN_UPLOAD_CONFIG_NODE_TYPES.has("musicNode"), true);
  check("runtime Qwen clone writes resources", nodeRuntime.WANJUAN_TRANSIT_RESOURCE_NODE_TYPES.has("qwenTtsCloneNode"), true);
  check("runtime Real-ESRGAN writes resources", nodeRuntime.WANJUAN_TRANSIT_RESOURCE_NODE_TYPES.has("realEsrganVideoNode"), true);
  check("runtime plain image avoids large API object", nodeRuntime.WANJUAN_API_CONFIG_NODE_TYPES.has("imageNode"), false);
  const persistedNodeData = {
    model: "grok-image-video",
    prompt: "keep prompt",
    videoUrl: "https://cdn.example.com/result.mp4",
    imageUrl: "https://cdn.example.com/reference.jpg",
    allExtractedImages: ["https://cdn.example.com/frame-1.jpg"],
    apiConfigs: [{ id: "runtime-only" }],
    modelProtocolRegistry: { runtime: true },
    wanjuanRenderMode: "lite",
    wanjuanRenderZoom: 0.5,
    arkTrustedAssetEnabled: true,
  };
  check(
    "runtime strip preserves generated results and model parameters",
    nodeRuntime.wanjuanStripRuntimeNodeData(persistedNodeData),
    {
      model: "grok-image-video",
      prompt: "keep prompt",
      videoUrl: "https://cdn.example.com/result.mp4",
      imageUrl: "https://cdn.example.com/reference.jpg",
      allExtractedImages: ["https://cdn.example.com/frame-1.jpg"],
    }
  );
  const stableNodeData = { model: "gpt-image-2", imageUrl: "https://cdn.example.com/result.png" };
  check("runtime strip keeps unchanged object identity", nodeRuntime.wanjuanStripRuntimeNodeData(stableNodeData) === stableNodeData, true);

  // wanjuanResourceSourceKind
  check("source generated", wanjuanResourceSourceKind({ source: "seedance" }), "generated");
  check("source external", wanjuanResourceSourceKind({ source: "upload" }), "external");

  // aspect ratio
  check("ratio colon", normalizeVideoAspectRatioValue("16:9"), "16:9");
  check("ratio from size", normalizeVideoAspectRatioValue("", "1920x1080"), "16:9");
  check("ratio fallback", normalizeVideoAspectRatioValue("garbage"), "16:9");
  check("size normalize", normalizeVideoSizeValue("1280 x 720"), "1280x720");
  check("size fallback", normalizeVideoSizeValue("nope"), "1280x720");
  check("jixin unified video contains wan t2v", WANJUAN_JIXIN_BUILTIN_UNIFIED_VIDEO_MODELS.includes("wan2.7-t2v-1080P"), true);
  check("jixin text catalog contains Claude Opus 5", WANJUAN_JIXIN_BUILTIN_TEXT_MODELS.includes("claude-opus-5"), true);
  check("jixin text catalog contains Gemini 3.8 Flash", WANJUAN_JIXIN_BUILTIN_TEXT_MODELS.includes("gemini-3.8-flash"), true);
  check("Claude Opus 5 uses the production type1 OpenAI contract", WANJUAN_JIXIN_BUILTIN_TEXT_PROTOCOLS["claude-opus-5"], "极鑫文本兼容");
  check("Gemini 3.8 Flash uses the production type1 OpenAI contract", WANJUAN_JIXIN_BUILTIN_TEXT_PROTOCOLS["gemini-3.8-flash"], "极鑫文本兼容");
  check("jixin image catalog contains Gemini 3.1 Flash Lite Image", WANJUAN_JIXIN_BUILTIN_IMAGE_MODELS.includes("gemini-3.1-flash-lite-image"), true);
  check("Gemini Flash Lite Image has an explicit native candidate binding", WANJUAN_JIXIN_BUILTIN_IMAGE_PROTOCOLS["gemini-3.1-flash-lite-image"], "极鑫 Gemini Lite 图片原生（实验）");
  check(
    "Gemini Flash Lite Image candidate stays native, experimental and fixed to 1K",
    WANJUAN_JIXIN_BUILTIN_PROTOCOLS["极鑫 Gemini Lite 图片原生（实验）"],
    {
      category: "image",
      requestType: "gemini-generate-content",
      submitPath: "/v1beta/models/{model}:generateContent",
      contentType: "application/json",
      experimental: true,
      parameterAdapter: { sizeValueMode: "preset", aspectRatioValueMode: "ratio", fixedImageSize: "1K" },
      validationNotes: [
        "Google 原生契约仅支持 1K；生产 type1 渠道尚无成功调用样本。",
        "参考图仅按 Gemini inline_data/file part 发送，不假定 OpenAI Images 编辑协议可用。",
      ],
      responseMapping: { image: ["candidates.0.content.parts.0.inlineData.data", "candidates.0.content.parts.0.inline_data.data"] },
    },
  );
  const nativeGeminiImageProtocol = WANJUAN_JIXIN_BUILTIN_PROTOCOLS["极鑫 Gemini Lite 图片原生（实验）"];
  check(
    "Jixin Gemini image transport uses bearer auth without leaking the key into the URL",
    wanjuanBuildGeminiImageTransport({ apiBaseUrl: "https://jixing.example.test", apiKey: "test-secret", model: "gemini-3.1-flash-lite-image", protocol: nativeGeminiImageProtocol }),
    {
      requestUrl: "https://jixing.example.test/v1beta/models/gemini-3.1-flash-lite-image:generateContent",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      fixedImageSize: "1K",
      directGoogleApi: false,
    },
  );
  check(
    "direct Google Gemini image transport keeps query-key auth",
    wanjuanBuildGeminiImageTransport({ apiBaseUrl: "https://generativelanguage.googleapis.com", apiKey: "test-secret", model: "gemini-3.1-flash-lite-image", protocol: nativeGeminiImageProtocol }),
    {
      requestUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent?key=test-secret",
      headers: { "Content-Type": "application/json" },
      fixedImageSize: "1K",
      directGoogleApi: true,
    },
  );
  const manuallyBoundModels = wanjuanApplyJixinBuiltinProtocolPatch({
    textModelProtocolBindings: { "claude-opus-5": "用户 Claude 协议" },
    textModelApiBindings: { "claude-opus-5": "manual-api" },
  });
  check("catalog migration preserves a manual protocol binding", manuallyBoundModels.textModelProtocolBindings["claude-opus-5"], "用户 Claude 协议");
  check("catalog migration preserves a manual API binding", manuallyBoundModels.textModelApiBindings["claude-opus-5"], "manual-api");
  const seededNewModels = wanjuanBuildJixinBuiltinBasePatch({
    textModel: "custom-text-model",
    textModelApiBindings: { "custom-text-model": "manual-api" },
    textModelProtocolBindings: { "custom-text-model": "用户文本协议" },
  });
  check("new built-in text models merge without deleting manual catalog entries", String(seededNewModels.textModel).split("\n").includes("custom-text-model"), true);
  check("new built-in text models keep manual API bindings", seededNewModels.textModelApiBindings["custom-text-model"], "manual-api");
  check("new built-in text models keep manual protocol bindings", seededNewModels.textModelProtocolBindings["custom-text-model"], "用户文本协议");
  const manualCatalogMigration = wanjuanMigrateJixinBuiltinCatalog({
    activeStoredGlobalConfigId: "manual-preset",
    textModel: "custom-text-model",
    drawingModel: "custom-image-model",
    textModelApiBindings: { "custom-text-model": "manual-api" },
    imageModelApiBindings: { "custom-image-model": "manual-api" },
    textModelProtocolBindings: { "custom-text-model": "用户文本协议" },
    imageModelProtocolBindings: { "custom-image-model": "用户图片协议" },
    storedGlobalConfigs: [{ id: "manual-preset", config: { textModel: "custom-text-model" } }],
  });
  check("catalog migration does not mix built-in text models into an active manual preset", manualCatalogMigration.textModel, "custom-text-model");
  check("catalog migration does not mix built-in image models into an active manual preset", manualCatalogMigration.drawingModel, "custom-image-model");
  check("catalog migration preserves active manual protocol maps", manualCatalogMigration.textModelProtocolBindings, { "custom-text-model": "用户文本协议" });
  check("catalog migration refreshes only the separate stored built-in preset", manualCatalogMigration.storedGlobalConfigs.some((config) => config.id === WANJUAN_JIXIN_BUILTIN_GLOBAL_CONFIG_ID && String(config.config.textModel).includes("claude-opus-5")), true);
  check("jixin unified video contains grok image video", WANJUAN_JIXIN_BUILTIN_UNIFIED_VIDEO_MODELS.includes("grok-image-video"), true);
  check("jixin grok image video protocol binding", WANJUAN_JIXIN_BUILTIN_VIDEO_PROTOCOL_BINDINGS["grok-image-video"], "极鑫 Grok Image Video 兼容");
  check(
    "jixin grok image video protocol uses scalar reference and dynamic controls",
    WANJUAN_JIXIN_BUILTIN_PROTOCOLS["极鑫 Grok Image Video 兼容"],
    {
      category: "video",
      parameterMode: "exact-resolution",
      requestType: "openai-video",
      submitPath: "/v1/videos",
      pollPath: "/v1/videos/{taskId}",
      contentPath: "/v1/videos/{taskId}/content",
      authType: "bearer",
      contentType: "application/json",
      referenceImageMode: "field",
      referenceImageAsArray: false,
      referenceImageItemShape: "string",
      fieldMapping: { model: "model", prompt: "prompt", resolution: "size", aspectRatio: "", duration: "seconds", referenceImage: "image", referenceVideo: "" },
      fieldValueTypes: { seconds: "string", size: "string" },
      parameterAdapter: { resolutionValueMode: "dimension", aspectRatioValueMode: "omit" },
      responseMapping: { video: ["video_url", "videoUrl", "data.video_url", "data.videoUrl", "data.0.url", "output.video_url", "result.video_url", "url"], taskId: ["id", "task_id", "data.id", "data.task_id"], status: ["status", "data.status", "state"], completedValues: ["completed", "complete", "success", "succeeded"], failedValues: ["failed", "error", "fail"] }
    }
  );
  check("jixin legacy grok binding migrates", wanjuanMergeJixinVideoProtocolDefaults({ "grok-image-video": "极鑫 Grok Image Video JSON" }, WANJUAN_JIXIN_BUILTIN_VIDEO_PROTOCOL_BINDINGS)["grok-image-video"], "极鑫 Grok Image Video 兼容");
  const customConfigBeforeJixinMigration = {
    id: "custom-config",
    name: "Custom Provider",
    config: {
      apiConfigs: [{ id: "custom-api", url: "https://custom.example.com", key: "custom-key" }],
      videoModel: "custom-video-only",
      videoModelApiBindings: { "custom-video-only": "custom-api" },
    },
  };
  const migratedJixinSettings = wanjuanSyncJixinBuiltinStoredGlobalConfig({
    activeStoredGlobalConfigId: "custom-config",
    apiConfigs: customConfigBeforeJixinMigration.config.apiConfigs,
    videoModel: "custom-video-only",
    storedGlobalConfigs: [customConfigBeforeJixinMigration],
  });
  const migratedBuiltinJixin = migratedJixinSettings.storedGlobalConfigs.find(
    (config) => config.id === WANJUAN_JIXIN_BUILTIN_GLOBAL_CONFIG_ID
  );
  check("jixin migration preserves active custom preset", migratedJixinSettings.activeStoredGlobalConfigId, "custom-config");
  check("jixin migration preserves custom preset snapshot", migratedJixinSettings.storedGlobalConfigs.find((config) => config.id === "custom-config"), customConfigBeforeJixinMigration);
  check("jixin migration does not import custom video models", String(migratedBuiltinJixin.config.videoModel).includes("custom-video-only"), false);
  check("jixin migration does not import custom API config", migratedBuiltinJixin.config.apiConfigs.some((config) => config.id === "custom-api"), false);
  check("jixin migration keeps the builtin API identity", migratedBuiltinJixin.config.apiConfigs[0].id, WANJUAN_JIXIN_DEFAULT_API_CONFIG_ID);
  check(
    "wan video edit aggregates video before image into one reference sequence",
    videoTask.wanjuanBuildReferenceMediaEntries([{ url: "https://cdn/image.png" }], ["https://cdn/video.mp4"], { kinds: ["image", "video"], order: "video-first" }),
    [{ kind: "video", value: "https://cdn/video.mp4" }, { kind: "image", value: "https://cdn/image.png" }]
  );
  check("video parameter mode resolves ratio quality", videoParameterMode.wanjuanResolveVideoParameterMode({ parameterAdapter: { resolutionValueMode: "aspect-ratio", aspectRatioValueMode: "omit" } }), "ratio-quality");
  check("video parameter mode resolves exact dimensions", videoParameterMode.wanjuanResolveVideoParameterMode({ parameterAdapter: { resolutionValueMode: "dimension" } }), "exact-resolution");
  check("video parameter mode resolves follow source", videoParameterMode.wanjuanResolveVideoParameterMode({ parameterAdapter: { resolutionValueMode: "omit", aspectRatioValueMode: "omit" } }), "follow-source");

  // config butler: tool hints must specialize per model, and fallback/invalid
  // results must not be selected for import automatically.
  const butlerContext = configButler.buildConfigButlerToolContext(
    "POST /v1/videos\nPOST /v1/chat/completions",
    "https://docs.example.com",
    { apiUrl: "https://api.example.com" }
  );
  check(
    "configButler specializes video request type",
    configButler.specializeConfigButlerToolContext(butlerContext, { modelName: "demo-video", category: "video" }).inferredRequestType,
    "openai-video"
  );
  check(
    "configButler specializes text request type",
    configButler.specializeConfigButlerToolContext(butlerContext, { modelName: "demo-chat", category: "text" }).inferredRequestType,
    "openai-chat"
  );
  const referencedOpenApiContext = configButler.buildConfigButlerToolContext(
    JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/v1/videos": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/VideoRequest" } }
              }
            },
            responses: { "200": { description: "ok" } }
          }
        }
      },
      components: {
        schemas: {
          VideoRequest: {
            type: "object",
            allOf: [
              { type: "object", properties: { model: { type: "string" }, prompt: { type: "string" } } },
              { type: "object", properties: { seconds: { type: "string" }, size: { type: "string" }, input_reference: { type: "string" } } }
            ]
          }
        }
      }
    }),
    "https://docs.example.com/openapi.json",
    { modelName: "configurable-video-model", category: "video", apiUrl: "https://api.example.com" }
  );
  check(
    "configButler resolves referenced video request fields",
    configButler.getButlerDocFieldsForPath(referencedOpenApiContext, "/v1/videos"),
    ["model", "prompt", "seconds", "size", "input_reference"]
  );
  check("configButler resolves referenced video request field types", configButler.getButlerDocFieldTypesForPath(referencedOpenApiContext, "/v1/videos").input_reference, "string");
  const repairedVideoProtocol = configButler.validateAndRepairConfigButlerResult({
    modelName: "configurable-video-model",
    category: "video",
    protocol: {
      name: "OpenAI 视频兼容",
      config: {
        category: "video",
        requestType: "openai-video",
        submitPath: "/v1/videos",
        pollPath: "/v1/videos/{taskId}",
        fieldMapping: {
          model: "model",
          prompt: "prompt",
          duration: "seconds",
          resolution: "size",
          aspectRatio: "",
          referenceImage: "input_reference"
        }
      }
    }
  }, {
    modelName: "configurable-video-model",
    category: "video",
    apiUrl: "https://api.example.com",
    toolContext: configButler.buildConfigButlerToolContext(
      "POST /v1/videos\n请求体示例只展示 model、prompt 和 input_reference，其他可选参数请参考完整 schema。",
      "https://docs.example.com/partial",
      { modelName: "configurable-video-model", category: "video", apiUrl: "https://api.example.com" }
    )
  });
  check("configButler partial docs preserve duration mapping", repairedVideoProtocol.protocol.config.fieldMapping.duration, "seconds");
  check("configButler partial docs preserve resolution mapping", repairedVideoProtocol.protocol.config.fieldMapping.resolution, "size");
  check("configButler partial docs do not force omit duration", repairedVideoProtocol.protocol.config.omitDuration === true, false);
  const noEvidenceVideoProtocol = configButler.validateAndRepairConfigButlerResult({
    modelName: "configurable-video-model",
    category: "video",
    protocol: { name: "OpenAI 视频兼容", config: { category: "video", requestType: "openai-video", submitPath: "/v1/videos", pollPath: "/v1/videos/{taskId}", fieldMapping: { referenceImage: "image", duration: "seconds", resolution: "size" }, referenceImageMode: "field", referenceImageAsArray: true } }
  }, { modelName: "configurable-video-model", category: "video", apiUrl: "https://api.example.com", toolContext: configButler.buildConfigButlerToolContext("plain text without endpoint schema", "https://docs.example.com", { category: "video" }) });
  check("configButler no-evidence OpenAI video preserves inferred reference field", noEvidenceVideoProtocol.protocol.config.fieldMapping.referenceImage, "image");
  check("configButler no-evidence OpenAI video uses scalar reference", noEvidenceVideoProtocol.protocol.config.referenceImageAsArray, false);
  check("configButler dry-run includes scalar reference", noEvidenceVideoProtocol.dryRun.requestBody.image, "https://example.com/reference.png");
  const aliasVideoFields = configButler.inferButlerVideoFieldMapping({
    openApi: { endpoints: [{ path: "/generate", requestKeys: ["model_id", "description", "duration_seconds", "dimensions", "ratio", "image_url"] }] },
    curlExamples: []
  }, "/generate", {});
  check(
    "configButler recognizes configurable video field aliases",
    aliasVideoFields.inferred,
    { model: "model_id", prompt: "description", duration: "duration_seconds", resolution: "dimensions", aspectRatio: "ratio", referenceImage: "image_url" }
  );
  check(
    "configButler recognizes text protocol fields",
    configButler.inferButlerProtocolFieldMapping({ openApi: { endpoints: [{ path: "/v1/responses", requestKeys: ["model", "input", "instructions", "max_output_tokens"] }] }, curlExamples: [] }, "/v1/responses", "text", "openai-responses", {}).inferred,
    { model: "model", input: "input", system: "instructions", maxTokens: "max_output_tokens" }
  );
  check(
    "configButler recognizes image protocol fields",
    configButler.inferButlerProtocolFieldMapping({ openApi: { endpoints: [{ path: "/images/generations", requestKeys: ["model_name", "description", "num_images", "image_size", "aspect_ratio", "reference_images"] }] }, curlExamples: [] }, "/images/generations", "image", "openai-images", {}).inferred,
    { model: "model_name", prompt: "description", count: "num_images", size: "image_size", aspectRatio: "aspect_ratio", referenceImage: "reference_images" }
  );
  check(
    "configButler recognizes audio speech protocol fields",
    configButler.inferButlerProtocolFieldMapping({ openApi: { endpoints: [{ path: "/audio/speech", requestKeys: ["model", "text", "voice_id", "audio_format", "rate"] }] }, curlExamples: [] }, "/audio/speech", "audio", "openai-audio-speech", {}).inferred,
    { model: "model", prompt: "text", input: "text", voice: "voice_id", format: "audio_format", speed: "rate" }
  );
  check(
    "configButler recognizes music protocol fields",
    configButler.inferButlerProtocolFieldMapping({ openApi: { endpoints: [{ path: "/music/generate", requestKeys: ["model", "lyrics", "song_title", "genre", "instrumental", "reference_audio"] }] }, curlExamples: [] }, "/music/generate", "music", "suno-music", {}).inferred,
    { model: "model", title: "song_title", tags: "genre", lyrics: "lyrics", instrumental: "instrumental", referenceAudio: "reference_audio" }
  );
  check(
    "configButler warns when all video controls are omitted",
    configButler.validateButlerProtocolConfig({ category: "video", requestType: "openai-video", submitPath: "/v1/videos", pollPath: "/v1/videos/{taskId}", fieldMapping: { duration: "", resolution: "", aspectRatio: "" } }).warnings.length > 0,
    true
  );
  check(
    "configButler repair preserves unrelated protocol fields",
    configButler.mergeButlerProtocolRepair(
      { fieldMapping: { prompt: "prompt", duration: "seconds", resolution: "size", referenceImage: "input_reference" }, parameterAdapter: { resolutionValueMode: "dimension" } },
      { fieldMapping: { referenceImage: "image_url", duration: "", resolution: "" } },
      "input_reference must be a string"
    ),
    { fieldMapping: { prompt: "prompt", duration: "seconds", resolution: "size", referenceImage: "image_url" }, parameterAdapter: { resolutionValueMode: "dimension" }, fieldValueTypes: {}, responseMapping: {}, extraBody: {} }
  );
  check(
    "configButler repair may remove explicitly rejected field",
    configButler.mergeButlerProtocolRepair(
      { fieldMapping: { prompt: "prompt", duration: "seconds", resolution: "size" } },
      { fieldMapping: { duration: "" }, omitDuration: true },
      "unknown parameter seconds"
    ).fieldMapping.duration,
    ""
  );
  const fallbackButlerItem = configButler.normalizeButlerBatchItems(
    { models: [] },
    ["missing-video-model"],
    { apiUrl: "https://api.example.com", toolContext: butlerContext }
  )[0];
  check("configButler fallback source", fallbackButlerItem.inferenceSource, "fallback");
  check("configButler fallback disabled", fallbackButlerItem.enabled, false);
  const renormalizedFallbackItem = configButler.normalizeButlerBatchItems(
    { models: [fallbackButlerItem] },
    ["missing-video-model"],
    { apiUrl: "https://api.example.com", toolContext: butlerContext }
  )[0];
  check("configButler fallback source survives normalization", renormalizedFallbackItem.inferenceSource, "fallback");
  check("configButler fallback disabled survives normalization", renormalizedFallbackItem.enabled, false);
  const invalidButlerItem = configButler.normalizeButlerBatchItems(
    { models: [{ modelName: "mystery-motion", category: "video", protocol: { name: "Custom", config: { category: "video", requestType: "custom", submitPath: "/submit" } } }] },
    ["mystery-motion"],
    { apiUrl: "https://api.example.com" }
  )[0];
  check("configButler invalid protocol disabled", invalidButlerItem.enabled, false);

  check(
    "stored global API configs replace rather than mix providers",
    replaceGlobalConfigApiConfigs([
      { id: "custom", name: "Custom", url: "https://custom.example.com", key: "custom-key" },
    ]),
    [
      {
        id: "custom",
        name: "Custom",
        url: "https://custom.example.com",
        key: "custom-key",
        protocolFormat: "auto",
      },
    ]
  );
  check(
    "switching stored global config preserves unrelated API entries",
    mergeGlobalConfigApiConfigs(
      [
        { id: "primary", name: "Old Primary", url: "https://old.example.com", key: "old-key" },
        { id: "utility", name: "Utility", url: "https://utility.example.com", key: "utility-key" },
      ],
      [
        { id: "primary", name: "New Primary", url: "https://new.example.com", key: "new-key" },
        { id: "batch", name: "Batch", url: "https://batch.example.com", key: "batch-key" },
      ],
    ),
    [
      { id: "primary", name: "New Primary", url: "https://new.example.com", key: "new-key", protocolFormat: "auto" },
      { id: "utility", name: "Utility", url: "https://utility.example.com", key: "utility-key", protocolFormat: "auto" },
      { id: "batch", name: "Batch", url: "https://batch.example.com", key: "batch-key", protocolFormat: "auto" },
    ],
  );
  check(
    "manual model resets when switched config no longer contains it",
    WanJuanShouldAutoPreferredModel("jixin-video-a\njixin-video-b", "custom-video-x", { manual: true }),
    true
  );
  check(
    "manual model remains when switched config still contains it",
    WanJuanShouldAutoPreferredModel("jixin-video-a\njixin-video-b", "jixin-video-b", { manual: true }),
    false
  );
  check(
    "task refresh does not send an old provider task with the current provider key",
    resolveTaskApiCredential({
      apiConfigs: [{ id: "jixin", url: "https://jixing.example.com", key: "jixin-key" }],
      taskApiConfigId: "custom",
      taskApiBaseUrl: "https://custom.example.com",
      currentApiUrl: "https://jixing.example.com",
      currentApiKey: "jixin-key",
    }),
    {
      baseUrl: "https://custom.example.com",
      key: "",
      matchedConfig: null,
      missingOriginalConfig: true,
    }
  );
  check(
    "task refresh may reuse the current key when the original base URL is unchanged",
    resolveTaskApiCredential({
      apiConfigs: [{ id: "jixin-new-id", url: "https://jixing.example.com", key: "new-key" }],
      taskApiConfigId: "jixin-old-id",
      taskApiBaseUrl: "https://jixing.example.com/",
      currentApiUrl: "https://jixing.example.com",
      currentApiKey: "new-key",
    }),
    {
      baseUrl: "https://jixing.example.com",
      key: "new-key",
      matchedConfig: {
        id: "jixin-new-id",
        url: "https://jixing.example.com",
        key: "new-key",
      },
      missingOriginalConfig: false,
    }
  );
  check(
    "task refresh can find credentials in an inactive stored global config",
    collectTaskCredentialConfigs(
      [{ id: "jixin", url: "https://jixing.example.com", key: "jixin-key" }],
      [{
        id: "custom-preset",
        config: {
          apiConfigs: [{ id: "custom", url: "https://custom.example.com", key: "custom-key" }],
        },
      }]
    ).map(({ id, url, key }) => ({ id, url, key })),
    [
      { id: "jixin", url: "https://jixing.example.com", key: "jixin-key" },
      { id: "custom", url: "https://custom.example.com", key: "custom-key" },
    ]
  );
  check(
    "async video refresh reuses the exact poll URL captured at submission",
    resolveTaskPollUrl({
      baseUrl: "https://new-active.example.com",
      pollPath: "/v1/videos/{taskId}",
      storedPollUrl: "https://original.example.com/jobs/remote-123",
      taskId: "remote-123",
    }),
    "https://original.example.com/jobs/remote-123"
  );
  check("older async settings save cannot overwrite a newer config", isCurrentSettingsSave(12, 11), false);
  check("latest async settings save may commit", isCurrentSettingsSave(12, 12), true);
  check(
    "task credential matching does not confuse identical API ids across presets",
    resolveTaskApiCredential({
      apiConfigs: [
        { id: "default", url: "https://active.example.com", key: "active-key" },
        { id: "default", url: "https://original.example.com", key: "original-key" },
      ],
      taskApiConfigId: "default",
      taskApiBaseUrl: "https://original.example.com",
      currentApiUrl: "https://active.example.com",
      currentApiKey: "active-key",
    }).key,
    "original-key"
  );

  // global task de-dupe: manual stop/status changes should not create duplicate active rows,
  // but completed results and a new generation after stop must stay visible.
  check(
    "globalTasks merge duplicate running/stopped video task",
    compactGlobalTasks([
      {
        id: "task-remote-1",
        type: "video",
        provider: "seedance",
        modelName: "doubao-seedance-2-0",
        projectId: "p1",
        nodeId: "n1",
        status: "pending",
        progress: 0,
        createdAt: 1000,
        prompt: "same prompt",
      },
      {
        id: "video-local-n1-1001",
        type: "video",
        provider: "seedance",
        modelName: "doubao-seedance-2-0",
        projectId: "p1",
        nodeId: "n1",
        status: "failed",
        progress: 0,
        createdAt: 1001,
        updatedAt: 1002,
        prompt: "same prompt",
        stoppedByUser: true,
        errorMsg: "已手动停止",
      },
    ]).map((task) => ({ id: task.id, status: task.status, stoppedByUser: task.stoppedByUser, errorMsg: task.errorMsg })),
    [{ id: "task-remote-1", status: "failed", stoppedByUser: true, errorMsg: "已手动停止" }]
  );
  check(
    "globalTasks keeps completed video history",
    compactGlobalTasks([
      {
        id: "task-done-1",
        type: "video",
        provider: "seedance",
        modelName: "doubao-seedance-2-0",
        projectId: "p1",
        nodeId: "n1",
        status: "completed",
        progress: 100,
        resultUrl: "https://cdn/a.mp4",
        createdAt: 1000,
        prompt: "same prompt",
      },
      {
        id: "task-done-2",
        type: "video",
        provider: "seedance",
        modelName: "doubao-seedance-2-0",
        projectId: "p1",
        nodeId: "n1",
        status: "completed",
        progress: 100,
        resultUrl: "https://cdn/b.mp4",
        createdAt: 2000,
        prompt: "same prompt",
      },
    ]).map((task) => task.id),
    ["task-done-2", "task-done-1"]
  );
  check(
    "globalTasks keeps new run after manual stop",
    compactGlobalTasks([
      {
        id: "task-stopped-1",
        type: "video",
        provider: "tongyi-wanxiang",
        modelName: "wan2.1",
        projectId: "p1",
        nodeId: "n1",
        status: "failed",
        progress: 0,
        createdAt: 1000,
        updatedAt: 1200,
        prompt: "same prompt",
        stoppedByUser: true,
      },
      {
        id: "task-new-2",
        type: "video",
        provider: "tongyi-wanxiang",
        modelName: "wan2.1",
        projectId: "p1",
        nodeId: "n1",
        status: "running",
        progress: 10,
        createdAt: 1300,
        prompt: "same prompt",
      },
    ]).map((task) => task.id),
    ["task-new-2", "task-stopped-1"]
  );
  check(
    "globalTasks supersedes an older active run on the same node",
    supersedeActiveNodeTasks(
      [
        { id: "old-active", nodeId: "n1", status: "running", progress: 12 },
        { id: "other-node", nodeId: "n2", status: "running", progress: 40 },
        { id: "old-done", nodeId: "n1", status: "completed", progress: 100 },
      ],
      "n1",
      5000
    ).map((task) => ({
      id: task.id,
      status: task.status,
      progress: task.progress,
      errorMsg: task.errorMsg,
      supersededByNewRun: task.supersededByNewRun,
      updatedAt: task.updatedAt,
    })),
    [
      {
        id: "old-active",
        status: "failed",
        progress: 12,
        errorMsg: "已被同节点的新任务替代",
        supersededByNewRun: true,
        updatedAt: 5000,
      },
      {
        id: "other-node",
        status: "running",
        progress: 40,
      },
      {
        id: "old-done",
        status: "completed",
        progress: 100,
      },
    ]
  );
  check(
    "stale video run cannot restore progress after being superseded",
    applyRunScopedStateUpdate(
      [{ id: "old-active", status: "failed", progress: 12, supersededByNewRun: true }],
      (tasks) => tasks.map((task) => ({ ...task, status: "running", progress: 40 })),
      false
    ),
    [{ id: "old-active", status: "failed", progress: 12, supersededByNewRun: true }]
  );
  check(
    "running task progress clears an earlier error message",
    updateTaskRunningProgress(
      { id: "retrying", status: "failed", progress: 0, errorMsg: "old provider error" },
      12
    ),
    { id: "retrying", status: "running", progress: 12, errorMsg: undefined }
  );
  const refreshFailureTasks = failGlobalTaskRefresh(
    [{ id: "remote-video", status: "running", progress: 87 }],
    "remote-video",
    "任务查询认证失败（401）"
  );
  check("401 refresh failure stops automatic task polling", refreshFailureTasks[0].status, "failed");
  check("401 refresh failure replaces stale progress error", refreshFailureTasks[0].errorMsg, "任务查询认证失败（401）");
  const indexedTasks = Array.from({ length: 1200 }, (_, index) => ({
    id: `indexed-task-${index}`,
    projectId: `p${index % 3}`,
    nodeId: `n${index % 40}`,
    prompt: `prompt-${index % 25}`,
    createdAt: index,
    status: index % 7 === 0 ? "running" : "completed",
    type: "video",
  }));
  const globalTaskIndex = indexGlobalTasks(indexedTasks);
  check("globalTasks index keeps every task id", globalTaskIndex.byId.size, 1200);
  check(
    "globalTasks node index newest first",
    globalTaskIndex.byNode.get("p0::n0")?.slice(0, 3).map((task) => task.createdAt),
    [1080, 960, 840]
  );

  // Tianji defaults
  check("tianji app default base url remains jixin relay", WANJUAN_TIANJI_DEFAULT_BASE_URL, "https://jixing.guancn.uk");
  const localPreviewScopeA = await wanjuanTianjiLocalPreviewScope({ baseUrl: "https://jixing.guancn.uk", token: "preview-token-a" });
  const localPreviewScopeAWithBearer = await wanjuanTianjiLocalPreviewScope({ baseUrl: "https://jixing.guancn.uk/", token: "Bearer preview-token-a" });
  const localPreviewScopeB = await wanjuanTianjiLocalPreviewScope({ baseUrl: "https://jixing.guancn.uk", token: "preview-token-b" });
  check("tianji local preview scope normalizes Bearer without storing token", {
    same: localPreviewScopeA === localPreviewScopeAWithBearer,
    isolated: localPreviewScopeA !== localPreviewScopeB,
    leaksToken: localPreviewScopeA.includes("preview-token"),
  }, { same: true, isolated: true, leaksToken: false });
  const localPreviewEntry = {
    scope: localPreviewScopeA,
    groupType: "AIGC",
    groupId: "group-a",
    assetId: "asset-local-preview",
    localPath: "/Users/test/preview.jpg",
    previewUrl: "file:///Users/test/preview.jpg",
    updatedAt: 1,
  };
  const localPreviewKey = wanjuanTianjiLocalPreviewEntryKey(localPreviewEntry);
  const localPreviewRegistry = wanjuanNormalizeTianjiLocalPreviewRegistry({ version: 1, entries: { [localPreviewKey]: localPreviewEntry, bad: { ...localPreviewEntry, previewUrl: "data:image/png;base64,large" } }, pending: {} });
  check("tianji local preview registry rejects embedded data URLs", Object.keys(localPreviewRegistry.entries), [localPreviewKey]);
  check("tianji local preview lookup is identity and group isolated", {
    matching: wanjuanFindTianjiLocalPreview(localPreviewRegistry, localPreviewEntry)?.previewUrl,
    otherIdentity: wanjuanFindTianjiLocalPreview(localPreviewRegistry, { ...localPreviewEntry, scope: localPreviewScopeB }),
    otherGroup: wanjuanFindTianjiLocalPreview(localPreviewRegistry, { ...localPreviewEntry, groupId: "group-b" }),
  }, { matching: "file:///Users/test/preview.jpg", otherIdentity: null, otherGroup: null });
  const removedLocalPreview = wanjuanRemoveTianjiLocalPreviewFromRegistry(localPreviewRegistry, localPreviewEntry);
  check("tianji remote delete cleanup removes only the exact local preview mapping", {
    removed: removedLocalPreview.removed,
    matching: wanjuanFindTianjiLocalPreview(removedLocalPreview.registry, localPreviewEntry),
    originalStillPresent: wanjuanFindTianjiLocalPreview(localPreviewRegistry, localPreviewEntry)?.previewUrl,
  }, { removed: true, matching: null, originalStillPresent: "file:///Users/test/preview.jpg" });
  check("tianji invalid generation mode falls back to text", wanjuanNormalizeTianjiGenerationMode("legacy-unknown"), "text-to-video");
  check("tianji text generation stays on relay api namespace", wanjuanBuildTianjiGenerationRequest({ mode: "text-to-video", common: { prompt: "mock" } }).endpoint, "/api/cut/model/coze-seedance-text-special");
  check("tianji text generation explicitly uses official form encoding", wanjuanBuildTianjiGenerationRequest({ mode: "text-to-video", common: { prompt: "mock" } }).encoding, "form");
  check("tianji first-frame generation stays on relay api namespace", wanjuanBuildTianjiGenerationRequest({ mode: "first-frame", common: { prompt: "mock" }, imageUrls: ["https://media.example.invalid/first.png"] }).endpoint, "/api/cut/model/coze-seedance-image-first-special");
  check("tianji first-last request uses official fields", wanjuanBuildTianjiGenerationRequest({ mode: "first-last", common: { prompt: "mock" }, imageUrls: ["https://media.example.invalid/first.png", "https://media.example.invalid/last.png"] }), {
    endpoint: "/api/cut/model/coze-seedance-image-first-last-special",
    payload: { prompt: "mock", first_frame: "https://media.example.invalid/first.png", last_frame: "https://media.example.invalid/last.png" },
    generationMode: "first-last",
    encoding: "form"
  });
  check("tianji reference request preserves official bracket array fields", wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" }, imageUrls: ["https://media.example.invalid/portrait.jpg"], videoUrls: ["https://media.example.invalid/reference.mp4"], audioUrls: ["https://media.example.invalid/reference.mp3"] }), {
    endpoint: "/api/cut/model/coze-seedance-video-special",
    payload: { prompt: "mock", "images[]": ["https://media.example.invalid/portrait.jpg"], "videos[]": ["https://media.example.invalid/reference.mp4"], "audios[]": ["https://media.example.invalid/reference.mp3"] },
    generationMode: "reference-media",
    encoding: "form"
  });
  check("tianji reference request appends typed reviewed portraits before ordinary images", wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" }, portraitAssetIds: ["reviewed-one"], reviewedPortraitClaimCount: 1, imageUrls: ["https://media.example.invalid/plain.jpg"] }).payload["images[]"], ["asset://reviewed-one", "https://media.example.invalid/plain.jpg"]);
  let lostPortraitClaimMessage = "";
  try { wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" }, reviewedPortraitClaimCount: 1, imageUrls: ["https://media.example.invalid/preview.jpg"] }); } catch (error) { lostPortraitClaimMessage = String(error?.message || error); }
  check("tianji request builder blocks lost reviewed portrait ids", lostPortraitClaimMessage, "天玑已审核人像素材 ID 在生成前丢失，已阻止使用预览图片替代");
  let emptyReferenceMessage = "";
  try { wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" } }); } catch (error) { emptyReferenceMessage = error.message; }
  check("tianji reference request rejects empty media before network", emptyReferenceMessage, "天玑参考素材生视频需要连接至少一项图片、视频或音频参考素材");
  check("ordinary image remains an ordinary HTTPS reference", await wanjuanTianjiMediaUrl({ id: "ordinary-image", url: "https://media.example.invalid/plain.png" }), "https://media.example.invalid/plain.png");
  let foreignAssetReferenceMessage = "";
  try { await wanjuanTianjiMediaUrl("asset://official-compatible-only"); } catch (error) { foreignAssetReferenceMessage = error.message; }
  check("tianji rejects foreign asset scheme references", foreignAssetReferenceMessage, "即梦天玑参考素材只接受 HTTP(S) 地址，当前素材属于其他兼容模式，不能直接用于天玑生成");
  let pendingPortraitMessage = "";
  try { await wanjuanTianjiMediaUrl({ mediaSourceOrigin: "tianji-portrait", tianjiPortraitBindingStatus: "pending", url: "https://media.example.invalid/unreviewed.png" }); } catch (error) { pendingPortraitMessage = error.message; }
  check("unreviewed tianji portrait cannot fall back to ordinary image upload", pendingPortraitMessage, "这张天玑人像尚未完成审核和素材绑定");
  let unverifiedPortraitMessage = "";
  try { await wanjuanTianjiMediaUrl({ mediaSourceOrigin: "tianji-portrait", tianjiPortraitAssetId: "legacy-unverified", url: "https://media.example.invalid/legacy.png" }); } catch (error) { unverifiedPortraitMessage = error.message; }
  check("legacy tianji portrait id without Active proof cannot generate", unverifiedPortraitMessage, "这张天玑人像缺少 Active 状态证明，请刷新人像库后重新选择");
  const reviewedPortraitNodeData = {
    imageUrl: "https://media.example.invalid/display-preview.jpg",
    tianjiPortraitPreviewUrl: "https://media.example.invalid/signed-preview.jpg",
    tianjiPortraitAssetId: "active-verified",
    tianjiPortraitBindingStatus: "ready",
    sourceOrigin: "tianji-portrait",
    isTianjiPortrait: true,
  };
  const stalePortraitNode = { id: "portrait-node", data: { imageUrl: "https://media.example.invalid/stale-preview.jpg" } };
  const currentPortraitNode = { id: "portrait-node", data: reviewedPortraitNodeData };
  const preferredPortraitNode = wanjuanPreferCurrentCanvasNodes([currentPortraitNode], [stalePortraitNode])[0];
  check("current canvas state replaces stale HTTP-only portrait snapshot", {
    sameObject: preferredPortraitNode === currentPortraitNode,
    assetId: preferredPortraitNode.data.tianjiPortraitAssetId,
    status: preferredPortraitNode.data.tianjiPortraitBindingStatus,
  }, { sameObject: true, assetId: "active-verified", status: "ready" });
  check("manual portrait reference from preferred state resolves to asset scheme", await wanjuanTianjiMediaUrl(wanjuanTianjiPortraitReferenceFromNodeData(preferredPortraitNode.data)), "asset://active-verified");
  const preferredFallbackPortraitNode = wanjuanPreferCurrentCanvasNodes([stalePortraitNode], [currentPortraitNode])[0];
  check("reviewed binding wins when React state is the stale snapshot", {
    sameObject: preferredFallbackPortraitNode === currentPortraitNode,
    assetId: preferredFallbackPortraitNode.data.tianjiPortraitAssetId,
    status: preferredFallbackPortraitNode.data.tianjiPortraitBindingStatus,
  }, { sameObject: true, assetId: "active-verified", status: "ready" });
  check("reverse stale snapshot competition still resolves to asset scheme", await wanjuanTianjiMediaUrl(wanjuanTianjiPortraitReferenceFromNodeData(preferredFallbackPortraitNode.data)), "asset://active-verified");
  check("reviewed portrait claim is detected before generic URL collection", wanjuanHasTianjiPortraitClaim(reviewedPortraitNodeData), true);
  check("reviewed portrait ready binding requires trusted source and id", wanjuanIsReadyTianjiPortraitBinding(reviewedPortraitNodeData), true);
  const rebuiltPortraitReference = wanjuanTianjiPortraitReferenceFromNodeData(reviewedPortraitNodeData);
  check("reviewed portrait node metadata survives reference rebuilding", {
    url: rebuiltPortraitReference.url,
    assetId: rebuiltPortraitReference.tianjiPortraitAssetId,
    status: rebuiltPortraitReference.tianjiPortraitBindingStatus,
    sourceOrigin: rebuiltPortraitReference.sourceOrigin,
  }, {
    url: "https://media.example.invalid/display-preview.jpg",
    assetId: "active-verified",
    status: "ready",
    sourceOrigin: "tianji-portrait",
  });
  check("rebuilt reviewed portrait resolves to asset reference", await wanjuanTianjiMediaUrl(rebuiltPortraitReference), "asset://active-verified");
  const manualTargetNode = { id: "manual-target", data: { selectedContextResources: [] } };
  const manualPortraitInputs = wanjuanCollectTianjiManualPortraitInputs({
    nodes: wanjuanPreferCurrentCanvasNodes([currentPortraitNode, manualTargetNode], [stalePortraitNode, manualTargetNode]),
    incomingEdges: [{ source: "portrait-node", target: "manual-target" }],
    contextResources: [],
  });
  check("manual generateVideo chain extracts a typed portrait id despite a stale HTTP snapshot", {
    ids: manualPortraitInputs.portraitAssetIds,
    claims: manualPortraitInputs.reviewedPortraitClaimCount,
    claimedSource: manualPortraitInputs.claimedSourceNodeIds.has("portrait-node"),
    previewCount: manualPortraitInputs.portraitPreviewUrls.size,
  }, { ids: ["active-verified"], claims: 1, claimedSource: true, previewCount: 2 });
  check("manual generateVideo removes stale reviewed portrait previews from ordinary images", wanjuanExcludeTianjiPortraitPreviews([
    "https://media.example.invalid/display-preview.jpg",
    { url: "https://media.example.invalid/signed-preview.jpg" },
  ], manualPortraitInputs.portraitPreviewUrls), []);
  check("manual generateVideo preserves a genuinely ordinary reference image", wanjuanExcludeTianjiPortraitPreviews([
    "https://media.example.invalid/display-preview.jpg",
    "https://media.example.invalid/ordinary-reference.jpg",
  ], manualPortraitInputs.portraitPreviewUrls), ["https://media.example.invalid/ordinary-reference.jpg"]);
  check("manual generateVideo removes a re-uploaded URL from the same reviewed source node", wanjuanExcludeTianjiPortraitPreviews([
    { url: "https://uploads.example.invalid/reuploaded-preview.jpg", sourceNodeId: "portrait-node" },
    { url: "https://media.example.invalid/ordinary-reference.jpg", sourceNodeId: "ordinary-node" },
  ], manualPortraitInputs.portraitPreviewUrls, manualPortraitInputs.claimedSourceNodeIds), [
    { url: "https://media.example.invalid/ordinary-reference.jpg", sourceNodeId: "ordinary-node" },
  ]);
  const duplicateManualPortraitInputs = wanjuanCollectTianjiManualPortraitInputs({
    nodes: [currentPortraitNode, manualTargetNode],
    incomingEdges: [
      { source: "portrait-node", target: "manual-target" },
      { source: "portrait-node", target: "manual-target" },
    ],
  });
  check("manual reviewed portrait count deduplicates repeated edges", duplicateManualPortraitInputs.reviewedPortraitClaimCount, 1);
  const historicalContextPortraitInputs = wanjuanCollectTianjiManualPortraitInputs({
    nodes: [currentPortraitNode, manualTargetNode],
    incomingEdges: [{ source: "portrait-node", target: "manual-target" }],
    contextResources: [{ id: "portrait-node", sourceId: "portrait-node", type: "image", url: "https://uploads.example.invalid/reuploaded-preview.jpg" }],
  });
  check("manual reviewed portrait claims a metadata-stripped historical context by source id", {
    ids: historicalContextPortraitInputs.portraitAssetIds,
    claimedContext: historicalContextPortraitInputs.claimedContextIndexes.has(0),
  }, { ids: ["active-verified"], claimedContext: true });
  const reviewedNode = (id, assetId, revision, imageName) => ({
    id,
    type: "imageNode",
    data: {
      imageUrl: `https://media.example.invalid/${imageName}.jpg`,
      tianjiPortraitPreviewUrl: `https://preview.example.invalid/${imageName}.jpg`,
      tianjiPortraitBindingSourceUrl: `https://media.example.invalid/${imageName}.jpg`,
      tianjiPortraitAssetId: assetId,
      tianjiPortraitBindingStatus: "ready",
      tianjiPortraitBindingRevision: revision || undefined,
      sourceOrigin: "tianji-portrait",
      isTianjiPortrait: true,
    },
  });
  const captureManualTianjiForm = ({ nodes, edges, renderedNodes = [], refNodes = [] }) => {
    const snapshot = wanjuanResolveTianjiGenerationCanvasSnapshot({ nodes, renderedNodes, refNodes });
    if (snapshot.portraitConflictCount) throw Error(WANJUAN_TIANJI_PORTRAIT_SYNC_ERROR);
    const target = snapshot.nodes.find((node) => node.id === "target");
    const incomingEdges = edges.filter((edge) => edge.target === "target");
    const inputs = wanjuanCollectTianjiManualPortraitInputs({
      nodes: snapshot.nodes,
      incomingEdges,
      contextResources: target?.data?.selectedContextResources || [],
    });
    const imageReferences = [];
    incomingEdges.forEach((edge) => {
      const source = snapshot.nodes.find((node) => node.id === edge.source);
      if (source && !wanjuanHasTianjiPortraitClaim(source.data) && source.data?.imageUrl)
        imageReferences.push({ url: source.data.imageUrl, sourceNodeId: source.id });
    });
    (target?.data?.selectedContextResources || []).forEach((resource, index) => {
      if (!inputs.claimedContextIndexes.has(index)) imageReferences.push(resource);
    });
    const filtered = wanjuanFilterTianjiPortraitPreviews(imageReferences, inputs.portraitPreviewUrls, inputs.claimedSourceNodeIds);
    const request = wanjuanBuildTianjiGenerationRequest({
      mode: "reference-media",
      common: { prompt: "mock" },
      imageUrls: filtered.references.map((reference) => String(typeof reference === "string" ? reference : reference.url || "")),
      portraitAssetIds: inputs.portraitAssetIds,
      reviewedPortraitClaimCount: inputs.reviewedPortraitClaimCount,
      reviewedPortraitResidualCount: inputs.reviewedPortraitResidualCount + filtered.reviewedPortraitResidualCount,
      portraitConflictCount: snapshot.portraitConflictCount,
    });
    const form = new URLSearchParams();
    Object.entries(request.payload).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
      else form.append(key, String(value));
    });
    const profile = inspectTianjiGenerationRequest({
      url: `https://api.example.invalid${request.endpoint}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      tianjiGenerationProfile: {
        reviewedPortraitCount: inputs.reviewedPortraitClaimCount,
        ordinaryImageCount: filtered.references.length,
        reviewedPortraitResidualCount: inputs.reviewedPortraitResidualCount + filtered.reviewedPortraitResidualCount,
        portraitConflictCount: snapshot.portraitConflictCount,
      },
    }, Buffer.from(form.toString()));
    validateTianjiGenerationRequest(profile);
    return { snapshot, inputs, filtered, request, profile };
  };
  const portraitARevision1 = reviewedNode("portrait-source", "portrait-a", 1, "portrait-a");
  const portraitBRevision2 = reviewedNode("portrait-source", "portrait-b", 2, "portrait-b");
  const targetNode = { id: "target", type: "seedanceNode", data: { seedanceMode: "tianji", selectedContextResources: [] } };
  const replacedPortraitCapture = captureManualTianjiForm({
    nodes: [portraitBRevision2, targetNode],
    edges: [{ source: "portrait-source", target: "target" }],
    renderedNodes: [portraitARevision1, targetNode],
    refNodes: [portraitARevision1, targetNode],
  });
  check("A to B uses only authoritative B when rendered and ref snapshots still hold A", {
    values: replacedPortraitCapture.request.payload["images[]"],
    schemes: replacedPortraitCapture.profile.media.images,
    conflicts: replacedPortraitCapture.snapshot.portraitConflictCount,
    stale: replacedPortraitCapture.snapshot.stalePortraitSnapshotCount,
  }, {
    values: ["asset://portrait-b"],
    schemes: { count: 1, asset: 1, http: 0, other: 0 },
    conflicts: 0,
    stale: 2,
  });
  const historicalContextTarget = {
    ...targetNode,
    data: {
      ...targetNode.data,
      selectedContextResources: [{ sourceId: "portrait-source", type: "image", url: "https://media.example.invalid/portrait-a.jpg" }],
    },
  };
  const historicalContextCapture = captureManualTianjiForm({
    nodes: [portraitBRevision2, historicalContextTarget],
    edges: [{ source: "portrait-source", target: "target" }],
  });
  check("B edge claims and removes metadata-stripped historical A context", {
    values: historicalContextCapture.request.payload["images[]"],
    residuals: historicalContextCapture.inputs.reviewedPortraitResidualCount,
    schemes: historicalContextCapture.profile.media.images,
  }, {
    values: ["asset://portrait-b"],
    residuals: 1,
    schemes: { count: 1, asset: 1, http: 0, other: 0 },
  });
  let disconnectedMessage = "";
  try { captureManualTianjiForm({ nodes: [portraitBRevision2, targetNode], edges: [] }); }
  catch (error) { disconnectedMessage = String(error?.message || error); }
  check("disconnecting the only reference sends no request", disconnectedMessage, "天玑参考素材生视频需要连接至少一项图片、视频或音频参考素材");
  const ordinaryAfterPortrait = {
    id: "portrait-source",
    type: "imageNode",
    data: {
      imageUrl: "https://media.example.invalid/ordinary-b.jpg",
      sourceOrigin: "external-upload",
      tianjiPortraitBindingRevision: 2,
    },
  };
  const ordinaryCapture = captureManualTianjiForm({
    nodes: [ordinaryAfterPortrait, targetNode],
    edges: [{ source: "portrait-source", target: "target" }],
    renderedNodes: [portraitARevision1, targetNode],
    refNodes: [portraitARevision1, targetNode],
  });
  check("A to ordinary image cannot resurrect reviewed A", {
    values: ordinaryCapture.request.payload["images[]"],
    schemes: ordinaryCapture.profile.media.images,
    stale: ordinaryCapture.snapshot.stalePortraitSnapshotCount,
  }, {
    values: ["https://media.example.invalid/ordinary-b.jpg"],
    schemes: { count: 1, asset: 0, http: 1, other: 0 },
    stale: 2,
  });
  const portraitBIndependent = reviewedNode("portrait-b-source", "portrait-b", 1, "portrait-b");
  const twoPortraitCapture = captureManualTianjiForm({
    nodes: [portraitARevision1, portraitBIndependent, targetNode],
    edges: [
      { source: "portrait-source", target: "target" },
      { source: "portrait-b-source", target: "target" },
    ],
  });
  check("two independent reviewed portrait nodes remain legal", {
    count: twoPortraitCapture.profile.media.images.count,
    asset: twoPortraitCapture.profile.media.images.asset,
    http: twoPortraitCapture.profile.media.images.http,
  }, { count: 2, asset: 2, http: 0 });
  const duplicateEdgeCapture = captureManualTianjiForm({
    nodes: [portraitBRevision2, targetNode],
    edges: [
      { source: "portrait-source", target: "target" },
      { source: "portrait-source", target: "target" },
    ],
  });
  check("duplicate reviewed edges produce one asset reference", duplicateEdgeCapture.profile.media.images, { count: 1, asset: 1, http: 0, other: 0 });
  const ambiguousSnapshot = wanjuanResolveTianjiGenerationCanvasSnapshot({
    nodes: [reviewedNode("portrait-source", "portrait-b", 0, "portrait-b"), targetNode],
    renderedNodes: [reviewedNode("portrait-source", "portrait-a", 0, "portrait-a"), targetNode],
  });
  let ambiguousSnapshotMessage = "";
  try {
    wanjuanBuildTianjiGenerationRequest({
      mode: "reference-media",
      common: { prompt: "mock" },
      portraitAssetIds: ["portrait-b"],
      reviewedPortraitClaimCount: 1,
      portraitConflictCount: ambiguousSnapshot.portraitConflictCount,
    });
  } catch (error) { ambiguousSnapshotMessage = String(error?.message || error); }
  check("same-node legacy ready identities fail closed when revision cannot order them", {
    conflicts: ambiguousSnapshot.portraitConflictCount,
    message: ambiguousSnapshotMessage,
  }, { conflicts: 1, message: WANJUAN_TIANJI_PORTRAIT_SYNC_ERROR });
  const cleanedContexts = wanjuanRemoveTianjiPortraitContextsForSources([
    { sourceId: "portrait-source", type: "image", url: "https://media.example.invalid/portrait-a.jpg" },
    { sourceId: "ordinary-source", type: "image", url: "https://media.example.invalid/ordinary.jpg" },
  ], [portraitARevision1]);
  check("portrait replacement cleanup removes only the claimed historical context", {
    removed: cleanedContexts.removedCount,
    remainingSources: cleanedContexts.resources.map((resource) => resource.sourceId),
  }, { removed: 1, remainingSources: ["ordinary-source"] });
  const replacedImageData = wanjuanResetTianjiPortraitBindingForImage({
    ...portraitARevision1.data,
    tianjiPortraitBindingRevision: 4,
  }, "https://media.example.invalid/ordinary.jpg");
  check("image replacement clears source identity and advances portrait revision", {
    sourceOrigin: replacedImageData.sourceOrigin,
    asset: replacedImageData.tianjiPortraitAssetId || null,
    revision: wanjuanTianjiPortraitBindingRevision(replacedImageData),
    nextRevision: wanjuanNextTianjiPortraitBindingRevision(replacedImageData),
  }, { sourceOrigin: "generated", asset: null, revision: 5, nextRevision: 6 });
  const manualGenerationRequest = wanjuanBuildTianjiGenerationRequest({
    mode: "reference-media",
    common: { prompt: "mock" },
    portraitAssetIds: manualPortraitInputs.portraitAssetIds,
    reviewedPortraitClaimCount: manualPortraitInputs.reviewedPortraitClaimCount,
  });
  check("manual generateVideo chain builds only the reviewed asset reference", manualGenerationRequest.payload["images[]"], ["asset://active-verified"]);
  let incompleteManualClaimMessage = "";
  try {
    wanjuanCollectTianjiManualPortraitInputs({
      nodes: [{ id: "incomplete", data: { imageUrl: "https://media.example.invalid/preview.jpg", sourceOrigin: "tianji-portrait", tianjiPortraitBindingStatus: "ready" } }],
      incomingEdges: [{ source: "incomplete", target: "manual-target" }],
    });
  } catch (error) { incompleteManualClaimMessage = String(error?.message || error); }
  check("manual generateVideo chain blocks an incomplete portrait claim", incompleteManualClaimMessage, "天玑人像缺少最终素材 ID，请刷新人像库后重新选择");
  let incompleteReadyClaimMessage = "";
  try { wanjuanTianjiPortraitReferenceFromNodeData({ imageUrl: "https://media.example.invalid/ordinary.jpg", tianjiPortraitBindingStatus: "ready", sourceOrigin: "tianji-portrait" }); } catch (error) { incompleteReadyClaimMessage = error.message; }
  check("historical ready badge without final id cannot downgrade to HTTP", incompleteReadyClaimMessage, "这张图片的天玑审核绑定不完整，请从天玑人像库重新选择");
  const recoveredHistoricalPortrait = wanjuanRecoverTianjiPortraitNodeData({
    imageUrl: "https://media.example.invalid/portable-preview.jpg",
    tianjiPortraitPreviewUrl: "https://media.example.invalid/signed-preview.jpg",
    tianjiPortraitBindingStatus: "ready",
    sourceOrigin: "tianji-portrait",
  }, {
    assetId: "active-recovered",
    imageUrl: "https://media.example.invalid/signed-preview.jpg",
    groupType: "AIGC",
  });
  check("historical portrait binding recovers final id only from matched Active cache", {
    assetId: recoveredHistoricalPortrait.tianjiPortraitAssetId,
    status: recoveredHistoricalPortrait.tianjiPortraitBindingStatus,
    sourceOrigin: recoveredHistoricalPortrait.sourceOrigin,
  }, { assetId: "active-recovered", status: "ready", sourceOrigin: "tianji-portrait" });
  check("recovered historical portrait resolves to asset reference", await wanjuanTianjiMediaUrl(wanjuanTianjiPortraitReferenceFromNodeData(recoveredHistoricalPortrait)), "asset://active-recovered");
  check("historical portrait is not recovered without a matched Active asset", wanjuanRecoverTianjiPortraitNodeData({ tianjiPortraitBindingStatus: "ready", sourceOrigin: "tianji-portrait" }, null), null);
  check("verified Active tianji portrait uses its final asset id", await wanjuanTianjiMediaUrl({ mediaSourceOrigin: "tianji-portrait", tianjiPortraitBindingStatus: "ready", tianjiPortraitAssetId: "active-verified", tianjiPortraitPreviewUrl: "https://media.example.invalid/active-verified.jpg" }), "asset://active-verified");
  const automationPortraitNodeData = wanjuanTianjiPortraitNodeDataFromAutomation("active-automation");
  check("automation reviewed portrait creates a trusted ready node", {
    ready: wanjuanIsReadyTianjiPortraitBinding(automationPortraitNodeData),
    sourceOrigin: automationPortraitNodeData.sourceOrigin,
    imageUrl: automationPortraitNodeData.imageUrl,
  }, { ready: true, sourceOrigin: "tianji-portrait", imageUrl: "" });
  const automationPortraitUrl = await wanjuanTianjiMediaUrl(wanjuanTianjiPortraitReferenceFromNodeData(automationPortraitNodeData));
  check("automation reviewed portrait resolves only through final id", automationPortraitUrl, "asset://active-automation");
  let missingPortraitIdMessage = "";
  try { await wanjuanTianjiMediaUrl({ mediaSourceOrigin: "tianji-portrait", tianjiPortraitBindingStatus: "ready", tianjiPortraitPreviewUrl: "https://media.example.invalid/no-id.jpg" }); } catch (error) { missingPortraitIdMessage = error.message; }
  check("verified Active tianji portrait requires an asset id", missingPortraitIdMessage, "这张天玑人像尚未完成审核和素材绑定");
  let forgedPortraitMessage = "";
  try { await wanjuanTianjiMediaUrl({ isTianjiPortrait: true, tianjiPortraitBindingStatus: "ready", tianjiPortraitAssetId: "forged-id", imageUrl: "https://media.example.invalid/ordinary.jpg" }); } catch (error) { forgedPortraitMessage = error.message; }
  check("ordinary image cannot forge reviewed portrait metadata", forgedPortraitMessage, "这张图片没有可验证的天玑 Active 素材来源，请从天玑人像库重新选择");
  check("tianji asset list sends only documented pagination fields", wanjuanTianjiAssetListParams("AIGC", "group-mock", 2, 20), {
    group_ids: "group-mock", group_type: "AIGC", statuses: "Active", PageNumber: "2", PageSize: "20", SortBy: "CreateTime", SortOrder: "Desc"
  });
  let referenceLimitMessage = "";
  try { wanjuanValidateTianjiReferenceMedia(Array.from({ length: 10 }, (_, index) => ({ url: `https://media.example.invalid/${index}.png` })), "image"); } catch (error) { referenceLimitMessage = error.message; }
  check("tianji rejects excess image references instead of truncating", referenceLimitMessage, "天玑图片参考素材最多 9 个");
  const tianjiFixture = (name) => JSON.parse(readFileSync(join(root, "scripts/fixtures/tianji", name), "utf8"));
  const submitFixture = tianjiFixture("submit-success.json");
  const successFixture = tianjiFixture("poll-success.json");
  const refundedFixture = tianjiFixture("poll-refunded.json");
  check("tianji fixture submit id", wanjuanTianjiFindTaskId(submitFixture), "execute_mock_001");
  check("tianji fixture success status", wanjuanTianjiStatus(successFixture), "succeeded");
  check("tianji fixture success video", wanjuanTianjiFindVideoUrl(successFixture), "https://media.example.invalid/mock-result.mp4");
  check("tianji fixture success thumbnail", wanjuanTianjiFindThumbUrl(successFixture), "https://media.example.invalid/mock-cover.jpg");
  check("tianji fixture normalized progress", wanjuanTianjiFindProgress(successFixture), 99);
  check("tianji fixture refunded status", wanjuanTianjiStatus(refundedFixture), "failed");
  check("tianji fixture refunded message", wanjuanTianjiErrorMessage(refundedFixture), "任务失败（积分已退款）：内容审核未通过，积分已退款");
  check("tianji v2 task query uses POST JSON ids", wanjuanBuildTianjiTaskQuery("execute_mock_001"), {
    endpoint: "/api/cut/model/coze-run-seedance-special-history",
    method: "POST",
    params: { task_id: "execute_mock_001", execute_id: "execute_mock_001" },
  });
  check("tianji balance accepts msg.points", wanjuanTianjiBalancePoints({ code: 200, msg: { points: 12 } }), 12);
  check("tianji balance accepts proxy data.points", wanjuanTianjiBalancePoints({ code: 200, data: { points: 34 } }), 34);
  check("tianji portrait task endpoint contract", WANJUAN_TIANJI_PORTRAIT_ENDPOINTS.queryRealResult, "/api/cut/model/get-visual-date-result");
  check("tianji portrait endpoints stay on relay api namespace", Object.values(WANJUAN_TIANJI_PORTRAIT_ENDPOINTS).every((endpoint) => endpoint.startsWith("/api/cut/model/")), true);
  check("tianji portrait task id parser", wanjuanTianjiFindPortraitTaskId({ data: { task_id: "portrait_mock_001" } }), "portrait_mock_001");
  check("tianji portrait task params", wanjuanBuildTianjiPortraitTaskParams("portrait_mock_001"), { task_id: "portrait_mock_001", execute_id: "portrait_mock_001" });
  check("tianji portrait group default name is readable", wanjuanTianjiDefaultPortraitGroupName(new Date("2026-08-12T12:34:56").getTime()), "StarCanvas-20260812123456");
  check("tianji legacy material id aliases are supported", wanjuanTianjiPortraitAssetIdFromItem({ MaterialId: "asset-legacy-001" }), "asset-legacy-001");
  const nestedTianjiPortrait = {
    data: {
      detail: {
        protrait_asset_id: "asset-typo-001",
        protrait_type: "AIGC",
        status: "Active",
        preview: { ImageUrl: "https://media.example.invalid/nested-preview.jpg" },
        name: "嵌套虚拟人像",
      },
    },
  };
  check("tianji production typo asset id is supported recursively", wanjuanTianjiPortraitAssetIdFromItem(nestedTianjiPortrait), "asset-typo-001");
  const screenshotPortraitDetail = {
    code: 200,
    data: {
      Result: {
        Id: "asset-20260813201639-example",
        URL: "https://media.example.invalid/signed-preview.jpg",
        Status: "Active",
        GroupId: "group-20260812205625-example",
        AssetType: "Image",
      },
    },
  };
  check("tianji get-portrait-info nested Result.Id is the final asset id", wanjuanTianjiPortraitAssetIdFromItem(screenshotPortraitDetail), "asset-20260813201639-example");
  check("tianji get-portrait-info nested Result is ready", wanjuanTianjiPortraitAvailabilityFromItem(screenshotPortraitDetail), "ready");
  check("tianji generic nested task id is not treated as a portrait asset", wanjuanTianjiPortraitAssetIdFromItem({ data: { Result: { Id: "task-20260813201639-example", Status: "Active" } } }), "");
  check("tianji production typo portrait type is supported recursively", wanjuanTianjiPortraitGroupTypeFromItem(nestedTianjiPortrait), "AIGC");
  check("tianji nested Pascal preview URL is supported", wanjuanTianjiPortraitImageUrlFromItem(nestedTianjiPortrait), "https://media.example.invalid/nested-preview.jpg");
  const sevenNestedPortraitAliases = [
    ["thumbnail_url", "one"], ["thumb_url", "two"], ["PreviewUrl", "three"], ["CoverUrl", "four"],
    ["avatar_url", "five"], ["portrait_url", "six"], ["oss_url", "seven"],
  ].map(([previewKey, suffix], index) => ({
    owner: { virtual_group_id: "group-mock" },
    payload: {
      asset: {
        protrait_asset_id: `asset-${suffix}`,
        protrait_type: "AIGC",
        [previewKey]: `https://media.example.invalid/${suffix}.jpg`,
        name: `嵌套素材${index + 1}`,
      },
    },
    __wanjuanTianjiListStatus: "Active",
  }));
  check("tianji seven nested production preview aliases all normalize", wanjuanNormalizeTianjiPortraitAssets({ AIGC: sevenNestedPortraitAliases }).map(({ portraitAssetId, imageUrl, availability }) => ({ portraitAssetId, imageUrl, availability })), [
    { portraitAssetId: "asset-one", imageUrl: "https://media.example.invalid/one.jpg", availability: "ready" },
    { portraitAssetId: "asset-two", imageUrl: "https://media.example.invalid/two.jpg", availability: "ready" },
    { portraitAssetId: "asset-three", imageUrl: "https://media.example.invalid/three.jpg", availability: "ready" },
    { portraitAssetId: "asset-four", imageUrl: "https://media.example.invalid/four.jpg", availability: "ready" },
    { portraitAssetId: "asset-five", imageUrl: "https://media.example.invalid/five.jpg", availability: "ready" },
    { portraitAssetId: "asset-six", imageUrl: "https://media.example.invalid/six.jpg", availability: "ready" },
    { portraitAssetId: "asset-seven", imageUrl: "https://media.example.invalid/seven.jpg", availability: "ready" },
  ]);
  check("tianji preview extractor rejects non-http values", wanjuanTianjiPortraitImageUrlFromItem({ data: { ImageUrl: "asset://not-a-preview", local: { PreviewUrl: "/tmp/private.png" } } }), "");
  const localOnlyPortraitItem = {
    protrait_asset_id: "asset-local-preview",
    protrait_type: "AIGC",
    status: "Active",
    name: "没有官方预览的人像",
    __wanjuanTianjiGroupId: "group-a",
    __wanjuanTianjiLocalPreviewUrl: "file:///Users/test/preview.jpg",
  };
  check("tianji display preview falls back to the isolated local file", wanjuanTianjiPortraitDisplayPreviewUrlFromItem(localOnlyPortraitItem), "file:///Users/test/preview.jpg");
  const refreshedLocalPreviewAssets = wanjuanTianjiDecorateLocalPreviews(localPreviewRegistry, localPreviewScopeA, { AIGC: "group-a" }, { AIGC: [{ protrait_asset_id: "asset-local-preview", protrait_type: "AIGC", status: "Active", name: "没有官方预览的人像", __wanjuanTianjiGroupId: "group-a" }], LivenessFace: [] });
  check("tianji refresh reattaches the saved local preview", refreshedLocalPreviewAssets.AIGC[0].__wanjuanTianjiLocalPreviewUrl, "file:///Users/test/preview.jpg");
  check("tianji array payload also reattaches the saved local preview", wanjuanTianjiDecorateLocalPreviews(localPreviewRegistry, localPreviewScopeA, { AIGC: "group-a" }, [{ protrait_asset_id: "asset-local-preview", protrait_type: "AIGC", status: "Active", __wanjuanTianjiGroupId: "group-a" }])[0].__wanjuanTianjiLocalPreviewUrl, "file:///Users/test/preview.jpg");
  check("tianji refresh does not attach another identity preview", wanjuanTianjiDecorateLocalPreviews(localPreviewRegistry, localPreviewScopeB, { AIGC: "group-a" }, refreshedLocalPreviewAssets).AIGC[0].__wanjuanTianjiLocalPreviewUrl, undefined);
  const normalizedLocalOnlyPortrait = wanjuanNormalizeTianjiPortraitAssets({ AIGC: [localOnlyPortraitItem] })[0];
  check("tianji Active portrait remains selectable without an official preview", {
    id: normalizedLocalOnlyPortrait.portraitAssetId,
    imageUrl: normalizedLocalOnlyPortrait.imageUrl,
    displayPreviewUrl: normalizedLocalOnlyPortrait.displayPreviewUrl,
    availability: normalizedLocalOnlyPortrait.availability,
  }, { id: "asset-local-preview", imageUrl: "", displayPreviewUrl: "file:///Users/test/preview.jpg", availability: "ready" });
  const localOnlyPortraitResource = wanjuanTianjiPortraitToResource(normalizedLocalOnlyPortrait);
  check("tianji local preview resource keeps generation identity on asset scheme", {
    url: localOnlyPortraitResource.url,
    previewUrl: localOnlyPortraitResource.previewUrl,
    assetId: localOnlyPortraitResource.tianjiPortraitAssetId,
  }, { url: "asset://asset-local-preview", previewUrl: "file:///Users/test/preview.jpg", assetId: "asset-local-preview" });
  const localPreviewManualInputs = wanjuanCollectTianjiManualPortraitInputs({
    nodes: [{ id: "local-preview-node", data: { imageUrl: "file:///Users/test/preview.jpg", tianjiPortraitLocalPreviewUrl: "file:///Users/test/preview.jpg", tianjiPortraitAssetId: "asset-local-preview", tianjiPortraitBindingStatus: "ready", sourceOrigin: "tianji-portrait", isTianjiPortrait: true } }],
    incomingEdges: [{ source: "local-preview-node", target: "target" }],
  });
  const localPreviewFilteredImages = wanjuanExcludeTianjiPortraitPreviews([{ url: "file:///Users/test/preview.jpg", sourceNodeId: "local-preview-node" }], localPreviewManualInputs.portraitPreviewUrls, localPreviewManualInputs.claimedSourceNodeIds);
  const localPreviewGenerationRequest = wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" }, portraitAssetIds: localPreviewManualInputs.portraitAssetIds, reviewedPortraitClaimCount: localPreviewManualInputs.reviewedPortraitClaimCount, imageUrls: localPreviewFilteredImages.map((item) => item.url) });
  check("tianji local display preview never enters the final generation form", localPreviewGenerationRequest.payload["images[]"], ["asset://asset-local-preview"]);
  check("tianji local preview decoration is stripped before remote asset cache writes", wanjuanTianjiStripLocalPreviewDecoration({ AIGC: [localOnlyPortraitItem], LivenessFace: [] }).AIGC[0], {
    protrait_asset_id: "asset-local-preview",
    protrait_type: "AIGC",
    status: "Active",
    name: "没有官方预览的人像",
    __wanjuanTianjiGroupId: "group-a",
  });
  check("tianji pending preview binds only a unique safe match", wanjuanTianjiResolvePendingLocalPreviewAssetId({ lookupName: "唯一上传名" }, { AIGC: [
    { protrait_asset_id: "asset-unique", protrait_type: "AIGC", status: "Active", name: "唯一上传名", __wanjuanTianjiGroupId: "group-a" },
    { protrait_asset_id: "asset-other", protrait_type: "AIGC", status: "Active", name: "其他", __wanjuanTianjiGroupId: "group-a" },
  ] }, "AIGC", "group-a"), "asset-unique");
  check("tianji pending preview does not guess between duplicate names", wanjuanTianjiResolvePendingLocalPreviewAssetId({ lookupName: "重复名" }, { AIGC: [
    { protrait_asset_id: "asset-duplicate-a", protrait_type: "AIGC", status: "Active", name: "重复名", __wanjuanTianjiGroupId: "group-a" },
    { protrait_asset_id: "asset-duplicate-b", protrait_type: "AIGC", status: "Active", name: "重复名", __wanjuanTianjiGroupId: "group-a" },
  ] }, "AIGC", "group-a"), "");
  check("tianji Active item is ready", wanjuanTianjiPortraitAvailabilityFromItem(nestedTianjiPortrait), "ready");
  check("tianji Processing item remains pending", wanjuanTianjiPortraitAvailabilityFromItem({ detail: { protrait_asset_id: "asset-processing", status: "Processing" } }), "pending");
  check("tianji Failed item remains failed", wanjuanTianjiPortraitAvailabilityFromItem({ detail: { protrait_asset_id: "asset-failed", status: "Failed" } }), "failed");
  check("tianji missing status is not silently treated as Active", wanjuanTianjiPortraitAvailabilityFromItem({ detail: { protrait_asset_id: "asset-unknown" } }), "unknown");
  check("tianji group id is not found recursively as asset id", wanjuanTianjiPortraitAssetIdFromItem({ data: { group_id: "group-recursive", virtual_group_id: "group-virtual" } }), "");
  check("tianji nested Active item resolves for node binding", wanjuanTianjiResolvePortraitAssetForNodeData({ tianjiPortraitBindingName: "嵌套虚拟人像" }, { AIGC: [nestedTianjiPortrait] }), {
    assetId: "asset-typo-001",
    asset: nestedTianjiPortrait,
    imageUrl: "https://media.example.invalid/nested-preview.jpg",
    groupType: "AIGC",
    availability: "ready",
  });
  check("tianji Processing item cannot resolve for node binding", wanjuanTianjiResolvePortraitAssetForNodeData({ tianjiPortraitBindingName: "处理中" }, { AIGC: [{ name: "处理中", protrait_asset_id: "asset-processing", status: "Processing", image_url: "https://media.example.invalid/processing.jpg" }] }), null);
  check("tianji upload typo id alone does not become final Active binding", wanjuanTianjiFinalPortraitAsset({ result: { data: { protrait_asset_id: "asset-upload-only" } }, asset: { name: "上传项", image_url: "https://media.example.invalid/upload.jpg", protrait_asset_id: "asset-upload-only" }, imageUrl: "https://media.example.invalid/upload.jpg", refresh: null }), {
    assetId: "",
    asset: null,
    imageUrl: "https://media.example.invalid/upload.jpg",
    matched: false,
  });
  check("tianji refresh never guesses the only unrelated Active item", wanjuanTianjiFinalPortraitAsset({ asset: { name: "上传项", image_url: "https://media.example.invalid/upload.jpg" }, imageUrl: "https://media.example.invalid/upload.jpg", refresh: { aigcCount: 1, assets: { AIGC: [{ protrait_asset_id: "asset-unrelated", status: "Active", name: "另一项", image_url: "https://media.example.invalid/unrelated.jpg" }] } } }), {
    assetId: "",
    asset: null,
    imageUrl: "https://media.example.invalid/upload.jpg",
    matched: false,
  });
  const normalizedNestedPortraits = wanjuanNormalizeTianjiPortraitAssets({ AIGC: [nestedTianjiPortrait] });
  check("tianji nested portrait normalizes preview and status", normalizedNestedPortraits.map(({ portraitAssetId, imageUrl, groupType, availability }) => ({ portraitAssetId, imageUrl, groupType, availability })), [{ portraitAssetId: "asset-typo-001", imageUrl: "https://media.example.invalid/nested-preview.jpg", groupType: "AIGC", availability: "ready" }]);
  check("tianji unknown portrait cannot become a resource", wanjuanTianjiPortraitToResource({ id: "asset-unknown", portraitAssetId: "asset-unknown", imageUrl: "https://media.example.invalid/unknown.jpg", availability: "unknown" }), null);
  check("tianji portrait id prefers explicit asset id", wanjuanTianjiPortraitAssetIdFromItem({ id: "group-a", asset_id: "asset-new-001" }), "asset-new-001");
  check("tianji group id is never treated as deletable asset id", wanjuanTianjiPortraitDeleteDescriptor({ id: "group-a", group_type: "AIGC" }, "AIGC"), { id: "", groupType: "AIGC", groupId: "", canDelete: false });
  check("tianji delete descriptor keeps group context", wanjuanTianjiPortraitDeleteDescriptor({ MaterialId: "asset-legacy-002", group_id: "group-a", group_type: "AIGC" }), { id: "asset-legacy-002", groupType: "AIGC", groupId: "group-a", canDelete: true });
  check("tianji preload supports production typo asset id", preloadPanelSource.includes('"protrait_asset_id"'), true);
  check("tianji preload supports recursive preview aliases", preloadPanelSource.includes('"thumbnail_url", "thumbnailUrl", "ThumbnailUrl"') && preloadPanelSource.includes('"oss_url", "ossUrl", "OssUrl"'), true);
  let capturedTianjiRequest = null;
  globalThis.window = {
    wanjuanDesktop: {
      proxyFetch: async (request) => {
        capturedTianjiRequest = request;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bodyBase64: Buffer.from(JSON.stringify({ code: 200, data: { status: "running" } }), "utf8").toString("base64"),
        };
      },
    },
  };
  const mockTaskQuery = wanjuanBuildTianjiTaskQuery("execute_mock_json");
  await wanjuanTianjiRequest({ baseUrl: "https://mock.example.invalid", token: "test-token-000000000000000000000000", sassId: "1", platform: "web" }, mockTaskQuery.endpoint, {
    method: mockTaskQuery.method,
    params: mockTaskQuery.params,
    enterpriseRequestKind: "poll",
  });
  check("tianji v2 request method", capturedTianjiRequest.method, "POST");
  check("tianji v2 request content type", capturedTianjiRequest.headers["Content-Type"], "application/json");
  check("tianji v2 poll uses enterprise proxy poll route", capturedTianjiRequest.enterpriseRequestKind, "poll");
  check("tianji v2 request x api key", capturedTianjiRequest.headers["X-API-Key"], "test-token-000000000000000000000000");
  check("tianji jixin request authorization bearer", capturedTianjiRequest.headers.Authorization, "Bearer test-token-000000000000000000000000");
  check("tianji bearer input is not duplicated", wanjuanTianjiAuthHeaders("Bearer test-token-prefixed").Authorization, "Bearer test-token-prefixed");
  check("tianji bearer input keeps raw x api key", wanjuanTianjiAuthHeaders("Bearer test-token-prefixed")["X-API-Key"], "test-token-prefixed");
  check("tianji request stays on configured relay", capturedTianjiRequest.url, "https://mock.example.invalid/api/cut/model/coze-run-seedance-special-history");
  check("tianji v2 request JSON body", JSON.parse(Buffer.from(capturedTianjiRequest.bodyBase64, "base64").toString("utf8")), { task_id: "execute_mock_json", execute_id: "execute_mock_json" });
  const automationGenerationRequest = wanjuanBuildTianjiGenerationRequest({ mode: "reference-media", common: { prompt: "mock" }, portraitAssetIds: ["active-automation"], reviewedPortraitClaimCount: 1 });
  await wanjuanTianjiRequest({ baseUrl: "https://mock.example.invalid", token: "test-token-000000000000000000000000" }, automationGenerationRequest.endpoint, {
    encoding: "form",
    params: automationGenerationRequest.payload,
    enterpriseRequestKind: "submit",
  });
  const capturedTianjiFormBody = Buffer.from(capturedTianjiRequest.bodyBase64, "base64").toString("utf8");
  const capturedTianjiForm = new URLSearchParams(capturedTianjiFormBody);
  check("tianji generation request content type is official form", capturedTianjiRequest.headers["Content-Type"], "application/x-www-form-urlencoded");
  check("tianji generation uses enterprise submit route", capturedTianjiRequest.enterpriseRequestKind, "submit");
  check("automation tianji generation form repeats one image bracket field", capturedTianjiForm.getAll("images[]"), ["asset://active-automation"]);
  check("automation tianji request profile is asset=1/http=0", capturedTianjiForm.getAll("images[]").reduce((profile, value) => ({ asset: profile.asset + Number(/^asset:\/\//i.test(value)), http: profile.http + Number(/^https?:\/\//i.test(value)) }), { asset: 0, http: 0 }), { asset: 1, http: 0 });
  const guardedProfile = inspectTianjiGenerationRequest({
    url: capturedTianjiRequest.url,
    headers: capturedTianjiRequest.headers,
    tianjiGenerationProfile: { reviewedPortraitCount: 1 },
  }, Buffer.from(capturedTianjiFormBody));
  check("main process sees the manual reviewed portrait as asset=1/http=0", guardedProfile.media.images, { count: 1, asset: 1, http: 0, other: 0 });
  validateTianjiGenerationRequest(guardedProfile);
  const anonymousResidualProfile = inspectTianjiGenerationRequest({
    url: capturedTianjiRequest.url,
    headers: capturedTianjiRequest.headers,
    tianjiGenerationProfile: { reviewedPortraitCount: 1, reviewedPortraitResidualCount: 1, portraitConflictCount: 0 },
  }, Buffer.from(capturedTianjiFormBody));
  check("main request profile carries only anonymous portrait residual/conflict counts", {
    residuals: anonymousResidualProfile.reviewedPortraitResidualCount,
    conflicts: anonymousResidualProfile.portraitConflictCount,
  }, { residuals: 1, conflicts: 0 });
  let guardedConflictMessage = "";
  try {
    validateTianjiGenerationRequest(inspectTianjiGenerationRequest({
      url: capturedTianjiRequest.url,
      headers: capturedTianjiRequest.headers,
      tianjiGenerationProfile: { reviewedPortraitCount: 1, portraitConflictCount: 1 },
    }, Buffer.from(capturedTianjiFormBody)));
  } catch (error) { guardedConflictMessage = String(error?.message || error); }
  check("main process fails closed on an anonymous portrait snapshot conflict", guardedConflictMessage, "天玑人像绑定状态存在冲突，已阻止提交");
  let mixedPortraitPreviewMessage = "";
  const mixedPortraitPreviewProfile = inspectTianjiGenerationRequest({
    url: "https://mock.example.invalid/api/cut/model/coze-seedance-video-special",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    tianjiGenerationProfile: {
      reviewedPortraitCount: 1,
      ordinaryImageCount: 1,
      reviewedPortraitPreviewUrls: ["https://media.example.invalid/signed-preview.jpg"],
    },
  }, Buffer.from(new URLSearchParams([
    ["images[]", "asset://active-verified"],
    ["images[]", "https://media.example.invalid/signed-preview.jpg"],
  ]).toString()));
  try { validateTianjiGenerationRequest(mixedPortraitPreviewProfile); } catch (error) { mixedPortraitPreviewMessage = String(error?.message || error); }
  check("main process records only a count for matched reviewed portrait previews", mixedPortraitPreviewProfile.reviewedPortraitPreviewMatches, 1);
  check("main process blocks a reviewed portrait preview even when the asset id is present", mixedPortraitPreviewMessage, "天玑已审核人像的预览图片混入了生成请求，已阻止提交");
  let mainGuardMessage = "";
  try {
    validateTianjiGenerationRequest(inspectTianjiGenerationRequest({
      url: "https://mock.example.invalid/api/cut/model/coze-seedance-video-special",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      tianjiGenerationProfile: { reviewedPortraitCount: 1 },
    }, Buffer.from(new URLSearchParams({ "images[]": "https://media.example.invalid/preview.jpg" }).toString())));
  } catch (error) { mainGuardMessage = String(error?.message || error); }
  check("main process blocks reviewed portrait preview HTTP substitution", mainGuardMessage, "天玑已审核人像引用在发送前丢失，已阻止使用预览图片替代");
  await wanjuanTianjiRequest({ baseUrl: "https://mock.example.invalid", token: "test-token-000000000000000000000000" }, mockTaskQuery.endpoint, {
    method: mockTaskQuery.method,
    params: mockTaskQuery.params,
    enterpriseRequestKind: "poll",
  });
  check("tianji task query remains JSON after form request", capturedTianjiRequest.headers["Content-Type"], "application/json");
  check("tianji task query keeps poll route after generation", capturedTianjiRequest.enterpriseRequestKind, "poll");
  check("tianji task query JSON body remains unchanged", JSON.parse(Buffer.from(capturedTianjiRequest.bodyBase64, "base64").toString("utf8")), { task_id: "execute_mock_json", execute_id: "execute_mock_json" });
  check("official compatible asset module remains independent", (await arkTrustedAssets.wanjuanResolveArkTrustedAssetReference({ config: { enabled: true, reviewMode: "manual" }, entry: { url: "https://cdn/official.png", arkTrustedAssetId: "official-asset", arkTrustedAssetSourceUrl: "https://cdn/official.png", arkTrustedAssetStatus: "ready" }, reviewAsset: () => { throw new Error("should not review"); } })).url, "asset://official-asset");
  await wanjuanTianjiRequest({ baseUrl: "https://jixing.guancn.uk/", token: "Bearer test-token-prefixed" }, "/api/cut/model/fetch-points-balance");
  check("tianji balance uses configured jixin api path", capturedTianjiRequest.url, "https://jixing.guancn.uk/api/cut/model/fetch-points-balance");
  check("tianji balance defaults to POST", capturedTianjiRequest.method, "POST");
  check("tianji empty balance is explicit", wanjuanTianjiBalancePoints({ code: 200, data: [] }), null);
  globalThis.window.wanjuanDesktop.proxyFetch = async () => ({
    ok: true,
    status: 401,
    statusText: "Unauthorized",
    bodyBase64: Buffer.from(JSON.stringify({ code: 401, message: "unauthorized" }), "utf8").toString("base64"),
  });
  let tianjiAuthError = "";
  try {
    await wanjuanTianjiRequest({ baseUrl: "https://mock.example.invalid", token: "test-token" }, "/api/cut/model/fetch-points-balance");
  } catch (error) {
    tianjiAuthError = String(error?.message || error);
  }
  check("tianji authentication error is classified", tianjiAuthError, "天玑鉴权失败：unauthorized");
  globalThis.window.wanjuanDesktop.proxyFetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    bodyBase64: Buffer.from(JSON.stringify({ code: 500, message: "upstream unavailable" }), "utf8").toString("base64"),
  });
  let tianjiBusinessError = "";
  try {
    await wanjuanTianjiRequest({ baseUrl: "https://mock.example.invalid", token: "test-token" }, "/api/cut/model/fetch-points-balance");
  } catch (error) {
    tianjiBusinessError = String(error?.message || error);
  }
  check("tianji upstream business error is classified", tianjiBusinessError, "天玑业务失败：upstream unavailable");
  check("tianji missing base url uses jixin relay", wanjuanNormalizeTianjiSeedanceConfig({}).baseUrl, "https://jixing.guancn.uk");
  check("tianji trims relay trailing slash", wanjuanNormalizeTianjiSeedanceConfig({ baseUrl: " https://jixing.guancn.uk/ " }).baseUrl, "https://jixing.guancn.uk");
  check("tianji rewrites legacy upstream to jixin relay", wanjuanNormalizeTianjiSeedanceConfig({ baseUrl: "https://ai.kulunli.cn/" }).baseUrl, "https://jixing.guancn.uk");
  check("tianji rewrites current internal upstream to jixin relay", wanjuanNormalizeTianjiSeedanceConfig({ baseUrl: "https://aiuse.phad.cn/" }).baseUrl, "https://jixing.guancn.uk");
  check("tianji preserves enterprise relay base url", wanjuanNormalizeTianjiSeedanceConfig({ baseUrl: "https://enterprise-relay.example.invalid/" }).baseUrl, "https://enterprise-relay.example.invalid");
  check("tianji saved empty base url stays empty", wanjuanNormalizeTianjiSeedanceConfig({ baseUrl: "" }).baseUrl, "");
  check("tianji default sync source follows jixin", wanjuanNormalizeTianjiSeedanceConfig({}).syncSource, WANJUAN_TIANJI_SYNC_SOURCE_JIXIN);
  check(
    "tianji jixin sync fills untouched config",
    wanjuanBuildSyncedTianjiConfigFromJixin({}, { url: " https://api.example.com/ ", key: " token-a " }),
    {
      baseUrl: "https://api.example.com",
      token: "token-a",
      syncSource: WANJUAN_TIANJI_SYNC_SOURCE_JIXIN,
      sassId: "1",
      platform: "web",
      models: "doubao-seedance-2-0-260128\ndoubao-seedance-2-0-fast-260128",
      durations: "4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15",
      resolutions: "480p\n720p\n1080p",
      ratios: "21:9\n16:9\n4:3\n1:1\n3:4\n9:16",
      generateAudio: true,
      watermark: false
    }
  );
  check(
    "tianji manual config is not overwritten by jixin sync",
    wanjuanBuildSyncedTianjiConfigFromJixin(
      wanjuanMarkTianjiConfigManual({ baseUrl: "https://manual.example.com", token: "manual-token" }),
      { url: "https://api.example.com", key: "token-a" }
    ).baseUrl,
    "https://manual.example.com"
  );
  check(
    "tianji legacy custom base url becomes manual config",
    wanjuanBuildSyncedTianjiConfigFromJixin(
      { baseUrl: " https://legacy.example.com/ ", token: "legacy-token" },
      { url: "https://api.example.com", key: "token-a" }
    ),
    {
      baseUrl: "https://legacy.example.com",
      token: "legacy-token",
      syncSource: WANJUAN_TIANJI_SYNC_SOURCE_MANUAL,
      sassId: "1",
      platform: "web",
      models: "doubao-seedance-2-0-260128\ndoubao-seedance-2-0-fast-260128",
      durations: "4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15",
      resolutions: "480p\n720p\n1080p",
      ratios: "21:9\n16:9\n4:3\n1:1\n3:4\n9:16",
      generateAudio: true,
      watermark: false
    }
  );
  check(
    "tianji forced jixin sync can relink manual config",
    wanjuanBuildSyncedTianjiConfigFromJixin(
      { baseUrl: "https://manual.example.com", token: "manual-token", syncSource: WANJUAN_TIANJI_SYNC_SOURCE_MANUAL },
      { url: "https://api.example.com", key: "token-a" },
      { force: true }
    ),
    {
      baseUrl: "https://api.example.com",
      token: "token-a",
      syncSource: WANJUAN_TIANJI_SYNC_SOURCE_JIXIN,
      sassId: "1",
      platform: "web",
      models: "doubao-seedance-2-0-260128\ndoubao-seedance-2-0-fast-260128",
      durations: "4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15",
      resolutions: "480p\n720p\n1080p",
      ratios: "21:9\n16:9\n4:3\n1:1\n3:4\n9:16",
      generateAudio: true,
      watermark: false
    }
  );

  // ---- suno-music-api (newapi 经典 /suno/submit/music 格式) ----
  const suno = await import(pathToFileURL(join(outDir, "suno-music-api.js")).href);
  check("suno.gen.inspiration", suno.buildSunoGenerateBody({ customMode: false, instrumental: false, mv: "chirp-v4", prompt: "乡愁", tags: "" }), { mv: "chirp-v4", gpt_description_prompt: "乡愁" });
  check("suno.gen.custom", suno.buildSunoGenerateBody({ customMode: true, instrumental: false, mv: "chirp-auk", prompt: "[Verse]...", tags: "edm", title: "T" }), { mv: "chirp-auk", prompt: "[Verse]...", tags: "edm", title: "T" });
  check("suno.gen.instrumental", suno.buildSunoGenerateBody({ customMode: true, instrumental: true, mv: "chirp-v4", tags: "lofi" }), { mv: "chirp-v4", make_instrumental: true, tags: "lofi" });
  check("suno.extend", suno.buildSunoExtendBody({ continueClipId: "abc", continueAt: 30, mv: "chirp-v4", prompt: "x" }), { mv: "chirp-v4", continue_clip_id: "abc", continue_at: 30, prompt: "x" });
  check("suno.reference.url", suno.buildSunoReferenceBody({ referenceUrl: "https://a/x.mp3", mv: "chirp-v4", tags: "jazz" }), { mv: "chirp-v4", task: "upload_reference", url: "https://a/x.mp3", tags: "jazz" });
  check("suno.reference.clip", suno.buildSunoReferenceBody({ referenceClipId: "xyz", mv: "chirp-v4" }), { mv: "chirp-v4", reference_clip_id: "xyz" });
  check("suno.validate.inspirationNeedsPrompt", suno.validateSunoGenerateParams({ customMode: false, instrumental: false, mv: "chirp-v4", prompt: "" }), "灵感模式需填写歌曲描述");
  check("suno.validate.customNeedsPrompt", suno.validateSunoGenerateParams({ customMode: true, instrumental: false, mv: "chirp-v4", prompt: "" }), "自定义模式需填写歌词(prompt)");
  check("suno.validate.instrumentalOk", suno.validateSunoGenerateParams({ customMode: false, instrumental: true, mv: "chirp-v4", prompt: "" }), null);
  check("suno.validate.ok", suno.validateSunoGenerateParams({ customMode: false, instrumental: false, mv: "chirp-v4", prompt: "hi" }), null);
  check("suno.taskStatus", suno.extractSunoTaskStatus({ data: { status: "success" } }), "SUCCESS");
  check("suno.taskSuccess", suno.sunoTaskIsSuccess("SUCCESS"), true);
  check("suno.taskFailure", suno.sunoTaskIsFailure("FAILURE"), true);
  check("suno.clips", suno.extractSunoClips({ data: { status: "SUCCESS", data: [{ id: "1", clip_id: "c1", audio_url: "http://a/1.mp3", status: "complete", title: "T", duration: 120, model_name: "chirp-v4" }] } }),
    [{ id: "1", audioUrl: "http://a/1.mp3", videoUrl: undefined, imageUrl: undefined, title: "T", tags: undefined, prompt: undefined, status: "complete", duration: 120, modelName: "chirp-v4" }]);
  check("suno.url", suno.sunoUrl("https://x.newapi.com/", "/suno/submit/music"), "https://x.newapi.com/suno/submit/music");

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  rmSync(outDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
});
