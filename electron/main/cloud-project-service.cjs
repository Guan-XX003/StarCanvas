// Main-process cloud project metadata client. No IPC/UI exposure yet.
const { AccountRequestError, accountApiUrl, createAccountOperationGuard, readAccountState,
  requestWithAccountAuth } = require("./account-service.cjs");

const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,180}$/;
function invalid() { throw new AccountRequestError("云项目数据格式无效", { code: "CLOUD_PROJECT_INVALID" }); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(entries).sort().join(",") !== [...keys].sort().join(",") || Object.values(entries).some((d) => !("value" in d))) invalid();
  return value;
}
function integer(value, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) invalid(); return value; }
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) invalid(); return value; }
function ref(value) {
  object(value, ["sha256", "size"]);
  return { sha256: hash(value.sha256), size: integer(value.size) };
}
function asset(value) {
  object(value, ["assetId", "blob"]);
  return { assetId: hash(value.assetId), blob: ref(value.blob) };
}
function assets(value) {
  if (!Array.isArray(value) || value.length > 10000) invalid();
  const result = value.map(asset);
  if (new Set(result.map((item) => item.assetId)).size !== result.length) invalid();
  return result;
}
function snapshot(value) {
  object(value, ["version", "projectId", "baseRevision", "state", "assets"]);
  if (value.version !== 1) invalid();
  return { version: 1, projectId: hash(value.projectId), baseRevision: integer(value.baseRevision),
    state: ref(value.state), assets: assets(value.assets) };
}
function quota(value) {
  object(value, ["limitBytes", "usedBytes", "reservedBytes", "availableBytes"]);
  const limitBytes = integer(value.limitBytes, 1), usedBytes = integer(value.usedBytes),
    reservedBytes = integer(value.reservedBytes), availableBytes = integer(value.availableBytes);
  if (usedBytes > limitBytes || reservedBytes > limitBytes - usedBytes || availableBytes !== limitBytes - usedBytes - reservedBytes) invalid();
  return { limitBytes, usedBytes, reservedBytes, availableBytes };
}
function createCloudProjectSession() {
  const guard = createAccountOperationGuard();
  const user = readAccountState().user;
  if (!user || !String(user.id || user.userId || user.accountId || "")) {
    throw new AccountRequestError("请先登录StarCanvas账号", { code: "AUTH_REQUIRED", status: 401 });
  }
  async function request(pathname, options) {
    guard();
    const result = await requestWithAccountAuth(accountApiUrl(), pathname, options);
    guard();
    return result;
  }
  return {
    async quota() { return quota(await request("/cloud-projects/quota")); },
    async list({ cursor = null, limit = 50 } = {}) {
      integer(limit, 1); if (limit > 100) invalid();
      if (cursor !== null) hash(cursor);
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) query.set("cursor", cursor);
      const result = await request(`/cloud-projects?${query}`);
      object(result, ["items", "nextCursor"]);
      if (!Array.isArray(result.items) || result.items.length > limit) invalid();
      const items = result.items.map((item) => { object(item, ["projectId", "revision"]);
        return { projectId: hash(item.projectId), revision: integer(item.revision, 1) }; });
      if (result.nextCursor !== null) hash(result.nextCursor);
      return { items, nextCursor: result.nextCursor };
    },
    async read(projectId, revision = null) {
      hash(projectId);
      if (revision !== null) integer(revision, 1);
      const result = await request(`/cloud-projects/${projectId}${revision === null ? "" : `?revision=${revision}`}`);
      object(result, ["version", "projectId", "revision", "baseRevision", "state", "assets"]);
      if (result.version !== 1 || result.projectId !== projectId || integer(result.revision, 1) !== integer(result.baseRevision) + 1 ||
          (revision !== null && result.revision !== revision)) invalid();
      return { version: 1, projectId, revision: result.revision, baseRevision: result.baseRevision,
        state: ref(result.state), assets: assets(result.assets) };
    },
    async commit(input, idempotencyKey) {
      const body = snapshot(input);
      if (typeof idempotencyKey !== "string" || !IDEMPOTENCY.test(idempotencyKey)) invalid();
      const result = await request("/cloud-projects/snapshots", { method: "POST", body,
        headers: { "idempotency-key": idempotencyKey } });
      object(result, ["projectId", "revision", "replayed"]);
      if (result.projectId !== body.projectId || integer(result.revision, 1) !== body.baseRevision + 1 ||
          typeof result.replayed !== "boolean") invalid();
      return { projectId: result.projectId, revision: result.revision, replayed: result.replayed };
    },
  };
}

module.exports = { createCloudProjectSession };
