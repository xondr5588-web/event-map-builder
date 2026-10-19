import { Bucket } from "./helpers/bucket.js";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../worker/api.js";
import { CloudSync, contentHash } from "../src/cloud.js";
import { Repository } from "../src/storage.js";
import { newProject, uid, clone } from "../src/model.js";
const request = (
  path,
  user = "owner",
  data = null,
  origin = "https://app.test",
) =>
  new Request("https://app.test" + path, {
    method: data ? "PUT" : "GET",
    headers: {
      ...(user ? { "oai-authenticated-user-id": user } : {}),
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
const client =
  (env, user = "owner") =>
  (path, options = {}) =>
    api(
      new Request("https://app.test" + path, {
        ...options,
        headers: {
          ...options.headers,
          "oai-authenticated-user-id": user,
          Origin: "https://app.test",
        },
      }),
      env,
    );
const repo = () => new Repository("cloud-test-" + uid()).open();
test("default browser fetch keeps its global receiver for authenticated cloud requests", async (t) => {
  t.mock.method(globalThis, "fetch", async function (path, options) {
    assert.equal(this, globalThis);
    assert.equal(path, "/api/cloud/status");
    assert.equal(options.credentials, "same-origin");
    return Response.json({ available: true });
  });
  const cloud = new CloudSync({});
  assert.deepEqual(await cloud.request("/api/cloud/status"), {
    available: true,
  });
});
test("authenticated cloud rejects anonymous, cross-origin, future data and isolates owners", async () => {
  const env = { BUCKET: new Bucket() },
    p = newProject();
  assert.equal((await api(request("/api/projects", null), env)).status, 401);
  assert.equal(
    (
      await api(
        request(
          "/api/projects/" + p.id,
          "owner",
          { project: p },
          "https://evil.test",
        ),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        request("/api/projects/" + p.id, "owner", {
          project: { ...p, schemaVersion: 999 },
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (await api(request("/api/projects/" + p.id, "owner", { project: p }), env))
      .status,
    200,
  );
  assert.equal(
    (await api(request("/api/projects/" + p.id, "other"), env)).status,
    404,
  );
  assert.equal(
    (await (await api(request("/api/projects", "other"), env)).json()).projects
      .length,
    0,
  );
});
test("cloud conditional writes reject stale versions and retain at most 20 immutable versions", async () => {
  const env = { BUCKET: new Bucket() },
    p = newProject();
  let etag = null;
  for (let i = 0; i < 24; i++) {
    p.title = "revision " + i;
    const r = await api(
      request("/api/projects/" + p.id, "owner", { project: p, etag }),
      env,
    );
    assert.equal(r.status, 200);
    etag = (await r.json()).etag;
  }
  assert.equal(
    (
      await api(
        request("/api/projects/" + p.id, "owner", { project: p, etag: "old" }),
        env,
      )
    ).status,
    409,
  );
  const history = [...env.BUCKET.data.keys()].filter((k) =>
    k.includes("/history/"),
  );
  assert.equal(history.length, 20);
});
test("two devices upload, download, keep both conflicting edits, and sync trash and restore", async () => {
  const env = { BUCKET: new Bucket() },
    a = await repo(),
    b = await repo(),
    ca = new CloudSync(a, { fetcher: client(env) }),
    cb = new CloudSync(b, { fetcher: client(env) });
  ca.available = cb.available = true;
  let p = await a.save(newProject("original"), 0);
  await ca.sync();
  await cb.sync();
  assert.equal((await b.read("projects", p.id)).title, "original");
  p.title = "device A";
  p = await a.save(p, p.revision);
  let bp = await b.read("projects", p.id);
  bp.title = "device B";
  await b.save(bp, bp.revision);
  await ca.sync();
  await cb.sync();
  const list = await b.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((p) => p.title === "device A"));
  assert.ok(list.some((p) => p.title === "device B (기기 간 충돌 사본)"));
  await a.trash(p.id);
  await ca.sync();
  await cb.sync();
  assert.ok((await b.read("projects", p.id)).deletedAt);
  await a.restore(p.id);
  await ca.sync();
  await cb.sync();
  assert.equal((await b.read("projects", p.id)).deletedAt, undefined);
  ca.stop();
  cb.stop();
  a.close();
  b.close();
});
test("hash ignores revision and save timestamps but includes content, order and view", async () => {
  const p = newProject(),
    q = clone(p);
  q.revision = 100;
  q.updatedAt = 1;
  assert.equal(await contentHash(p), await contentHash(q));
  q.title += "changed";
  assert.notEqual(await contentHash(p), await contentHash(q));
});
test("schema upgrade backs up untouched originals once and rolls back all if any record is invalid", async () => {
  const r = await repo(),
    p = newProject("v1");
  p.schemaVersion = 1;
  delete p.meta.event;
  await r.put("projects", p);
  const raw = JSON.stringify(p);
  assert.equal((await r.upgradeSchema()).length, 1);
  assert.equal((await r.read("projects", p.id)).schemaVersion, 2);
  assert.equal((await r.all("legacy"))[0].raw, raw);
  assert.equal((await r.versions(p.id)).length, 1);
  await r.upgradeSchema();
  assert.equal((await r.all("legacy")).length, 1);
  const broken = {
    ...newProject("broken"),
    schemaVersion: 1,
    objects: [{ type: "marker", position: { lat: null, lng: 128 } }],
  };
  const another = { ...newProject("another"), schemaVersion: 1 };
  await r.put("projects", broken);
  await r.put("projects", another);
  await assert.rejects(r.upgradeSchema());
  assert.equal((await r.read("projects", another.id)).schemaVersion, 1);
  r.close();
});

test("offline launch retries when connectivity returns and attaches one lifecycle listener", async () => {
  const env = { BUCKET: new Bucket() },
    r = await repo();
  await r.save(newProject("offline work"), 0);
  const originalAdd = globalThis.addEventListener,
    originalRemove = globalThis.removeEventListener,
    listeners = new Set();
  globalThis.addEventListener = (name, fn) => {
    if (name === "online") listeners.add(fn);
  };
  globalThis.removeEventListener = (name, fn) => {
    if (name === "online") listeners.delete(fn);
  };
  let offline = true;
  const fetcher = client(env),
    sync = new CloudSync(r, {
      fetcher: (...args) =>
        offline ? Promise.reject(new Error("offline")) : fetcher(...args),
    });
  try {
    assert.equal(await sync.start(), false);
    assert.equal(listeners.size, 1);
    const interval = sync.interval;
    offline = false;
    await [...listeners][0]();
    assert.equal(sync.available, true);
    assert.equal(listeners.size, 1);
    assert.equal(sync.interval, interval);
    assert.equal(
      (await (await api(request("/api/projects"), env)).json()).projects.length,
      1,
    );
    await sync.start();
    assert.equal(listeners.size, 1);
  } finally {
    sync.stop();
    r.close();
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
  }
});
test("busy project is reported as pending and synchronizes after editing ends", async () => {
  const env = { BUCKET: new Bucket() },
    r = await repo(),
    p = await r.save(newProject("pending"), 0),
    statuses = [];
  let busy = true;
  const sync = new CloudSync(r, {
    fetcher: client(env),
    busy: () => busy,
    status: (s) => statuses.push(s),
  });
  sync.available = true;
  await sync.sync();
  assert.match(statuses.at(-1), /편집 종료/);
  assert.equal(await r.read("meta", "cloud:" + p.id), undefined);
  busy = false;
  await sync.sync();
  assert.match(statuses.at(-1), /클라우드 최신/);
  assert.ok(await r.read("meta", "cloud:" + p.id));
  sync.stop();
  r.close();
});
test("remote trash conflict returns the preserved local copy as the active replacement", async () => {
  const env = { BUCKET: new Bucket() },
    a = await repo(),
    b = await repo(),
    events = [];
  const ca = new CloudSync(a, { fetcher: client(env) }),
    cb = new CloudSync(b, {
      fetcher: client(env),
      updated: (p, meta) => events.push({ p, meta }),
    });
  ca.available = cb.available = true;
  const p = await a.save(newProject("original"), 0);
  await ca.sync();
  await cb.sync();
  const bp = await b.read("projects", p.id);
  bp.title = "unsent local changes";
  await b.save(bp, bp.revision);
  await a.trash(p.id);
  await ca.sync();
  await cb.sync();
  const event = events.at(-1);
  assert.equal(event.meta.replacesId, p.id);
  assert.notEqual(event.p.id, p.id);
  assert.match(event.p.title, /unsent local changes/);
  assert.ok((await b.read("projects", p.id)).deletedAt);
  ca.stop();
  cb.stop();
  a.close();
  b.close();
});
