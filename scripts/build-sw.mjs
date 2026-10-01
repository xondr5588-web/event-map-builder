import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((i) =>
        i.isDirectory() ? walk(`${dir}/${i.name}`) : `${dir}/${i.name}`,
      ),
    )
  ).flat();
}
const files = (await walk("dist")).filter((p) => !p.endsWith("sw.js")),
  hash = createHash("sha256");
for (const f of files) hash.update(await readFile(f));
const version = hash.digest("hex").slice(0, 14),
  assets = files.map((p) => "./" + p.slice(5));
await writeFile(
  "dist/sw.js",
  `/* Generated from the exact build contents. No map tiles or API responses are cached. */
const PREFIX='field-shell-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-';
const CACHE=PREFIX+'${version}';
const ASSETS=${JSON.stringify(assets)};
const URLS=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>response.ok?response:caches.match(new URL('./index.html',self.registration.scope))).catch(()=>caches.match(new URL('./index.html',self.registration.scope))));return;
  }
  if(URLS.has(url.href))event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
`,
);
console.log(`Offline shell ${version}: ${assets.length} files`);
