import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://genesiscalendar.com/";
const assetUrl = `${origin}assets/account.js`;

function worker({ assetHtml = false, cachedHtml = false, networkHtml = false, networkStatus=200, offline=false } = {}) {
  const events = new Map();
  const records = new Map();
  let networkRequests = 0;
  const cache = {
    async addAll(requests) {
      for (const request of requests) records.set(request.url, new Response("content", {
        headers: { "Content-Type": request.url === assetUrl && assetHtml ? "text/html" : "application/javascript" },
      }));
    },
    async match(request,options) { const key=typeof request === "string" ? request : request.url;return (records.get(key)??(options?.ignoreSearch?records.get(key.split('?')[0]):undefined))?.clone(); },
    async put(request, response) { records.set(typeof request === "string" ? request : request.url, response); },
    async delete(url) { return records.delete(url); },
  };
  if (cachedHtml) records.set(assetUrl, new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } }));
  const self = {
    registration: { scope: origin }, location: { origin: new URL(origin).origin },
    __GENESIS_PRECACHE_VERSION: "test", __GENESIS_PRECACHE: ["./assets/account.js"],
    addEventListener: (name, callback) => events.set(name, callback),
  };
  runInNewContext(source, {
    self, URL, Request, Response, importScripts() {}, caches: { open: async () => cache, match:(request,options)=>cache.match(request,options) },
    fetch: async () => { networkRequests += 1;if(offline)throw Error('offline');return new Response(networkHtml ? "<html>fallback</html>" : "export const ready = true;", { status:networkStatus, headers: { "Content-Type": networkHtml ? "text/html" : "application/javascript" } }); },
  });
  return { events, records, networkRequests: () => networkRequests };
}

test("offline installation rejects HTML masquerading as a hashed JavaScript module", async () => {
  const fixture = worker({ assetHtml: true });
  let installation;
  fixture.events.get("install")({ waitUntil: promise => { installation = promise; } });
  await assert.rejects(installation, /HTML fallback/);
  assert.equal(fixture.records.has(assetUrl), false);
});

test("a poisoned module cache recovers from the network instead of returning HTML", async () => {
  const fixture = worker({ cachedHtml: true });
  let responsePromise;
  fixture.events.get("fetch")({ request: new Request(assetUrl), respondWith: promise => { responsePromise = promise; } });
  const response = await responsePromise;
  assert.equal(response.headers.get("Content-Type"), "application/javascript");
  assert.match(await response.text(), /export const ready/);
  assert.equal(fixture.networkRequests(), 1);
});

test("valid precached modules remain available without a network request", async () => {
  const fixture = worker();
  let installation;
  fixture.events.get("install")({ waitUntil: promise => { installation = promise; } });
  await installation;
  let responsePromise;
  fixture.events.get("fetch")({ request: new Request(assetUrl), respondWith: promise => { responsePromise = promise; } });
  assert.equal((await responsePromise).headers.get("Content-Type"), "application/javascript");
  assert.equal(fixture.networkRequests(), 0);
});

test("a stale SPA rewrite cannot return or cache HTML as a module", async () => {
  const fixture = worker({ networkHtml: true });
  let responsePromise;
  fixture.events.get("fetch")({ request: new Request(assetUrl), respondWith: promise => { responsePromise = promise; } });
  const response = await responsePromise;
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(fixture.records.has(assetUrl), false);
});

const illustration=origin+'theokyklos-symbols/exit-eros-psyche.png';
async function imageRequest(fixture,url=illustration){
 const request=new Request(url);Object.defineProperty(request,'destination',{value:'image'});let pending;
 fixture.events.get('fetch')({request,respondWith:promise=>{pending=promise;}});return pending;
}
test('a CDN 502 or HTML fallback displays the saved original illustration without poisoning its cache',async()=>{
 for(const options of [{networkStatus:502},{networkHtml:true}]){
  const fixture=worker(options);fixture.records.set(illustration,new Response('original PNG bytes',{headers:{'Content-Type':'image/png'}}));
  const response=await imageRequest(fixture);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(await response.text(),'original PNG bytes');assert.equal(await fixture.records.get(illustration).clone().text(),'original PNG bytes');
 }
});
test('an offline bounded image retry finds the original precache entry despite its retry query',async()=>{
 const fixture=worker({offline:true});fixture.records.set(illustration,new Response('saved original',{headers:{'Content-Type':'image/png'}}));
 assert.equal(await (await imageRequest(fixture,illustration+'?genesis-symbol-retry=1')).text(),'saved original');
});
test('a versioned terrain image prefers its exact cached revision over an older plain URL',async()=>{
 for(const options of [{offline:true},{networkStatus:502},{networkHtml:true}]){
  const fixture=worker(options),plain=origin+'solar-landscapes-v1/temperate/11.webp',revision=plain+'?v=new-revision';
  fixture.records.set(plain,new Response('old terrain geometry',{headers:{'Content-Type':'image/webp'}}));
  fixture.records.set(revision,new Response('current terrain geometry',{headers:{'Content-Type':'image/webp'}}));
  assert.equal(await (await imageRequest(fixture,revision)).text(),'current terrain geometry');
 }
});
test('a failed image request never treats a saved HTML page as a successful illustration',async()=>{
 const fixture=worker({networkStatus:502});fixture.records.set(illustration,new Response('<html>old fallback</html>',{headers:{'Content-Type':'text/html'}}));
 assert.equal((await imageRequest(fixture)).status,502);assert.equal(fixture.records.get(illustration).headers.get('Content-Type'),'text/html');
});
