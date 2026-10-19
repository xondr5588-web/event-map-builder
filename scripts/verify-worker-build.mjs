import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const code = await readFile("dist/server/index.js", "utf8"),
  { default: worker } = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
const env = {};
const r = await worker.fetch(new Request("https://app.test/"), env);
assert.equal(r.status, 200);
assert.ok((await r.text()).includes("FIELD"));
assert.equal(
  (await worker.fetch(new Request("https://app.test/api/projects"), env))
    .status,
  401,
);
assert.equal(
  (await worker.fetch(new Request("https://app.test/access-check.json"), env))
    .status,
  200,
);
assert.ok(
  !(await worker.fetch(new Request("https://app.test/sw.js"), env)).headers
    .get("cache-control")
    .includes("max-age"),
);
console.log(
  "Private Worker serves embedded app, denies anonymous API and disables shell caching",
);
