const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electronRuntime = require("electron");

const electronApp = electronRuntime && typeof electronRuntime === "object" ? electronRuntime.app : null;
const electronTemporaryUserData = electronApp
  ? fs.mkdtempSync(path.join(os.tmpdir(), "wanjuan-cloud-prompt-mock-electron-"))
  : "";
if (electronApp) {
  electronApp.setName("StarCanvas");
  electronApp.setPath("userData", electronTemporaryUserData);
}

const {
  normalizePermissions,
  sanitizeSharedPromptTemplateInput,
} = require("../electron/shared/cloud-prompt-contract.cjs");
const {
  createCloudPromptStore,
  createMemoryCloudPromptAdapter,
} = require("../electron/preload/cloud-prompt-store.cjs");
const { createCloudPromptWorkspaceController } = require("../electron/preload/cloud-prompt-workspace.cjs");
const {
  cloudPromptErrorResult,
  createCloudPromptService,
} = require("../electron/main/cloud-prompt-service.cjs");
const { AccountRequestError } = require("../electron/main/account-service.cjs");

async function testDtoWhitelist() {
  const safe = sanitizeSharedPromptTemplateInput({
    title: " 安全模板 ",
    prompt: "生成一张电影感分镜图",
    description: "只保留说明",
    type: "image",
    tags: ["分镜", "分镜", "电影感"],
    modelName: "image-model",
    sourceProvider: "provider",
    generationMode: "text-to-image",
    params: {
      ratio: "16:9",
      selectedResolution: "2K",
      selectedSeconds: 5,
      generateAudio: false,
      watermark: true,
      apiKey: "must-not-survive",
      resultUrl: "https://private.invalid/result.png",
    },
    apiKey: "must-not-survive",
    token: "must-not-survive",
    apiConfigs: [{ key: "must-not-survive" }],
    headers: { authorization: "must-not-survive" },
    selectedContextResources: [{ url: "file:///private.png" }],
    sourceProjectId: "private-project",
    sourceNodeId: "private-node",
    resultUrl: "https://private.invalid/result.png",
    localPath: "/Users/private/result.png",
    taskId: "private-task",
  });
  assert.deepEqual(safe, {
    title: "安全模板",
    content: "生成一张电影感分镜图",
    description: "只保留说明",
    type: "image",
    tags: ["分镜", "电影感"],
    modelHint: "image-model",
    providerHint: "provider",
    generationMode: "text-to-image",
    parameters: {
      aspectRatio: "16:9",
      resolution: "2K",
      durationSeconds: 5,
      generateAudio: false,
      watermark: true,
    },
  });
  const serialized = JSON.stringify(safe);
  for (const forbidden of ["apiKey", "token", "apiConfigs", "authorization", "selectedContextResources", "sourceProjectId", "sourceNodeId", "resultUrl", "localPath", "taskId", "file://"]) {
    assert.equal(serialized.includes(forbidden), false, `DTO leaked ${forbidden}`);
  }
}

async function testCacheIsolationAndRevocation() {
  const store = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  await store.ensureAccountIsolation("account-a");
  await store.putTemplate("account-a", "workspace-a", {
    id: "template-a",
    workspaceId: "workspace-a",
    title: "A",
    content: "A",
    type: "text",
    tags: [],
    parameters: {},
  }, "synced");
  await store.enqueue({ accountId: "account-a", workspaceId: "workspace-a", operation: "template.update", templateId: "template-a" });
  assert.equal((await store.listTemplates("account-a", "workspace-a")).length, 1);
  assert.equal((await store.listQueue("account-a")).length, 1);

  await store.ensureAccountIsolation("account-b");
  assert.equal((await store.listTemplates("account-a", "workspace-a")).length, 0, "account switch must clear previous template cache");
  assert.equal((await store.listQueue("account-a")).length, 0, "account switch must clear previous sync queue");

  await store.putTemplate("account-b", "allowed", { id: "allowed-template", workspaceId: "allowed", title: "Allowed", content: "Allowed", type: "text", tags: [], parameters: {} }, "synced");
  await store.putTemplate("account-b", "revoked", { id: "revoked-template", workspaceId: "revoked", title: "Revoked", content: "Revoked", type: "text", tags: [], parameters: {} }, "pending-update");
  await store.enqueue({ accountId: "account-b", workspaceId: "revoked", operation: "template.update", templateId: "revoked-template" });
  const removed = await store.pruneUnauthorizedWorkspaces("account-b", ["allowed"]);
  assert.deepEqual(removed, ["revoked"]);
  assert.equal((await store.listTemplates("account-b", "revoked", { includeArchived: true })).length, 0);
  assert.equal((await store.listQueue("account-b", "revoked")).length, 0, "revoked workspace operations must not upload later");
}

async function testHeadersAndOutboundBody() {
  const calls = [];
  const service = createCloudPromptService({
    getAccountContext: () => ({ authenticated: true, account: { id: "account-test", displayName: "Test" } }),
    request: async (pathname, options = {}) => {
      calls.push({ pathname, options });
      if (options.method === "POST") return {
        item: { id: "template-created", workspaceId: "workspace-test", revision: 1, ...options.body, status: "active" },
      };
      if (options.method === "PATCH") return {
        item: { id: "template-created", workspaceId: "workspace-test", revision: 8, ...options.body, status: "active" },
      };
      return { items: [] };
    },
  });
  const unsafeTemplate = {
    title: "测试",
    content: "安全正文",
    type: "video",
    tags: ["测试"],
    parameters: { aspectRatio: "16:9", apiKey: "leak" },
    apiKey: "leak",
    localPath: "/private/file",
    resultUrl: "https://private.invalid/result.mp4",
  };
  const created = await service.invoke({
    operation: "template.create",
    workspaceId: "workspace-test",
    template: unsafeTemplate,
    idempotencyKey: "idem-create-1",
  });
  assert.equal(created.ok, true);
  const createCall = calls.at(-1);
  assert.equal(createCall.options.headers["Idempotency-Key"], "idem-create-1");
  assert.deepEqual(Object.keys(createCall.options.body).sort(), ["content", "parameters", "tags", "title", "type"]);
  assert.equal(JSON.stringify(createCall.options.body).includes("leak"), false);

  const updated = await service.invoke({
    operation: "template.update",
    workspaceId: "workspace-test",
    templateId: "template-created",
    revision: 7,
    template: unsafeTemplate,
  });
  assert.equal(updated.ok, true);
  const updateCall = calls.at(-1);
  assert.equal(updateCall.options.headers["If-Match"], '"7"');
  assert.equal(updateCall.options.body.revision, 7);
}

async function testMockApiAndConflict() {
  const service = createCloudPromptService({ mockEnabled: true });
  const bootstrap = await service.invoke({ operation: "bootstrap" });
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.workspaces.some((item) => item.kind === "personal"), true);
  assert.equal(bootstrap.workspaces.some((item) => item.kind === "organization"), true);

  const workspaceId = bootstrap.workspaces.find((item) => item.kind === "personal").id;
  const created = await service.invoke({
    operation: "template.create",
    workspaceId,
    idempotencyKey: "mock-create-1",
    template: { title: "冲突测试", content: "第一版", type: "text", tags: ["测试"], parameters: {} },
  });
  assert.equal(created.ok, true);
  const firstUpdate = await service.invoke({
    operation: "template.update",
    workspaceId,
    templateId: created.item.id,
    revision: 1,
    template: { ...created.item, content: "第二版" },
  });
  assert.equal(firstUpdate.ok, true);
  const conflict = await service.invoke({
    operation: "template.update",
    workspaceId,
    templateId: created.item.id,
    revision: 1,
    template: { ...created.item, content: "过期本地版" },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "PROMPT_TEMPLATE_CONFLICT");
  assert.equal(conflict.conflict.serverVersion.content, "第二版");

  const favorite = await service.invoke({ operation: "template.favorite", workspaceId, templateId: created.item.id, idempotencyKey: "mock-favorite-1" });
  assert.equal(favorite.ok, true);
  assert.equal(favorite.item.favorite, true);
  const organizationId = bootstrap.workspaces.find((item) => item.kind === "organization").id;
  const copied = await service.invoke({ operation: "template.copy", workspaceId, templateId: created.item.id, targetWorkspaceId: organizationId, idempotencyKey: "mock-copy-1" });
  assert.equal(copied.ok, true);
  assert.equal(copied.item.workspaceId, organizationId);
  const archived = await service.invoke({ operation: "template.archive", workspaceId, templateId: created.item.id, revision: firstUpdate.item.revision });
  assert.equal(archived.ok, true);
  assert.equal(archived.item.status, "archived");
  const deleted = await service.invoke({ operation: "template.delete", workspaceId, templateId: created.item.id, revision: archived.item.revision });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.tombstone.id, created.item.id);
  const changes = await service.invoke({ operation: "template.changes", workspaceId });
  assert.equal(changes.tombstones.some((item) => item.id === created.item.id), true);
}

async function testPermissionDefaults() {
  assert.deepEqual(normalizePermissions({}, "viewer"), {
    canRead: true,
    canCreate: false,
    canEdit: false,
    canEditOwn: false,
    canDelete: false,
    canShare: false,
    canFavorite: true,
    canCopy: true,
  });
  assert.equal(normalizePermissions({}, "editor").canEdit, false, "role labels must not grant edit authority");
  assert.equal(normalizePermissions({}, "admin").canDelete, false, "role labels must not grant delete authority");
  assert.equal(normalizePermissions({}, "owner").canShare, false, "sharing requires an explicit server permission");
  assert.equal(normalizePermissions({ canEdit: true, canDelete: true, canShare: true }, "viewer").canShare, true);
}

async function testConflictDetailsPreserved() {
  const error = new AccountRequestError("conflict", {
    status: 409,
    code: "PROMPT_TEMPLATE_CONFLICT",
    details: {
      item: {
        id: "server-template",
        workspaceId: "server-workspace",
        revision: 4,
        title: "server",
        content: "server content",
        type: "text",
        tags: [],
        parameters: {},
      },
    },
  });
  const result = cloudPromptErrorResult(error);
  assert.equal(result.status, 409);
  assert.equal(result.conflict.serverVersion.revision, 4);
  assert.equal(result.conflict.serverVersion.content, "server content");
}

async function testSendTargetsAndCloudCopy() {
  const service = createCloudPromptService({ mockEnabled: true });
  const store = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  const controller = createCloudPromptWorkspaceController({
    store,
    invoke: (payload) => service.invoke(payload),
  });
  await controller.prepare({ force: true });
  const targets = controller.creatableWorkspaces();
  assert.equal(targets.some((workspace) => workspace.kind === "personal"), true);
  assert.equal(targets.some((workspace) => workspace.kind === "organization"), true);
  assert.equal(controller.creatableWorkspaces({ query: "企业" }).every((workspace) => workspace.kind === "organization"), true);

  const personal = targets.find((workspace) => workspace.kind === "personal");
  const organization = targets.find((workspace) => workspace.kind === "organization");
  const unsafe = {
    title: "发送测试",
    content: "安全提示词正文",
    type: "video",
    tags: ["测试"],
    parameters: { aspectRatio: "16:9", apiKey: "must-not-survive" },
    resultUrl: "https://private.invalid/result.mp4",
    localPath: "/private/result.mp4",
    sourceProjectId: "private-project",
    sourceNodeId: "private-node",
    token: "must-not-survive",
  };
  await controller.sendTemplateToWorkspace(unsafe, personal.id);
  const personalTemplates = await store.listTemplates("mock-user-wanjuan", personal.id, { includeArchived: true });
  const sent = personalTemplates.find((item) => item.title === "发送测试");
  assert.ok(sent, "sent cloud template should be cached");
  const serialized = JSON.stringify(sent);
  for (const forbidden of ["apiKey", "resultUrl", "localPath", "sourceProjectId", "sourceNodeId", "must-not-survive"]) {
    assert.equal(serialized.includes(forbidden), false, `send target leaked ${forbidden}`);
  }

  const source = personalTemplates.find((item) => item.id && item.title === "发送测试");
  await controller.copyTemplateToWorkspace(source, organization.id);
  const organizationTemplates = await store.listTemplates("mock-user-wanjuan", organization.id, { includeArchived: true });
  assert.equal(organizationTemplates.some((item) => item.title.startsWith("发送测试") && item.id !== source.id), true, "copy must create an independent template");

  const deniedController = createCloudPromptWorkspaceController({
    store: createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() }),
    invoke: async (payload) => payload.operation === "bootstrap" ? {
      ok: true,
      authenticated: true,
      account: { id: "denied-account", displayName: "Denied" },
      workspaces: [{ id: "viewer", name: "只读空间", kind: "organization", role: "viewer", permissions: { canRead: true, canCreate: false } }],
    } : { ok: false, status: 403, error: "forbidden" },
  });
  await deniedController.prepare({ force: true });
  assert.deepEqual(deniedController.creatableWorkspaces(), []);
  await assert.rejects(() => deniedController.sendTemplateToWorkspace({ title: "X", content: "X" }, "viewer"), /没有创建权限/);
}

async function testWorkspaceSyncScopeRace() {
  const store = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  let releaseWorkspaceA;
  let markWorkspaceAStarted;
  const workspaceAStarted = new Promise((resolve) => { markWorkspaceAStarted = resolve; });
  const workspaceAResult = new Promise((resolve) => { releaseWorkspaceA = resolve; });
  const workspaces = [
    { id: "workspace-a", name: "A", kind: "personal", role: "owner", permissions: { canRead: true, canCreate: true, canEdit: true } },
    { id: "workspace-b", name: "B", kind: "organization", role: "editor", permissions: { canRead: true, canCreate: true, canEdit: true } },
  ];
  const invoke = async (payload) => {
    if (payload.operation === "bootstrap") return { ok: true, authenticated: true, account: { id: "account-a" }, workspaces };
    if (payload.operation === "template.list" && payload.workspaceId === "workspace-a") {
      markWorkspaceAStarted();
      return workspaceAResult;
    }
    if (payload.operation === "template.list" && payload.workspaceId === "workspace-b") {
      return {
        ok: true,
        items: [{ id: "template-b", workspaceId: "workspace-b", title: "B", content: "B", type: "text", tags: [], parameters: {} }],
        tombstones: [],
        nextCursor: "cursor-b",
      };
    }
    return { ok: true, items: [], tombstones: [], nextCursor: "" };
  };
  const controller = createCloudPromptWorkspaceController({ store, invoke });
  await controller.prepare({ force: true });
  const syncA = controller.handleField("cloudWorkspaceId", "workspace-a");
  await workspaceAStarted;
  const syncB = controller.handleField("cloudWorkspaceId", "workspace-b");
  await syncB;
  releaseWorkspaceA({
    ok: true,
    items: [{ id: "template-a", workspaceId: "workspace-a", title: "A", content: "A", type: "text", tags: [], parameters: {} }],
    tombstones: [],
    nextCursor: "cursor-a",
  });
  await syncA;

  assert.equal(controller.peek().activeWorkspaceId, "workspace-b");
  assert.deepEqual(controller.peek().templates.map((item) => item.id), ["template-b"]);
  assert.deepEqual((await store.listTemplates("account-a", "workspace-b")).map((item) => item.id), ["template-b"]);
  assert.deepEqual(await store.listTemplates("account-a", "workspace-a"), [], "stale A response must not be committed after switching to B");
  assert.equal(await store.getCursor("account-a", "workspace-b"), "cursor-b");
  assert.equal(await store.getCursor("account-a", "workspace-a"), undefined);

  const accountStore = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  let activeAccount = "account-a";
  let releaseAccountA;
  let markAccountAStarted;
  const accountAStarted = new Promise((resolve) => { markAccountAStarted = resolve; });
  const accountAResult = new Promise((resolve) => { releaseAccountA = resolve; });
  const accountController = createCloudPromptWorkspaceController({
    store: accountStore,
    invoke: async (payload) => {
      if (payload.operation === "bootstrap") {
        return {
          ok: true,
          authenticated: true,
          account: { id: activeAccount },
          workspaces: [{ id: `workspace-${activeAccount}`, name: activeAccount, kind: "personal", role: "owner", permissions: { canRead: true, canCreate: true, canEdit: true } }],
        };
      }
      if (payload.operation === "template.list" && payload.workspaceId === "workspace-account-a") {
        markAccountAStarted();
        return accountAResult;
      }
      if (payload.operation === "template.list" && payload.workspaceId === "workspace-account-b") {
        return {
          ok: true,
          items: [{ id: "template-account-b", workspaceId: "workspace-account-b", title: "B", content: "B", type: "text", tags: [], parameters: {} }],
          tombstones: [],
          nextCursor: "cursor-account-b",
        };
      }
      return { ok: true, items: [], tombstones: [], nextCursor: "" };
    },
  });
  await accountController.prepare({ force: true });
  const staleAccountSync = accountController.syncActiveWorkspace();
  await accountAStarted;
  accountController.reset();
  activeAccount = "account-b";
  await accountController.prepare({ force: true, sync: true });
  releaseAccountA({
    ok: true,
    items: [{ id: "template-account-a", workspaceId: "workspace-account-a", title: "A", content: "A", type: "text", tags: [], parameters: {} }],
    tombstones: [],
    nextCursor: "cursor-account-a",
  });
  await staleAccountSync;

  assert.equal(accountController.peek().account.id, "account-b");
  assert.deepEqual(accountController.peek().templates.map((item) => item.id), ["template-account-b"]);
  assert.deepEqual(await accountStore.listTemplates("account-a", "workspace-account-a"), [], "late account A response must not recreate its cache after account switch");

  const cursorBaseStore = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  let releaseCursor;
  let markCursorStarted;
  const cursorStarted = new Promise((resolve) => { markCursorStarted = resolve; });
  const heldCursor = new Promise((resolve) => { releaseCursor = resolve; });
  const cursorStore = {
    ...cursorBaseStore,
    async getCursor(accountId, workspaceId) {
      if (workspaceId === "workspace-a") {
        markCursorStarted();
        return heldCursor;
      }
      return cursorBaseStore.getCursor(accountId, workspaceId);
    },
  };
  const cursorCalls = [];
  const cursorController = createCloudPromptWorkspaceController({
    store: cursorStore,
    invoke: async (payload) => {
      if (payload.operation === "bootstrap") return { ok: true, authenticated: true, account: { id: "cursor-account" }, workspaces };
      cursorCalls.push(payload);
      return { ok: true, items: [], tombstones: [], nextCursor: "" };
    },
  });
  await cursorController.prepare({ force: true });
  const heldCursorSync = cursorController.syncActiveWorkspace();
  await cursorStarted;
  await cursorController.handleField("cloudWorkspaceId", "workspace-b");
  releaseCursor("");
  await heldCursorSync;
  assert.equal(cursorCalls.some((call) => call.workspaceId === "workspace-a"), false, "scope must be rechecked after an awaited cursor read");

  const listBaseStore = createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });
  let holdFinalList = false;
  let releaseFinalList;
  let markFinalListStarted;
  const finalListStarted = new Promise((resolve) => { markFinalListStarted = resolve; });
  const heldFinalList = new Promise((resolve) => { releaseFinalList = resolve; });
  const listStore = {
    ...listBaseStore,
    async applyRemoteChanges(...args) {
      const result = await listBaseStore.applyRemoteChanges(...args);
      if (args[1] === "workspace-a") holdFinalList = true;
      return result;
    },
    async listTemplates(accountId, workspaceId, options) {
      const result = await listBaseStore.listTemplates(accountId, workspaceId, options);
      if (workspaceId === "workspace-a" && holdFinalList) {
        markFinalListStarted();
        await heldFinalList;
      }
      return result;
    },
  };
  const listController = createCloudPromptWorkspaceController({
    store: listStore,
    invoke: async (payload) => {
      if (payload.operation === "bootstrap") return { ok: true, authenticated: true, account: { id: "list-account" }, workspaces };
      return { ok: true, items: [{ id: `template-${payload.workspaceId}`, workspaceId: payload.workspaceId, title: payload.workspaceId, content: payload.workspaceId, type: "text", tags: [], parameters: {} }], tombstones: [], nextCursor: "cursor" };
    },
  });
  await listController.prepare({ force: true });
  const heldListSync = listController.syncActiveWorkspace();
  await finalListStarted;
  await listController.handleField("cloudWorkspaceId", "workspace-b");
  releaseFinalList();
  await heldListSync;
  assert.equal(listController.peek().activeWorkspaceId, "workspace-b");
  assert.deepEqual(listController.peek().templates.map((item) => item.id), ["template-workspace-b"], "late listTemplates result must not overwrite the current workspace view");
}

async function testSharingContractsAndUi() {
  const calls = [];
  const service = createCloudPromptService({
    getAccountContext: () => ({ authenticated: true, account: { id: "owner-user", displayName: "Owner" } }),
    request: async (pathname, options = {}) => {
      calls.push({ pathname, options });
      if (pathname.endsWith("/members") && options.method === "GET") return { items: [{ userId: "member-1", displayName: "成员甲", role: "viewer", status: "active" }] };
      if (pathname.includes("/members/") && options.method === "PATCH") return { item: { userId: "member-1", displayName: "成员甲", role: options.body.role, status: "active" } };
      if (pathname.endsWith("/invitations") && options.method === "POST") return { item: { id: "invite-1", workspaceId: "workspace-test", workspaceName: "测试空间", role: options.body.role, status: "pending" } };
      if (pathname === "/prompt-workspace-invitations" && options.method === "GET") return { items: [{ id: "invite-inbox", workspaceId: "shared-space", workspaceName: "共享空间", role: "editor", status: "pending" }] };
      if (pathname.endsWith("/accept") && options.method === "POST") return { item: { id: "invite-inbox", workspaceId: "shared-space", workspaceName: "共享空间", role: "editor", status: "accepted" } };
      if (pathname.endsWith("/copy") && options.method === "POST") return { item: { id: "copy-1", workspaceId: options.body.targetWorkspaceId, revision: 1, title: "副本", content: "正文", type: "text", tags: [], parameters: {} } };
      return { ok: true, items: [] };
    },
  });
  assert.equal((await service.invoke({ operation: "member.list", workspaceId: "workspace-test" })).items[0].role, "viewer");
  await service.invoke({ operation: "member.update", workspaceId: "workspace-test", userId: "member-1", member: { role: "editor" } });
  await service.invoke({ operation: "invitation.create", workspaceId: "workspace-test", invitation: { identifier: "member@example.com", role: "viewer" }, idempotencyKey: "invite-idem-1" });
  const inbox = await service.invoke({ operation: "invitation.inbox" });
  assert.equal(inbox.items[0].workspaceName, "共享空间");
  assert.equal(JSON.stringify(inbox).includes("member@example.com"), false, "invitation response must not expose identifier");
  await service.invoke({ operation: "invitation.accept", workspaceId: "workspace-test", invitationId: "invite-inbox" });
  await service.invoke({ operation: "template.copy", workspaceId: "workspace-test", templateId: "template-1", targetWorkspaceId: "workspace-target", idempotencyKey: "copy-idem-1" });
  const invitationCall = calls.find((call) => call.pathname.endsWith("/invitations") && call.options.method === "POST");
  assert.equal(invitationCall.options.headers["Idempotency-Key"], "invite-idem-1");
  assert.deepEqual(invitationCall.options.body, { identifier: "member@example.com", role: "viewer" });
  const copyCall = calls.find((call) => call.pathname.endsWith("/copy"));
  assert.deepEqual(copyCall.options.body, { targetWorkspaceId: "workspace-target", mode: "copy" });

  const mockService = createCloudPromptService({ mockEnabled: true });
  const controller = createCloudPromptWorkspaceController({
    store: createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() }),
    invoke: (payload) => mockService.invoke(payload),
  });
  await controller.prepare({ force: true });
  await controller.handleAction("cloud-sharing-open");
  const sharingHtml = controller.renderContent();
  assert.equal(sharingHtml.includes("成员与共享"), true);
  assert.equal(sharingHtml.includes("cloud-invite-member"), true);
  await controller.handleField("cloudMemberIdentifier", "member@example.com");
  await controller.handleField("cloudMemberRole", "editor");
  await controller.handleAction("cloud-invite-member");
  assert.equal(controller.renderContent().includes("撤销邀请"), true);

  const invalidInvitation = await service.invoke({ operation: "invitation.create", workspaceId: "workspace-test", invitation: { identifier: "\u0000bad", role: "viewer" }, idempotencyKey: "bad-idem" });
  assert.equal(invalidInvitation.ok, false);
  assert.equal(invalidInvitation.code, "INVALID_ACCOUNT_IDENTIFIER");

  const deniedService = createCloudPromptService({
    mockEnabled: true,
    fixture: {
      account: { id: "viewer-user", displayName: "只读用户" },
      workspaces: [{ id: "viewer-space", name: "只读空间", kind: "organization", role: "viewer", revision: 1, permissions: { canRead: true, canCreate: false, canEdit: false, canShare: false } }],
      templates: [],
      members: [],
      invitations: [],
    },
  });
  const deniedAdd = await deniedService.invoke({ operation: "member.add", workspaceId: "viewer-space", member: { userId: "member-2", role: "viewer" }, idempotencyKey: "denied-member" });
  assert.equal(deniedAdd.ok, false);
  assert.equal(deniedAdd.status, 403);
  assert.equal(deniedAdd.code, "PROMPT_MEMBER_MANAGE_FORBIDDEN");

  const expiredService = createCloudPromptService({
    mockEnabled: true,
    fixture: {
      account: { id: "owner-user", displayName: "所有者" },
      workspaces: [{ id: "owner-space", name: "所有者空间", kind: "personal", role: "owner", revision: 1, permissions: { canRead: true, canCreate: true, canEdit: true, canDelete: true, canShare: true } }],
      templates: [],
      members: [],
      invitations: [{ id: "expired-invite", workspaceId: "owner-space", workspaceName: "所有者空间", role: "viewer", status: "pending", expiresAt: "2020-01-01T00:00:00.000Z" }],
    },
  });
  const expired = await expiredService.invoke({ operation: "invitation.accept", invitationId: "expired-invite" });
  assert.equal(expired.ok, false);
  assert.equal(expired.status, 410);
  assert.equal(expired.code, "PROMPT_INVITATION_EXPIRED");
}

async function testWorkspaceSendMenuIsNotClipped() {
  const source = fs.readFileSync(path.join(__dirname, "../electron/preload/desktop-patches.cjs"), "utf8");
  assert.match(source, /\.wanjuan-workspace-card\{[^}]*position:relative[^}]*overflow:visible/, "template card must allow its send menu to escape the card bounds");
  assert.match(source, /\.wanjuan-workspace-card:has\(\.wanjuan-workspace-send-menu\[open\]\)\{z-index:50\}/, "open send menu card must stack above neighboring cards");
  assert.match(source, /\.wanjuan-workspace-card-media\{[^}]*overflow:hidden[^}]*border-radius:9px 0 0 9px/, "media must preserve the card's rounded clipping after the card becomes overflow-visible");
  assert.match(source, /\.wanjuan-workspace-send-menu-list\{[^}]*position:absolute[^}]*z-index:40/, "send menu must remain an absolute overlay");
}

async function main() {
  if (electronApp) {
    await electronApp.whenReady();
    assert.equal(electronApp.getPath("userData"), electronTemporaryUserData);
  }
  await testDtoWhitelist();
  await testCacheIsolationAndRevocation();
  await testHeadersAndOutboundBody();
  await testMockApiAndConflict();
  await testPermissionDefaults();
  await testConflictDetailsPreserved();
  await testSendTargetsAndCloudCopy();
  await testWorkspaceSyncScopeRace();
  await testSharingContractsAndUi();
  await testWorkspaceSendMenuIsNotClipped();
  console.log("cloud prompt tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (!electronApp) return;
  try { fs.rmSync(electronTemporaryUserData, { recursive: true, force: true }); } catch {}
  try { electronApp.exit(Number(process.exitCode || 0)); } catch {}
});
