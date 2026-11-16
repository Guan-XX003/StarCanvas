const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wanjuan-storage-electron-"));
app.setPath("userData", path.join(root, "user-data"));

app.whenReady().then(async () => {
  const {
    persistProjectAsset,
    diagnoseProjectAssets,
    copyExternalProjectAssetFiles,
    loadProjectAssetManifests,
    findAssetFromManifests,
    resolveExternalAssetManifestFile,
    removeProjectAssets
  } = require("../electron/main/assets/project-assets.cjs");
  const {
    beginProjectMigration,
    getProjectMigration,
    listIncompleteMigrations,
    saveProjectMigrationSnapshot,
    loadProjectMigrationSnapshot,
    cancelProjectMigration,
    commitProjectMigration,
    rollbackProjectMigration,
    cleanupUnreferencedBlobs,
    syncProjectReferences
  } = require("../electron/main/assets/migration-manager.cjs");
  const {
    rebuildReferenceIndex,
    scanReclaimable,
    listTrash,
    restoreTrash,
    purgeTrash
  } = require("../electron/main/assets/storage-optimization.cjs");
  const payload = {
    arrayBuffer: Buffer.alloc(4096, 7),
    mime: "video/mp4",
    filename: "result.mp4",
    directory: root,
    projectId: "project-a",
    nodeId: "node-a",
    field: "videoUrl",
    kind: "video",
    storageOptimizationEnabled: true
  };

  const legacy = await persistProjectAsset({ ...payload, projectId: "legacy-project", storageOptimizationEnabled: false });
  assert.equal(legacy.contentAddressed, false);
  assert.equal(legacy.localPath.includes(`${path.sep}legacy-project${path.sep}assets${path.sep}`), true);
  const first = await persistProjectAsset(payload);
  const second = await persistProjectAsset({ ...payload, nodeId: "node-b" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.localPath, second.localPath);
  assert.equal(first.created, undefined);
  assert.equal(first.contentAddressed, true);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(fs.readFileSync(first.localPath).length, 4096);
  const rehomed = await persistProjectAsset({
    localPath: first.localPath,
    mime: "video/mp4",
    filename: "rehomed.mp4",
    directory: root,
    projectId: "project-b",
    nodeId: "node-c",
    field: "videoUrl",
    kind: "video",
    forceArchiveExistingFile: true
  });
  assert.equal(rehomed.ok, true);
  assert.equal(rehomed.archivedFromExistingFile, true);
  assert.equal(rehomed.localPath.includes(`${path.sep}_blobs${path.sep}blobs${path.sep}`), true);
  assert.equal(fs.readFileSync(rehomed.localPath).length, 4096);
  assert.equal(rehomed.localPath, first.localPath);

  const report = diagnoseProjectAssets({ directory: root });
  assert.equal(report.ok, true);
  assert.equal(report.fileCount, 2);
  assert.equal(report.duplicateFileCount, 1);
  const unavailableDirectory = path.join(root, "not-a-directory");
  fs.writeFileSync(unavailableDirectory, "x");
  assert.equal(beginProjectMigration({ directory: unavailableDirectory, projectId: "blocked" }).error, "MIGRATION_DIRECTORY_UNAVAILABLE");
  assert.equal(beginProjectMigration({ directory: root, projectId: "too-large", requiredBytes: Number.MAX_SAFE_INTEGER }).error, "INSUFFICIENT_DISK_SPACE");

  const migration = beginProjectMigration({ directory: root, projectId: "migration-project", total: 2 });
  assert.equal(migration.ok, true);
  assert.equal(beginProjectMigration({ directory: root, projectId: "migration-project" }).error, "PROJECT_MIGRATION_LOCKED");
  const migrated = await persistProjectAsset({
    ...payload,
    directory: root,
    projectId: "migration-project",
    migrationId: migration.migrationId
  });
  assert.equal(migrated.ok, true);
  const migrationSnapshot = saveProjectMigrationSnapshot({
    migrationId: migration.migrationId,
    projectId: "migration-project",
    state: { nodes: [{ id: "before" }] }
  });
  assert.equal(migrationSnapshot.ok, true);
  assert.deepEqual(loadProjectMigrationSnapshot({ migrationId: migration.migrationId }).state.nodes, [{ id: "before" }]);
  assert.equal(getProjectMigration({ migrationId: migration.migrationId }).session.progress.completed, 1);
  const failedCommit = commitProjectMigration({
    migrationId: migration.migrationId,
    references: [path.join(root, "missing.mp4")]
  });
  assert.equal(failedCommit.error, "MIGRATION_REFERENCE_MISSING");
  const outsidePath = path.join(root, "outside.mp4");
  fs.writeFileSync(outsidePath, Buffer.alloc(1));
  const outsideCommit = commitProjectMigration({
    migrationId: migration.migrationId,
    references: [outsidePath],
    requireGlobalBlobs: true
  });
  assert.equal(outsideCommit.error, "MIGRATION_REFERENCE_OUTSIDE_BLOB_STORE");
  assert.equal(rollbackProjectMigration({ migrationId: migration.migrationId, error: "injected" }).ok, true);
  assert.equal(fs.existsSync(migrationSnapshot.path), false);

  const cancelled = beginProjectMigration({ directory: root, projectId: "cancelled-project" });
  assert.equal(cancelProjectMigration({ migrationId: cancelled.migrationId }).ok, true);
  assert.equal(beginProjectMigration({ directory: root, projectId: "cancelled-project" }).error, "PROJECT_MIGRATION_LOCKED");
  await assert.rejects(
    () => persistProjectAsset({ ...payload, directory: root, projectId: "cancelled-project", migrationId: cancelled.migrationId }),
    /MIGRATION_CANCELLED/
  );
  assert.equal(rollbackProjectMigration({ migrationId: cancelled.migrationId, error: "cancelled" }).ok, true);
  assert.equal(beginProjectMigration({ directory: root, projectId: "cancelled-project" }).ok, true);

  const committed = beginProjectMigration({ directory: root, projectId: "committed-project" });
  assert.equal(commitProjectMigration({
    migrationId: committed.migrationId,
    references: [first.localPath],
    requireGlobalBlobs: true
  }).ok, true);
  const cleanupPreview = cleanupUnreferencedBlobs({ directory: root });
  assert.equal(cleanupPreview.error, "REFERENCE_INDEX_INCOMPLETE");
  const blockedCleanup = cleanupUnreferencedBlobs({ directory: root, confirm: true });
  assert.equal(blockedCleanup.error, "REFERENCE_INDEX_INCOMPLETE");
  const interrupted = beginProjectMigration({ directory: root, projectId: "interrupted-project" });
  const interruptedSnapshot = saveProjectMigrationSnapshot({
    migrationId: interrupted.migrationId,
    projectId: "interrupted-project",
    state: { nodes: [] }
  });
  assert.equal(interruptedSnapshot.ok, true);
  assert.equal(listIncompleteMigrations({ directory: root }).migrations.some((entry) => entry.id === interrupted.migrationId), false);
  const managerPath = require.resolve("../electron/main/assets/migration-manager.cjs");
  delete require.cache[managerPath];
  const restartedManager = require("../electron/main/assets/migration-manager.cjs");
  assert.equal(restartedManager.listIncompleteMigrations({ directory: root }).migrations.some((entry) => entry.id === interrupted.migrationId), true);
  assert.deepEqual(
    restartedManager.loadProjectMigrationSnapshot({ migrationId: interrupted.migrationId }).state,
    { nodes: [] }
  );
  assert.equal(restartedManager.rollbackProjectMigration({
    directory: root,
    migrationId: interrupted.migrationId
  }).ok, true);
  assert.equal(fs.existsSync(interruptedSnapshot.path), false);
  const cancelledRecovery = restartedManager.beginProjectMigration({ directory: root, projectId: "cancelled-recovery-project" });
  const cancelledRecoverySnapshot = restartedManager.saveProjectMigrationSnapshot({
    migrationId: cancelledRecovery.migrationId,
    projectId: "cancelled-recovery-project",
    state: { nodes: [{ id: "cancelled-before-crash" }] }
  });
  restartedManager.cancelProjectMigration({ migrationId: cancelledRecovery.migrationId });
  delete require.cache[managerPath];
  const recoveredCancelledManager = require("../electron/main/assets/migration-manager.cjs");
  assert.equal(
    recoveredCancelledManager.listIncompleteMigrations({ directory: root }).migrations.some(
      (entry) => entry.id === cancelledRecovery.migrationId
    ),
    true
  );
  assert.equal(recoveredCancelledManager.rollbackProjectMigration({
    directory: root,
    migrationId: cancelledRecovery.migrationId
  }).ok, true);
  assert.equal(fs.existsSync(cancelledRecoverySnapshot.path), false);

  assert.equal(syncProjectReferences({
    directory: root,
    projectId: "referenced-project",
    references: [first.localPath],
    complete: true
  }).ok, true);
  const orphanPath = path.join(path.dirname(first.localPath), "orphan.mp4");
  fs.writeFileSync(orphanPath, Buffer.alloc(3, 9));
  const index = rebuildReferenceIndex({
    directory: root,
    projects: [
      { projectId: "referenced-project", references: [first.localPath], complete: true }
    ]
  });
  assert.equal(index.ok, true);
  assert.equal(index.index.complete, true);
  assert.equal(scanReclaimable({ directory: root }).candidateCount, 1);
  const cleanup = cleanupUnreferencedBlobs({
    directory: root,
    confirm: true
  });
  assert.equal(cleanup.ok, true);
  assert.equal(fs.existsSync(first.localPath), true);
  assert.equal(fs.existsSync(orphanPath), false);
  assert.equal(listTrash({ directory: root }).totalFiles, 1);
  assert.equal(restoreTrash({ directory: root }).restoredCount, 1);
  assert.equal(fs.existsSync(orphanPath), true);
  cleanupUnreferencedBlobs({ directory: root, confirm: true });
  assert.equal(purgeTrash({ directory: root, confirm: true, force: true }).purgedFiles, 1);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const image = await persistProjectAsset({
    arrayBuffer: png,
    mime: "image/png",
    filename: "result.png",
    directory: root,
    projectId: "project-a",
    nodeId: "image-node",
    field: "imageUrl",
    kind: "image",
    storageOptimizationEnabled: true
  });
  assert.equal(image.ok, true);
  assert.equal(image.valueFormat, "file-url");
  assert.equal(image.value, undefined);
  assert.equal(image.localPath.endsWith(".png"), true);

  const backupTarget = path.join(root, "backup.json");
  const bundle = copyExternalProjectAssetFiles(backupTarget, [
    { projectId: "project-a", nodeId: "image-a", field: "imageUrl", assetId: "asset-a", kind: "image", mime: "image/png", path: image.localPath },
    { projectId: "project-a", nodeId: "image-b", field: "imageUrl", assetId: "asset-b", kind: "image", mime: "image/png", path: image.localPath }
  ], "backup-assets");
  assert.equal(bundle.manifest.files.length, 2);
  assert.equal(bundle.manifest.physicalFileCount, 1);
  assert.equal(bundle.manifest.files[0].filename, bundle.manifest.files[1].filename);
  assert.equal(bundle.manifest.files[1].deduplicated, true);
  assert.equal(fs.readdirSync(bundle.folderPath).filter((name) => name !== "wanjuan-external-assets-manifest.json").length, 1);
  const portableManifestFile = path.join(bundle.folderPath, "wanjuan-external-assets-manifest.json");
  const portableManifestText = fs.readFileSync(portableManifestFile, "utf8");
  const portableManifest = JSON.parse(portableManifestText);
  assert.equal(portableManifestText.includes(image.localPath), false, "backup manifest must not reveal the original local path");
  assert.ok(portableManifest.files.every(entry => !Object.hasOwn(entry, "sourcePath")));
  const reloadedManifests = loadProjectAssetManifests([portableManifestFile]);
  const restoredPath = findAssetFromManifests({nodeId:"image-a",field:"imageUrl"}, reloadedManifests);
  assert.equal(restoredPath, path.join(bundle.folderPath, portableManifest.files[0].filename));
  assert.deepEqual(fs.readFileSync(restoredPath), png, "portable restore still resolves the original bytes");
  assert.equal(bundle.manifest.files[0].sourcePath, image.localPath, "in-memory diagnostics remain available to the caller");
  const oldManifestDir = path.join(root, "legacy-backup-assets");
  fs.mkdirSync(oldManifestDir);
  fs.writeFileSync(path.join(oldManifestDir, "legacy.png"), png);
  const oldManifestFile = path.join(oldManifestDir, "wanjuan-external-assets-manifest.json");
  fs.writeFileSync(oldManifestFile, JSON.stringify({version:2, files:[{nodeId:"old-node", field:"imageUrl", filename:"legacy.png", sourcePath:"/synthetic/old/path.png", size:png.length}]}));
  const oldMatch = findAssetFromManifests({nodeId:"old-node",field:"imageUrl"},loadProjectAssetManifests([oldManifestFile]));
  assert.equal(oldMatch, path.join(oldManifestDir, "legacy.png"), "older manifests containing sourcePath stay readable");
  assert.deepEqual(fs.readFileSync(oldMatch), png);

  const sentinelFolder = path.join(root, "backup-assets");
  fs.mkdirSync(sentinelFolder, { recursive: true });
  fs.writeFileSync(path.join(sentinelFolder, "sentinel.txt"), "keep");
  const failedBundle = copyExternalProjectAssetFiles(path.join(root, "other.json"), [
    { projectId: "project-a", nodeId: "missing", field: "imageUrl", assetId: "missing", kind: "image", path: path.join(root, "does-not-exist.png") }
  ], "backup-assets");
  assert.equal(failedBundle.failed, 1);
  assert.equal(failedBundle.manifest.files[0].sourcePath, path.join(root, "does-not-exist.png"), "failed source remains available for the local warning");
  assert.equal(fs.readFileSync(path.join(sentinelFolder, "sentinel.txt"), "utf8"), "keep");

  const manifestDir = path.join(root, "manifest-check");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestFile = path.join(manifestDir, "safe.png");
  fs.writeFileSync(manifestFile, Buffer.from("safe"));
  const manifestEntry = { filename: "safe.png", size: 4, sha256: require("../electron/main/utils/crypto.cjs").sha256File(manifestFile) };
  assert.equal(resolveExternalAssetManifestFile(manifestDir, manifestEntry), fs.realpathSync(manifestFile));
  const outsideFile = path.join(root, "outside.png");
  fs.writeFileSync(outsideFile, Buffer.from("outside"));
  fs.symlinkSync(outsideFile, path.join(manifestDir, "linked.png"));
  assert.equal(resolveExternalAssetManifestFile(manifestDir, { filename: "linked.png", size: 7 }), "");
  const linkedManifestDir = path.join(root, "linked-manifest-check");
  fs.symlinkSync(manifestDir, linkedManifestDir);
  assert.equal(resolveExternalAssetManifestFile(linkedManifestDir, manifestEntry), "");
  await assert.rejects(() => removeProjectAssets({ directory: root, projectId: "_blobs" }), /PROJECT_ASSET_PROJECT_ID_INVALID/);
  assert.equal(fs.existsSync(path.join(root, "媒体库", "_blobs")), false);

  console.log("storage lab electron integration passed");
}).then(() => {
  fs.rmSync(root, { recursive: true, force: true });
  app.quit();
}).catch((error) => {
  console.error(error);
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(1);
});
