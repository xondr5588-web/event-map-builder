import test from "node:test";
import assert from "node:assert/strict";
import { createPlaceServer } from "../server/place-search.mjs";

test("place proxy restricts origin and method, keeps secret on server, sanitizes and bounds output", async () => {
  let calls = 0;
  const server = createPlaceServer({
    clientId: "test-public",
    clientSecret: "test-private",
    origins: ["https://example.com"],
    fetcher: async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, "openapi.naver.com");
      assert.equal(options.headers["X-Naver-Client-Secret"], "test-private");
      return Response.json({
        items: [
          { title: "<b>공원</b>", mapx: "1280000000", mapy: "350000000" },
        ],
      });
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/search?query=공원`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Origin: "https://example.com" },
        })
      ).status,
      405,
    );
    const response = await fetch(url, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://example.com",
    );
    const body = await response.text();
    assert.equal(JSON.parse(body).items[0].title, "공원");
    assert.ok(!body.includes("test-private"));
    assert.equal(calls, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
