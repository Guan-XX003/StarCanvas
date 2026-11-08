const fs = require("node:fs");
const path = require("node:path");

function ensureOwnerOnlyQaDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("QA evidence directory must be a real directory");
  try { fs.chmodSync(directory, 0o700); } catch {}
  if (process.platform !== "win32" && (fs.statSync(directory).mode & 0o077) !== 0) throw new Error("QA evidence directory must be owner-only");
}

function fsyncFile(descriptor) {
  try {
    fs.fsyncSync(descriptor);
  } catch {
    throw new Error("QA evidence write durability failed");
  }
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    throw new Error("QA evidence directory durability failed");
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function atomicWriteBuffer(filename, value) {
  const target = path.resolve(filename);
  const parent = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  let renamed = false;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, value);
    fsyncFile(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try { fs.chmodSync(temporary, 0o600); } catch {}
    fs.renameSync(temporary, target);
    renamed = true;
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (!renamed) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    throw error;
  }
}

function atomicWriteJson(filename, value) {
  atomicWriteBuffer(filename, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function claimOwnerMarker(filename, value) {
  const target = path.resolve(filename);
  let descriptor;
  try {
    descriptor = fs.openSync(target, "wx", 0o600);
    fs.writeFileSync(descriptor, Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
    fsyncFile(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(target));
}

function restoreWritableForCleanup(root) {
  const absoluteRoot = path.resolve(root);
  const visit = (target) => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) visit(path.join(target, name));
      fs.chmodSync(target, 0o700);
      return;
    }
    if (stat.isFile()) fs.chmodSync(target, 0o600);
  };
  visit(absoluteRoot);
}

module.exports = { ensureOwnerOnlyQaDirectory, atomicWriteBuffer, atomicWriteJson, claimOwnerMarker, restoreWritableForCleanup };
