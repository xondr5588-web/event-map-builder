import { readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
const mime = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  ico: "image/x-icon",
};
const assets = {};
async function collect(dir, prefix = "") {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.name.startsWith(".")) continue;
    const rel = prefix + "/" + f.name,
      path = join(dir, f.name);
    if (f.isDirectory()) await collect(path, rel);
    else
      assets[rel] = {
        type: mime[f.name.split(".").at(-1)] || "application/octet-stream",
        data: (await readFile(path)).toString("base64"),
      };
  }
}
await collect("dist");
await rm("dist", { recursive: true });
await build({
  configFile: false,
  plugins: [
    {
      name: "field-embedded-assets",
      resolveId(id) {
        if (id === "virtual:field-assets") return "\0field-assets";
      },
      load(id) {
        if (id === "\0field-assets")
          return `export default ${JSON.stringify(assets)}`;
      },
    },
  ],
  build: {
    ssr: "worker/index.js",
    outDir: "dist/server",
    target: "es2022",
    minify: true,
    rollupOptions: { output: { entryFileNames: "index.js", format: "es" } },
  },
});
await mkdir("dist/.openai", { recursive: true });
await writeFile(
  "dist/.openai/hosting.json",
  await readFile(".openai/hosting.json"),
);
console.log(
  `Private Worker: ${Object.keys(assets).length} embedded files + authenticated project API`,
);
