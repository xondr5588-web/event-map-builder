import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const html = await readFile("dist/index.html", "utf8");
assert.ok(!html.includes('id="editor"'), "Public build must not contain the editor");
let javascript = "";
for (const file of await readdir("dist/assets")) {
  if (file.endsWith(".js")) javascript += await readFile(`dist/assets/${file}`, "utf8");
}
assert.ok(javascript.includes("이전 작업 전체 백업"), "Recovery must remain available");
assert.ok(!/oapi\.map\.naver\.com|maps-geocoder\.js|navermap_authFailure|b4anccamja/.test(javascript),
  "Public deployment must contain neither the Naver SDK loader nor the owner's map ID");
const worker = await readFile("dist/sw.js", "utf8");
assert.ok(worker.includes("skipWaiting"), "Replace the old public app cache promptly");
assert.ok(!worker.includes("addEventListener('fetch'"), "Never serve old authenticated files from cache");
console.log("Public access checks passed: recovery only, no editor, no map SDK, no owner map ID, no cached app shell.");
