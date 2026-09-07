// Run from any directory: node tests/check-luobu.mjs (Node.js 18+).
// These tests verify source invariants and worker routing, not GPU performance.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const named = '3D-爱心-V3.10-洛布辛苦啦.html';
const html = await read(named);
assert.equal(html, await read('luobu.html'), 'Both existing entry points must stay identical');
assert.match(html, /const LOVE_TEXT = '洛布辛苦啦'/);
assert.match(html, /const COUNT = 50000/);
assert.match(html, /TEXT_FIXED_WORLD_WIDTH = 7\.44/);
assert.match(html, /luobu\.webmanifest/);
assert.match(html, /visibilitychange/);
assert.match(html, /cancelAnimationFrame/);
assert.match(html, /pointercancel/);
assert.match(html, /prefers-reduced-motion/);
assert.match(html, /webglcontextlost/);
assert.doesNotMatch(html, /clock\.getElapsedTime/);
const manifest = JSON.parse(await read('luobu.webmanifest'));
assert.equal(manifest.start_url, './luobu.html');
assert.equal(manifest.id, './luobu.html');
assert.equal(manifest.scope, './');

const base = new URL('https://example.test/3d-heart-pwa/');
const handlers = new Map(), stores = new Map();
let online = true, skipWaiting = false, claimed = false;
const key = (value) => new URL(value.url || value, base).href;
async function network(request) {
    if (!online) throw new TypeError('Offline');
    const url = new URL(key(request));
    const relative = decodeURIComponent(url.pathname.slice(base.pathname.length)) || 'index.html';
    try { return new Response(await read(relative)); }
    catch { return new Response('Not found', { status: 404 }); }
}
class MemoryCache {
    entries = new Map();
    async match(request) { return this.entries.get(key(request))?.clone(); }
    async put(request, response) { this.entries.set(key(request), response.clone()); }
    async addAll(requests) {
        const responses = await Promise.all(requests.map(network));
        if (responses.some((response) => !response.ok)) throw new Error('Precache failed');
        for (let i = 0; i < requests.length; i++) await this.put(requests[i], responses[i]);
    }
}
const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new MemoryCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
};
await caches.open('heart-pwa-v3.11');
await caches.open('unrelated-app');
const context = vm.createContext({
    URL, Request, Response, AbortController, setTimeout, clearTimeout, console, caches, fetch: network,
    self: {
        registration: { scope: base.href },
        addEventListener: (type, handler) => handlers.set(type, handler),
        skipWaiting: async () => { skipWaiting = true; },
        clients: { claim: async () => { claimed = true; } },
    },
});
vm.runInContext(await read('service-worker.js'), context);
async function lifecycle(type) {
    let promise;
    handlers.get(type)({ waitUntil(value) { promise = value; } });
    await promise;
}
async function request(path, mode = 'navigate') {
    let response;
    handlers.get('fetch')({
        request: { url: new URL(path, base).href, method: 'GET', mode },
        respondWith(value) { response = value; },
    });
    return response;
}
// Failed installation must not activate or delete the existing working cache.
online = false;
await assert.rejects(lifecycle('install'));
assert.equal(skipWaiting, false);
assert.ok(stores.has('heart-pwa-v3.11'));
online = true;
await lifecycle('install');
assert.equal(skipWaiting, true);
await lifecycle('activate');
assert.equal(claimed, true);
assert.ok(!stores.has('heart-pwa-v3.11'));
assert.ok(stores.has('unrelated-app'));

// An online visit to the personalized page must never overwrite the homepage.
assert.match(await (await request('./luobu.html')).text(), /洛布辛苦啦/);
online = false;
for (const path of ['./luobu.html', './' + named, './luobu.html?v=3.12']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /const LOVE_TEXT = '洛布辛苦啦'/);
}
const home = await (await request('./index.html')).text();
assert.match(home, /const LOVE_TEXT = 'I LOVE YOU'/);
assert.doesNotMatch(home, /const LOVE_TEXT = '洛布辛苦啦'/);
assert.equal((await request('./never-cached.html')).status, 503);
assert.equal((await request('./vendor/three.module.js', 'cors')).status, 200);
assert.equal((await request('./unknown.js', 'cors')).status, 503);
assert.equal(await request('https://example.test/other-app/page.html'), undefined);
assert.equal(await request('https://other.test/page.html'), undefined);
console.log('PASS: Luobu source invariants, install failure safety, cache isolation, query URLs, offline fallbacks and scope boundaries.');
