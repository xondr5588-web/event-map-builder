import { migrate } from "../src/model.js";
const MAX = 8 * 1024 * 1024;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const identity = (r) => r.headers.get("oai-authenticated-user-id");
const digest = async (s) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export async function api(request, env) {
  const url = new URL(request.url),
    user = identity(request);
  if (!user) return json({ error: "소유자 로그인이 필요합니다." }, 401);
  if (
    !["GET", "HEAD"].includes(request.method) &&
    (request.headers.get("Origin") !== url.origin ||
      ["cross-site"].includes(request.headers.get("Sec-Fetch-Site")))
  )
    return json({ error: "요청 출처가 올바르지 않습니다." }, 403);
  if (url.pathname === "/api/places") return places(request, env, url);
  if (!env.BUCKET)
    return json({ error: "동기화 저장소가 연결되지 않았습니다." }, 503);
  const owner = await digest(user),
    prefix = `owners/${owner}/projects/`;
  if (url.pathname === "/api/cloud/status")
    return json({ available: true, owner: owner.slice(0, 16) });
  if (url.pathname === "/api/projects" && request.method === "GET") {
    const list = await env.BUCKET.list({
      prefix,
      limit: 1000,
      include: ["customMetadata"],
    });
    return json({
      projects: list.objects.map((o) => ({
        id: o.key.slice(prefix.length),
        etag: o.etag,
        ...o.customMetadata,
      })),
      truncated: !!list.truncated,
    });
  }
  const match = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]{1,120})$/);
  if (!match) return json({ error: "경로를 찾을 수 없습니다." }, 404);
  const id = match[1],
    key = prefix + id;
  if (request.method === "GET") {
    const value = await env.BUCKET.get(key);
    if (!value) return json({ error: "저장된 프로젝트가 없습니다." }, 404);
    return json({ project: await value.json(), etag: value.etag });
  }
  if (request.method !== "PUT")
    return json({ error: "허용하지 않는 요청입니다." }, 405);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return json({ error: "JSON만 지원합니다." }, 415);
  if (Number(request.headers.get("Content-Length")) > MAX)
    return json({ error: "프로젝트는 8MB 이하로 동기화합니다." }, 413);
  // Bound streamed body before parsing; missing Content-Length cannot bypass limits.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "프로젝트가 없습니다." }, 400);
  const buffers = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX) {
      await reader.cancel();
      return json({ error: "프로젝트는 8MB 이하로 동기화합니다." }, 413);
    }
    buffers.push(value);
  }
  let data, project;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const b of buffers) {
      bytes.set(b, offset);
      offset += b.length;
    }
    data = JSON.parse(new TextDecoder().decode(bytes));
    project = migrate(data.project).project;
  } catch (e) {
    return json(
      { error: e.message || "프로젝트 형식이 올바르지 않습니다." },
      400,
    );
  }
  if (project.id !== id)
    return json({ error: "프로젝트 ID가 일치하지 않습니다." }, 400);
  const expected = typeof data.etag === "string" ? data.etag : null,
    old = await env.BUCKET.get(key);
  if ((old && old.etag !== expected) || (!old && expected))
    return json({ error: "다른 기기에서 변경했습니다.", conflict: true }, 409);
  if (!old) {
    const count = await env.BUCKET.list({ prefix, limit: 301 });
    if (count.objects.length >= 300 || count.truncated)
      return json(
        { error: "동기화 프로젝트는 휴지통 포함 300개까지입니다." },
        409,
      );
  }
  // Keep immutable previous version before CAS, then update a single current object conditionally.
  if (old) {
    const content = await old.text();
    await env.BUCKET.put(`owners/${owner}/history/${id}/${old.etag}`, content, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { updatedAt: String(Date.now()) },
    });
  }
  const saved = await env.BUCKET.put(key, JSON.stringify(project), {
    onlyIf: old ? { etagMatches: expected } : { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      title: project.title.slice(0, 100),
      updatedAt: String(project.updatedAt),
      deletedAt: String(project.deletedAt || ""),
      schemaVersion: String(project.schemaVersion),
    },
  });
  if (!saved)
    return json({ error: "다른 기기에서 변경했습니다.", conflict: true }, 409);
  // Bound retained versions after successful write. Current project is never deleted here.
  const historyPrefix = `owners/${owner}/history/${id}/`,
    history = await env.BUCKET.list({
      prefix: historyPrefix,
      limit: 1000,
      include: ["customMetadata"],
    });
  const stale = history.objects
    .sort(
      (a, b) =>
        Number(b.customMetadata?.updatedAt) -
        Number(a.customMetadata?.updatedAt),
    )
    .slice(20);
  if (stale.length) await env.BUCKET.delete(stale.map((o) => o.key));
  return json({ etag: saved.etag, updatedAt: project.updatedAt });
}
async function places(request, env, url) {
  if (request.method !== "GET")
    return json({ error: "GET 요청만 지원합니다." }, 405);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2 || query.length > 120)
    return json({ error: "장소 이름은 2~120자로 입력하세요." }, 400);
  if (!env.NAVER_SEARCH_CLIENT_ID || !env.NAVER_SEARCH_CLIENT_SECRET)
    return json(
      {
        error:
          "장소명 검색은 서버의 NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 설정이 필요합니다.",
        configurationRequired: true,
      },
      503,
    );
  const target = new URL("https://openapi.naver.com/v1/search/local.json");
  target.searchParams.set("query", query);
  target.searchParams.set("display", "5");
  const response = await fetch(target, {
    headers: {
      "X-Naver-Client-Id": env.NAVER_SEARCH_CLIENT_ID,
      "X-Naver-Client-Secret": env.NAVER_SEARCH_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok)
    return json({ error: "네이버 장소 검색에 연결하지 못했습니다." }, 502);
  const data = await response.json();
  return json({
    items: (data.items || [])
      .slice(0, 5)
      .map((x) => ({
        title: String(x.title || "")
          .replace(/<[^>]*>/g, "")
          .slice(0, 120),
        address: x.roadAddress || x.address,
        lat: Number(x.mapy) / 1e7,
        lng: Number(x.mapx) / 1e7,
      }))
      .filter(
        (x) =>
          Number.isFinite(x.lat) &&
          Number.isFinite(x.lng) &&
          Math.abs(x.lat) <= 85 &&
          Math.abs(x.lng) <= 180,
      ),
  });
}
