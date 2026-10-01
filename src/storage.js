import { clone, migrate, uid } from "./model.js";
const request = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const completed = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(tx.error || new Error("저장 작업이 취소되었습니다."));
    tx.onerror = () => {};
  });
export class ConflictError extends Error {
  constructor() {
    super("다른 창에서 변경한 프로젝트입니다.");
    this.name = "ConflictError";
  }
}
export class Repository {
  constructor(name = "event-map-builder-v1") {
    this.name = name;
  }
  async open() {
    const r = indexedDB.open(this.name, 1);
    r.onupgradeneeded = () => {
      for (const s of ["projects", "versions", "meta", "legacy"])
        r.result.createObjectStore(s, { keyPath: "id" });
    };
    this.db = await request(r);
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async read(store, id) {
    return request(this.db.transaction(store).objectStore(store).get(id));
  }
  async all(store) {
    return request(this.db.transaction(store).objectStore(store).getAll());
  }
  async put(store, item) {
    const tx = this.db.transaction(store, "readwrite"),
      done = completed(tx);
    tx.objectStore(store).put(clone(item));
    await done;
  }
  async list(includeTrash = false) {
    return (await this.all("projects"))
      .filter((p) => includeTrash || !p.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async save(project, expected = project.revision) {
    const copy = clone(project),
      tx = this.db.transaction("projects", "readwrite"),
      done = completed(tx);
    const s = tx.objectStore("projects");
    const old = await request(s.get(copy.id));
    if (
      (old && (old.revision !== expected || old.deletedAt)) ||
      (!old && expected !== 0)
    ) {
      tx.abort();
      await done.catch(() => {});
      throw new ConflictError();
    }
    copy.revision = (old?.revision || 0) + 1;
    copy.updatedAt = Date.now();
    delete copy.deletedAt;
    s.put(copy);
    await done;
    return copy;
  }
  async checkpoint(project, label = "수동 저장") {
    await this.put("versions", {
      id: uid(),
      projectId: project.id,
      label,
      ts: Date.now(),
      data: clone(project),
    });
    // Preserve imported legacy history; bound only newly generated rolling snapshots.
    const versions = (await this.versions(project.id)).filter((v) => !v.legacy);
    if (versions.length > 40) {
      const tx = this.db.transaction("versions", "readwrite"),
        done = completed(tx);
      for (const v of versions.slice(40))
        tx.objectStore("versions").delete(v.id);
      await done;
    }
  }
  async versions(id) {
    return (await this.all("versions"))
      .filter((v) => v.projectId === id)
      .sort((a, b) => b.ts - a.ts);
  }
  async trash(id) {
    const tx = this.db.transaction("projects", "readwrite"),
      done = completed(tx),
      s = tx.objectStore("projects");
    const p = await request(s.get(id));
    if (p) {
      p.deletedAt = Date.now();
      p.revision++;
      s.put(p);
    }
    await done;
  }
  async restore(id) {
    const tx = this.db.transaction("projects", "readwrite"),
      done = completed(tx),
      s = tx.objectStore("projects");
    const p = await request(s.get(id));
    if (p) {
      delete p.deletedAt;
      p.updatedAt = Date.now();
      p.revision++;
      s.put(p);
    }
    await done;
    return p;
  }
  async importAll(projects, versions = [], legacyBackups = []) {
    // Validation is completed for ALL projects before the first write; import never replaces an existing ID.
    const prepared = projects.map((p) => migrate(p).project),
      idMap = new Map();
    if (new Set(prepared.map((p) => p.id)).size !== prepared.length)
      throw new Error("중복된 프로젝트 ID입니다.");
    prepared.forEach((p) => {
      const old = p.id;
      p.id = uid();
      idMap.set(old, p.id);
      p.revision = 1;
      p.updatedAt = Date.now();
    });
    const vs = versions
      .filter((v) => idMap.has(v.projectId))
      .map((v) => {
        const data = migrate(v.data).project;
        data.id = idMap.get(v.projectId);
        return { ...v, id: uid(), projectId: data.id, data };
      });
    const originals = legacyBackups.map((b) => {
      if (!b || typeof b.raw !== "string")
        throw new Error("원본 백업 형식 오류");
      return { ...b, id: "import:" + uid() + ":" + b.id };
    });
    const tx = this.db.transaction(
        ["projects", "versions", "legacy"],
        "readwrite",
      ),
      done = completed(tx);
    prepared.forEach((p) => tx.objectStore("projects").put(p));
    vs.forEach((v) => tx.objectStore("versions").put(v));
    originals.forEach((b) => tx.objectStore("legacy").put(b));
    await done;
    return prepared;
  }
  async backup() {
    return {
      format: "event-map-builder-backup",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      projects: await this.list(true),
      versions: await this.all("versions"),
      legacyBackups: await this.all("legacy"),
    };
  }
  async migrateLegacy(storage) {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (/^event_map_.*_(autosave|versions)$/.test(k)) keys.push(k);
    }
    const messages = [];
    for (const key of keys.sort(
      (a, b) =>
        Number(!a.endsWith("autosave")) - Number(!b.endsWith("autosave")) ||
        a.localeCompare(b),
    )) {
      if (await this.read("meta", `migrated:${key}`)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      // Commit the byte-for-byte original before attempting to parse or normalize it.
      await this.put("legacy", { id: key, raw, ts: Date.now() });
      try {
        const parsed = JSON.parse(raw),
          isVersions = key.endsWith("versions");
        const values = isVersions ? parsed : [parsed];
        if (!Array.isArray(values)) throw new Error("버전 목록 형식 오류");
        const normalized = values.map((v) => ({ source: v, ...migrate(v) }));
        const prior = await this.read(
          "meta",
          `migrated:${key.replace(/versions$/, "autosave")}`,
        );
        const tx = this.db.transaction(
            ["projects", "versions", "meta"],
            "readwrite",
          ),
          done = completed(tx);
        let projectId = prior?.projectId;
        normalized.forEach((r, i) => {
          if (!isVersions || (!projectId && i === 0)) {
            r.project.id = uid();
            r.project.revision = 1;
            projectId = r.project.id;
            tx.objectStore("projects").put(r.project);
          }
          if (isVersions) {
            r.project.id = projectId;
            tx.objectStore("versions").put({
              id: uid(),
              projectId,
              label: r.source.title || "이전 버전",
              ts: r.source.ts || Date.now(),
              legacy: true,
              data: r.project,
            });
          }
        });
        tx.objectStore("meta").put({
          id: `migrated:${key}`,
          projectId,
          ts: Date.now(),
        });
        await done;
        if (normalized.length)
          messages.push(
            `이전 ${isVersions ? "저장 버전" : "운영도"} ${normalized.length}개를 이전했습니다.`,
          );
      } catch (e) {
        messages.push(`${key}: ${e.message} 원본은 보관되었습니다.`);
      }
    }
    return messages;
  }
  close() {
    this.db?.close();
  }
}
export const JOURNAL_PREFIX = "emb:recovery:";
export const SESSION_ID = uid();
const journalKey = (id) => JOURNAL_PREFIX + id + ":" + SESSION_ID;
export function protectSession() {
  // A held Web Lock is released automatically if the page closes or crashes.
  if (globalThis.navigator?.locks)
    navigator.locks
      .request("emb-session:" + SESSION_ID, () => new Promise(() => {}))
      .catch(() => {});
}
export function writeJournal(storage, project) {
  storage.setItem(
    journalKey(project.id),
    JSON.stringify({ project, session: SESSION_ID, ts: Date.now() }),
  );
}
export function clearJournal(storage, id, revision) {
  try {
    const key = journalKey(id),
      v = JSON.parse(storage.getItem(key) || "null");
    if (v && v.project.revision <= revision) storage.removeItem(key);
  } catch {
    /* Keep unreadable journals for recovery export. */
  }
}
export async function recoverJournals(repo, storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k.startsWith(JOURNAL_PREFIX)) keys.push(k);
  }
  const notices = [];
  for (const key of keys) {
    try {
      const raw = storage.getItem(key),
        envelope = JSON.parse(raw);
      const recover = async () => {
        const { project: p } = migrate(envelope),
          stored = await repo.read("projects", p.id);
        const content = (q) =>
          JSON.stringify([q.title, q.objects, q.view, q.settings, q.meta]);
        if (!stored || content(p) !== content(stored) || stored.deletedAt) {
          if (stored && (stored.revision !== p.revision || stored.deletedAt)) {
            p.id = uid();
            p.revision = 0;
            p.title += " (복구 사본)";
          }
          await repo.save(
            p,
            stored && p.id === stored.id ? stored.revision : 0,
          );
          notices.push("종료 전 작업을 복구했습니다.");
        }
        // Do not erase a journal that another page updated while recovery was running.
        if (storage.getItem(key) === raw) storage.removeItem(key);
      };
      if (envelope.session && globalThis.navigator?.locks)
        await navigator.locks.request(
          "emb-session:" + envelope.session,
          { ifAvailable: true },
          (lock) => (lock ? recover() : undefined),
        );
      else await recover();
    } catch (e) {
      notices.push(`복구 대기 데이터가 있습니다: ${e.message}`);
    }
  }
  return notices;
}
