import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Optional server-side adapter for NAVER Local Search. Never bundle this file or its secrets.
export function createPlaceServer({
  clientId,
  clientSecret,
  origins,
  fetcher = fetch,
  now = Date.now,
}) {
  const allowed = new Set(origins);
  const rates = new Map();
  let globalWindow = { start: 0, count: 0 };
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    const reply = (code, body) => {
      res.writeHead(code, headers);
      res.end(JSON.stringify(body));
    };
    if (!origin || !allowed.has(origin))
      return reply(403, { error: "허용되지 않은 출처입니다." });
    headers["Access-Control-Allow-Origin"] = origin;
    if (req.method === "OPTIONS") {
      headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      return reply(204, {});
    }
    if (req.method !== "GET")
      return reply(405, { error: "GET 요청만 지원합니다." });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/search")
      return reply(404, { error: "찾을 수 없습니다." });
    const query = (url.searchParams.get("query") || "").trim();
    if (!query || query.length > 100)
      return reply(400, { error: "검색어는 1~100자여야 합니다." });
    if (!clientId || !clientSecret)
      return reply(503, { error: "장소 검색 서버 설정이 필요합니다." });
    const ts = now(),
      ip = req.socket.remoteAddress;
    for (const [key, value] of rates)
      if (ts - value.start >= 60000) rates.delete(key);
    if (ts - globalWindow.start >= 60000)
      globalWindow = { start: ts, count: 0 };
    const rate = rates.get(ip) || { start: ts, count: 0 };
    if (rate.count >= 60 || globalWindow.count >= 600 || rates.size >= 2000)
      return reply(429, { error: "잠시 후 다시 검색하세요." });
    rate.count++;
    globalWindow.count++;
    rates.set(ip, rate);
    try {
      const response = await fetcher(
        `https://openapi.naver.com/v1/search/local.json?display=5&query=${encodeURIComponent(query)}`,
        {
          headers: {
            "X-Naver-Client-Id": clientId,
            "X-Naver-Client-Secret": clientSecret,
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok)
        return reply(502, { error: "장소 검색 제공자에 연결하지 못했습니다." });
      const data = await response.json();
      reply(200, {
        items: (Array.isArray(data.items) ? data.items : [])
          .slice(0, 5)
          .map((item) => ({
            title: String(item.title || "").replace(/<[^>]*>/g, ""),
            address: item.address || "",
            roadAddress: item.roadAddress || "",
            mapx: item.mapx,
            mapy: item.mapy,
          })),
      });
    } catch {
      reply(502, { error: "장소 검색 응답이 지연되고 있습니다." });
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const origins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !process.env.NAVER_SEARCH_CLIENT_ID ||
    !process.env.NAVER_SEARCH_CLIENT_SECRET ||
    !origins.length
  )
    throw new Error(
      "NAVER_SEARCH_CLIENT_ID, NAVER_SEARCH_CLIENT_SECRET, ALLOWED_ORIGINS를 설정하세요.",
    );
  createPlaceServer({
    clientId: process.env.NAVER_SEARCH_CLIENT_ID,
    clientSecret: process.env.NAVER_SEARCH_CLIENT_SECRET,
    origins,
  }).listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () => console.log("Place search server ready"),
  );
}
