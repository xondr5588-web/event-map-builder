import { clone, migrate, uid } from "./model.js";
export const contentHash = async (p) => {
  const value = clone(p);
  delete value.revision;
  delete value.updatedAt;
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(sort(value))),
  );
  return Array.from(new Uint8Array(bytes))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
};
export class CloudSync {
  constructor(
    repo,
    {
      fetcher = fetch,
      busy = () => false,
      updated = () => {},
      notify = () => {},
      status = () => {},
    } = {},
  ) {
    this.repo = repo;
    this.fetcher = fetcher;
    this.busy = busy;
    this.updated = updated;
    this.notify = notify;
    this.status = status;
    this.available = false;
    this.queue = Promise.resolve();
  }
  async request(path, options = {}) {
    const response = await this.fetcher(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("동기화 서버 연결을 확인하세요.");
    const data = await response.json();
    if (!response.ok) {
      const e = new Error(data.error || "동기화에 실패했습니다.");
      e.status = response.status;
      throw e;
    }
    return data;
  }
  async start() {
    // Register retries even when the first launch is offline; attach each listener once.
    if (!this.interval)
      this.interval = setInterval(
        () => (this.available ? this.sync() : this.start()),
        60000,
      );
    if (!this.online) {
      this.online = () => (this.available ? this.sync() : this.start());
      globalThis.addEventListener?.("online", this.online);
    }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        await this.request("/api/cloud/status");
        this.available = true;
        await this.sync();
      } catch {
        this.available = false;
        this.status("기기 저장 · 동기화 연결 대기");
      }
      return this.available;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
  schedule() {
    if (!this.available) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 1500);
  }
  sync() {
    if (!this.available) return Promise.resolve();
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        this.status("기기 저장 완료 · 기기 간 동기화 중");
        try {
          const remote = await this.request("/api/projects");
          if (remote.truncated)
            throw new Error("서버 목록이 너무 큽니다. 백업 후 정리하세요.");
          const local = await this.repo.list(true),
            ids = new Set([
              ...local.map((p) => p.id),
              ...remote.projects.map((p) => p.id),
            ]);
          let pending = false;
          for (const id of ids)
            if (
              (await this.one(
                id,
                remote.projects.find((p) => p.id === id),
              )) === false
            )
              pending = true;
          this.status(
            pending
              ? "기기 저장 · 편집 종료 후 동기화 재확인"
              : "기기 저장 · 클라우드 최신",
          );
        } catch (e) {
          this.status(`기기 저장 유지 · ${e.message}`);
        }
      });
    return this.queue;
  }
  async one(id, remoteInfo) {
    if (this.busy(id)) return false;
    const local = await this.repo.read("projects", id),
      state = await this.repo.read("meta", `cloud:${id}`),
      hash = local ? await contentHash(local) : null;
    if (!local) {
      if (!remoteInfo || remoteInfo.deletedAt) return;
      const r = await this.request(`/api/projects/${encodeURIComponent(id)}`),
        p = migrate(r.project).project;
      p.revision = 0;
      const saved = await this.repo.save(p, 0, { preserveUpdatedAt: true });
      await this.remember(id, r.etag, await contentHash(saved));
      await this.updated(saved);
      return;
    }
    // A tombstone imported from another device must stay in the local trash.
    if (remoteInfo && remoteInfo.etag !== state?.etag) {
      const r = await this.request(`/api/projects/${encodeURIComponent(id)}`),
        incoming = migrate(r.project).project,
        remoteHash = await contentHash(incoming);
      if (
        this.busy(id) ||
        (await this.repo.read("projects", id)).revision !== local.revision
      )
        return false;
      if (hash === remoteHash) {
        await this.remember(id, r.etag, hash);
        return;
      }
      if (state?.hash === hash) {
        if (this.busy(id)) return false;
        if (incoming.deletedAt) {
          await this.repo.trash(id);
          await this.remember(id, r.etag, remoteHash);
          await this.updated(incoming);
          return;
        }
        // Repository.save refuses deleted records, so restore before a remote undelete.
        let revision = local.revision;
        if (local.deletedAt) {
          const restored = await this.repo.restore(id);
          revision = restored.revision;
        }
        incoming.revision = revision;
        const saved = await this.repo.save(incoming, revision, {
          preserveUpdatedAt: true,
        });
        await this.remember(id, r.etag, await contentHash(saved));
        await this.updated(saved);
        return;
      }
      // Both sides changed: preserve the local edit under a new ID before adopting the remote.
      const copy = clone(local);
      copy.id = uid();
      copy.title += " (기기 간 충돌 사본)";
      copy.revision = 0;
      delete copy.deletedAt;
      const recovered = await this.repo.save(copy, 0);
      this.notify(
        "다른 기기의 변경과 겹쳐 현재 기기 작업을 충돌 사본으로 보관했습니다. 프로젝트 목록에서 확인하세요.",
      );
      if (incoming.deletedAt) {
        await this.repo.trash(id);
        await this.remember(id, r.etag, remoteHash);
        await this.updated(recovered, { replacesId: id });
        return;
      }
      let revision = local.revision;
      if (local.deletedAt) revision = (await this.repo.restore(id)).revision;
      incoming.revision = revision;
      const saved = await this.repo.save(incoming, revision, {
        preserveUpdatedAt: true,
      });
      await this.remember(id, r.etag, await contentHash(saved));
      await this.updated(saved);
      return;
    }
    if (hash === state?.hash && remoteInfo) return;
    const current = await this.repo.read("projects", id);
    if (current.revision !== local.revision || this.busy(id)) return false;
    try {
      const result = await this.request(
        `/api/projects/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ project: local, etag: state?.etag || null }),
        },
      );
      await this.remember(id, result.etag, hash);
    } catch (e) {
      if (e.status === 409) {
        this.schedule();
        return false;
      }
      throw e;
    }
  }
  async remember(id, etag, hash) {
    await this.repo.put("meta", {
      id: `cloud:${id}`,
      etag,
      hash,
      ts: Date.now(),
    });
  }
  stop() {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    if (this.online) globalThis.removeEventListener?.("online", this.online);
    this.interval = null;
    this.online = null;
  }
}
