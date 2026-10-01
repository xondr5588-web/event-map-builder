import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  Repository,
  ConflictError,
  writeJournal,
  recoverJournals,
} from "../src/storage.js";
import { newProject, newObject, uid, clone } from "../src/model.js";
class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  get length() {
    return this.data.size;
  }
  key(i) {
    return [...this.data.keys()][i];
  }
  getItem(k) {
    return this.data.get(k) ?? null;
  }
  setItem(k, v) {
    this.data.set(k, String(v));
  }
  removeItem(k) {
    this.data.delete(k);
  }
}
const old = {
  areas: [],
  lines: [],
  markers: [{ id: "old", name: "직원", kind: "staff", lat: 35, lng: 128 }],
};
const repository = () => new Repository("test-" + uid()).open();
test("migration backs up exact originals, preserves localStorage, is idempotent, imports versions", async () => {
  const repo = await repository(),
    ls = new MemoryStorage();
  const raw = JSON.stringify({ data: old, ts: 1 });
  ls.setItem("event_map_v10_12_autosave", raw);
  ls.setItem(
    "event_map_v10_12_versions",
    JSON.stringify([{ id: "v", ts: 2, title: "기존버전", data: old }]),
  );
  const messages = await repo.migrateLegacy(ls),
    list = await repo.list();
  assert.equal(messages.length, 2);
  assert.equal(list.length, 1);
  assert.equal(ls.getItem("event_map_v10_12_autosave"), raw);
  assert.equal(
    (await repo.read("legacy", "event_map_v10_12_autosave")).raw,
    raw,
  );
  assert.equal((await repo.versions(list[0].id)).length, 1);
  await repo.migrateLegacy(ls);
  assert.equal((await repo.list()).length, 1);
  repo.close();
});
test("bad legacy data is quarantined without replacing existing projects", async () => {
  const repo = await repository(),
    ls = new MemoryStorage();
  await repo.save(newProject("safe"), 0);
  ls.setItem("event_map_v10_12_autosave", "broken");
  const result = await repo.migrateLegacy(ls);
  assert.match(result[0], /원본/);
  assert.equal((await repo.list())[0].title, "safe");
  assert.equal(
    (await repo.read("legacy", "event_map_v10_12_autosave")).raw,
    "broken",
  );
  repo.close();
});
test("optimistic revision protects other tabs and deleted projects", async () => {
  const repo = await repository();
  let p = await repo.save(newProject(), 0);
  const stale = clone(p);
  p.title = "new";
  p = await repo.save(p, p.revision);
  await assert.rejects(repo.save(stale, stale.revision), ConflictError);
  await repo.trash(p.id);
  await assert.rejects(repo.save(p, p.revision), ConflictError);
  const restored = await repo.restore(p.id);
  assert.equal(restored.title, "new");
  repo.close();
});
test("restore journal after interrupted save; collision creates a separate recovery copy", async () => {
  const repo = await repository(),
    ls = new MemoryStorage();
  let p = await repo.save(newProject(), 0);
  const pending = clone(p);
  pending.title = "unsaved";
  pending.updatedAt = p.updatedAt + 1000;
  writeJournal(ls, pending);
  await recoverJournals(repo, ls);
  assert.equal((await repo.read("projects", p.id)).title, "unsaved");
  assert.equal(ls.length, 0);
  p = await repo.read("projects", p.id);
  const stale = clone(p);
  p.title = "another tab";
  await repo.save(p, p.revision);
  stale.title = "recovery";
  stale.updatedAt = Date.now() + 2000;
  writeJournal(ls, stale);
  await recoverJournals(repo, ls);
  const list = await repo.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((p) => p.title.includes("복구 사본")));
  repo.close();
});
test("full backup import is atomic, assigns new IDs, remaps versions", async () => {
  const repo = await repository();
  let p = await repo.save(newProject(), 0);
  await repo.checkpoint(p, "manual");
  const backup = await repo.backup();
  const added = await repo.importAll(backup.projects, backup.versions);
  assert.notEqual(added[0].id, p.id);
  assert.equal((await repo.versions(added[0].id)).length, 1);
  const bad = newProject();
  bad.objects = [{ type: "marker", position: { lat: 900, lng: 1 } }];
  await assert.rejects(repo.importAll([p, bad]));
  assert.equal((await repo.list()).length, 2);
  repo.close();
});
test("hundreds of objects and repeated checkpoints preserve final data", async () => {
  const repo = await repository();
  let p = newProject("stress");
  p.objects = Array.from({ length: 750 }, (_, i) =>
    newObject("marker", "parkingStaff", [{ lat: 35 + i * 0.00001, lng: 128 }]),
  );
  p = await repo.save(p, 0);
  for (let i = 0; i < 45; i++) await repo.checkpoint(p, "snapshot");
  assert.equal((await repo.versions(p.id)).length, 40);
  assert.equal((await repo.read("projects", p.id)).objects.length, 750);
  repo.close();
});

test("recovery preserves older conflicting journal instead of dropping edits by timestamp", async () => {
  const repo = await repository(),
    ls = new MemoryStorage();
  let p = await repo.save(newProject("saved"), 0);
  const pending = clone(p);
  pending.title = "unsaved before other window";
  pending.updatedAt = 1;
  p.title = "newer window";
  p = await repo.save(p, p.revision);
  writeJournal(ls, pending);
  await recoverJournals(repo, ls);
  assert.equal((await repo.list()).length, 2);
  assert.ok(
    (await repo.list()).some((p) => p.title.includes("unsaved before")),
  );
  repo.close();
});

test("full backup preserves trash and raw legacy originals on import", async () => {
  const repo = await repository();
  const p = await repo.save(newProject("trash"), 0);
  await repo.trash(p.id);
  await repo.put("legacy", { id: "original", raw: "exact raw bytes", ts: 1 });
  const backup = await repo.backup();
  const { parseImport } = await import("../src/model.js");
  const parsed = parseImport(JSON.stringify(backup));
  await repo.importAll(parsed.projects, parsed.versions, parsed.legacyBackups);
  assert.equal((await repo.list()).length, 0);
  assert.equal((await repo.list(true)).length, 2);
  assert.equal((await repo.all("legacy")).length, 2);
  repo.close();
});
