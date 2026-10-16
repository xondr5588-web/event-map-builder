import test from "node:test";
import assert from "node:assert/strict";
import { verifyPrivateAccess } from "../src/access.js";
const baseURL = "https://field.example/";
test("private app checks the protected origin without cache or redirected login HTML", async () => {
  let called = false;
  await verifyPrivateAccess({
    enabled: true,
    baseURL,
    fetcher: async (url, options) => {
      called = true;
      assert.equal(url.origin, "https://field.example");
      assert.equal(url.pathname, "/access-check.json");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "same-origin");
      return Response.json({ access: "owner-private" });
    },
  });
  assert.equal(called, true);
});
test("denied, expired, malformed and redirected private access fails closed", async () => {
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response("login", { headers: { "Content-Type": "text/html" } }),
    Response.json({ access: "public" }),
    {
      ok: true,
      redirected: true,
      headers: new Headers({ "content-type": "application/json" }),
    },
  ]) {
    await assert.rejects(
      verifyPrivateAccess({
        enabled: true,
        baseURL,
        fetcher: async () => response,
      }),
    );
  }
  await assert.rejects(
    verifyPrivateAccess({
      enabled: true,
      baseURL,
      fetcher: async () => {
        throw new Error("offline");
      },
    }),
  );
});
test("local editing does not request a private session unless private hosting is selected", async () => {
  await verifyPrivateAccess({
    enabled: false,
    fetcher: () => {
      throw new Error("unexpected network");
    },
  });
});
