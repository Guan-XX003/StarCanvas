// Real macOS Security/CryptoKit test. Creates only a unique synthetic item.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');

test('macOS account helper: encrypted roundtrip, concurrency and fail-closed behavior', {skip: process.platform !== 'darwin', timeout:120000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-account-helper-'));
  const executable = path.join(dir, 'helper');
  const source = path.join(__dirname, '..', 'electron', 'native', 'macos-account-keychain.swift');
  const service = `org.starcanvas.account-secret.qa.${crypto.randomUUID().toUpperCase()}`;
  const env = {...process.env, STARCANVAS_KEYCHAIN_QA:'1'};
  const fixture = 'SYNTHETIC_ACCOUNT_FIXTURE_ONLY';
  let compiled = false;
  const itemStatus = () => spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'account-encryption-key'], {encoding:'utf8', timeout:10000});
  function request(operation, value, extra = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [], {env:{...env, ...extra}, stdio:['pipe','pipe','pipe']});
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('HELPER_TIMEOUT')); }, 10000);
      child.stdout.on('data', b => {stdout += b; if(stdout.length > 131072) child.kill('SIGKILL');});
      child.stderr.on('data', b => {stderr += b; if(stderr.length > 4096) child.kill('SIGKILL');});
      child.on('error', error => {clearTimeout(timer);reject(error);});
      child.on('close', code => {clearTimeout(timer);try {resolve({code, body:JSON.parse(stdout), stderr});} catch {reject(Error('HELPER_INVALID_RESPONSE'));}});
      child.stdin.end(JSON.stringify({operation, value, qaService:service}));
    });
  }
  try {
    if (process.env.STARCANVAS_TEST_FROZEN_HELPER === '1') {
      fs.copyFileSync(path.join(__dirname, '..', 'build', 'native-tools', 'macos-account-keychain'), executable, fs.constants.COPYFILE_EXCL);
      const verified = spawnSync('/usr/bin/codesign', ['--verify','--strict',executable], {encoding:'utf8',timeout:10000});
      assert.equal(verified.status, 0, 'frozen helper must retain its signature'); compiled = true;
    } else {
      const built = spawnSync('/usr/bin/xcrun', ['swiftc', source, '-o', executable], {encoding:'utf8',timeout:90000});
      assert.equal(built.status, 0, 'native helper must compile'); compiled = true;
      const signed = spawnSync('/usr/bin/codesign', ['--force','--sign','-','--identifier','org.starcanvas.account-keychain-helper',executable], {encoding:'utf8',timeout:10000});
      assert.equal(signed.status, 0, 'native helper must be signed');
    }
    assert.equal(itemStatus().status, 44, 'synthetic item must not exist before test');
    const missing = await request('decrypt', Buffer.alloc(29).toString('base64'));
    assert.equal(missing.body.code, 'KEY_MISSING');
    assert.equal(itemStatus().status, 44, 'decrypt must never create a key');
    const encrypted = await Promise.all(Array.from({length:8}, (_, i) => request('encrypt', `${fixture}-${i}`)));
    assert.ok(encrypted.every(r => r.code === 0 && r.body.ok && !r.stderr));
    assert.ok(encrypted.every(r => !r.body.value.includes(fixture)));
    const decrypted = await Promise.all(encrypted.map(r => request('decrypt', r.body.value)));
    assert.deepEqual(decrypted.map(r => r.body.value), encrypted.map((_,i) => `${fixture}-${i}`));
    const tampered = Buffer.from(encrypted[0].body.value, 'base64'); tampered[tampered.length-1] ^= 1;
    const rejected = await request('decrypt', tampered.toString('base64'));
    assert.equal(rejected.body.code, 'DECRYPT_FAILED');
    const forbidden = await request('encrypt', fixture, {STARCANVAS_KEYCHAIN_QA:'0'});
    assert.equal(forbidden.body.code, 'INVALID_TEST_SCOPE');
    const deleted = await request('qa-delete', ''); assert.equal(deleted.body.ok, true);
    assert.equal(itemStatus().status, 44, 'only synthetic item is removed');
    const after = await request('decrypt', encrypted[0].body.value);
    assert.equal(after.body.code, 'KEY_MISSING');
  } finally {
    if (compiled && itemStatus().status === 0) {
      const cleanup = await request('qa-delete', '');
      assert.equal(cleanup.body.ok, true, 'synthetic Keychain cleanup must succeed');
    }
    assert.equal(itemStatus().status, 44, 'synthetic Keychain item must be absent');
    if (fs.existsSync(executable)) fs.unlinkSync(executable);
    fs.rmdirSync(dir);
  }
});
