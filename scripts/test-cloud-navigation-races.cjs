const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudPromptStore, createMemoryCloudPromptAdapter } = require('../electron/preload/cloud-prompt-store.cjs');
const { createCloudPromptWorkspaceController } = require('../electron/preload/cloud-prompt-workspace.cjs');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const workspace = id => ({ id, kind: 'personal', role: 'owner', permissions: { canRead: true, canShare: true, canEdit: true } });
const store = () => createCloudPromptStore({ adapter: createMemoryCloudPromptAdapter() });

test('late bootstrap cannot restore a logged-out account', async () => {
  const pending = deferred();
  const controller = createCloudPromptWorkspaceController({ store: store(), invoke: () => pending.promise });
  const request = controller.prepare({ force: true });
  controller.reset();
  pending.resolve({ authenticated: true, account: { id: 'old' }, workspaces: [workspace('old-space')] });
  await request;
  assert.equal(controller.peek().authenticated, false);
  assert.equal(controller.peek().account, null);
});

test('old bootstrap cannot replace a newer login or end its loading state', async () => {
  const old = deferred();
  const current = deferred();
  let count = 0;
  const controller = createCloudPromptWorkspaceController({ store: store(), invoke: () => (++count === 1 ? old.promise : current.promise) });
  const oldRequest = controller.prepare({ force: true });
  controller.reset();
  const currentRequest = controller.prepare({ force: true });
  old.resolve({ authenticated: true, account: { id: 'old' }, workspaces: [workspace('old-space')] });
  await oldRequest;
  assert.equal(controller.peek().loading, true);
  current.resolve({ authenticated: true, account: { id: 'new' }, workspaces: [workspace('new-space')] });
  await currentRequest;
  assert.equal(controller.peek().account.id, 'new');
  assert.equal(controller.peek().activeWorkspaceId, 'new-space');
  assert.equal(controller.peek().loading, false);
});

test('late sharing response cannot overwrite the newly selected workspace', async () => {
  const member = deferred();
  const started = deferred();
  const controller = createCloudPromptWorkspaceController({ store: store(), invoke: async p => {
    if (p.operation === 'bootstrap') return { authenticated: true, account: { id: 'a' }, workspaces: [workspace('one'), workspace('two')] };
    if (p.operation === 'member.list') { started.resolve(); return member.promise; }
    return { ok: true, items: [], tombstones: [] };
  }});
  await controller.prepare({ force: true });
  const sharing = controller.handleAction('cloud-sharing-open');
  await started.promise;
  await controller.handleField('cloudWorkspaceId', 'two');
  member.resolve({ ok: true, items: [{ userId: 'old-member' }] });
  await sharing;
  assert.equal(controller.peek().activeWorkspaceId, 'two');
  assert.deepEqual(controller.peek().members, []);
  assert.equal(controller.peek().activeSection, 'templates');
  assert.equal(controller.peek().membersLoading, false);
});

test('late invitation response cannot restore sharing after logout', async () => {
  const inbox = deferred();
  const started = deferred();
  const controller = createCloudPromptWorkspaceController({ store: store(), invoke: async p => {
    if (p.operation === 'bootstrap') return { authenticated: true, account: { id: 'a' }, workspaces: [workspace('one')] };
    if (p.operation === 'invitation.inbox') { started.resolve(); return inbox.promise; }
    return { ok: true, items: [] };
  }});
  await controller.prepare({ force: true });
  const sharing = controller.handleAction('cloud-sharing-open');
  await started.promise;
  controller.reset();
  inbox.resolve({ ok: true, items: [{ id: 'old-invitation' }] });
  await sharing;
  assert.equal(controller.peek().authenticated, false);
  assert.deepEqual(controller.peek().invitationInbox, []);
  assert.equal(controller.peek().activeSection, 'templates');
});

test('switching workspace during an upload preserves pending work', async () => {
  const data = store();
  const upload = deferred();
  const started = deferred();
  let calls = 0;
  const controller = createCloudPromptWorkspaceController({ store: data, invoke: async p => {
    if (p.operation === 'bootstrap') return { authenticated: true, account: { id: 'a' }, workspaces: [workspace('one'), workspace('two')] };
    if (p.operation === 'template.update') {
      if (++calls === 1) { started.resolve(); return upload.promise; }
      return { ok: false, status: 409, conflict: { serverVersion: { id: 'draft', revision: 2, content: 'pending' } } };
    }
    return { ok: true, items: [], tombstones: [] };
  }});
  await controller.prepare({ force: true });
  await data.putTemplate('a', 'one', { id: 'draft', title: 'draft', content: 'pending' }, 'pending-update');
  await data.enqueue({ id: 'pending', accountId: 'a', workspaceId: 'one', operation: 'template.update', templateId: 'draft' });
  const first = controller.syncActiveWorkspace();
  await started.promise;
  const second = controller.handleField('cloudWorkspaceId', 'two');
  upload.resolve({ ok: true, item: { id: 'draft' } });
  await Promise.all([first, second]);
  assert.equal((await data.listQueue('a', 'one')).length, 1);
  assert.equal((await data.listTemplates('a', 'one'))[0].content, 'pending');
  await controller.handleField('cloudWorkspaceId', 'one');
  const draft = (await data.listTemplates('a', 'one'))[0];
  assert.equal(draft.syncStatus, 'conflict');
  assert.equal(draft.content, 'pending');
  assert.equal(draft.conflict.serverVersion.revision, 2);
  assert.equal((await data.listQueue('a', 'one')).length, 0);
});
