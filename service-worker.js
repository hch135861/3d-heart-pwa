const CACHE_PREFIX = 'heart-pwa-';
const CACHE_NAME = 'heart-pwa-v3.12-luobu';
const CORE_ASSETS = [
    './', './index.html', './luobu.html', './3D-爱心-V3.10-洛布辛苦啦.html',
    './manifest.webmanifest', './luobu.webmanifest',
    './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
    './vendor/three.module.js', './vendor/OrbitControls.js',
];
const scopeURL = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
    // 全部离线资源就绪才接管；安装失败时继续使用旧版本。
    event.waitUntil(caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(CORE_ASSETS.map((path) => new Request(new URL(path, scopeURL), { cache: 'reload' }))))
        .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))))
        .then(() => self.clients.claim()));
});

async function save(cache, key, response) {
    if (response.ok && !response.redirected) {
        try { await cache.put(key, response.clone()); } catch (error) { console.warn('离线缓存写入失败', error); }
    }
    return response;
}
function offlinePage() {
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>暂时离线</title><body style="background:#050510;color:#f9dcec;font:18px sans-serif;padding:3rem"><h1>星光暂时离线了</h1><p>这个页面还没有保存，请恢复网络后重新打开。</p></body></html>', {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}
self.addEventListener('fetch', (event) => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) return;
    // 当前页面没有查询参数驱动的内容；仅去掉参数以命中该页面自己的离线副本。
    const pageKey = new URL(url.pathname, url.origin).href;
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(pageKey);
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), 4500);
            try {
                const response = await fetch(request, { signal: abort.signal });
                if (response.status >= 500 && cached) return cached;
                return await save(cache, pageKey, response);
            } catch {
                // 不再把洛布版写入 index.html，也不把未知页面替换成通用首页。
                return cached || offlinePage();
            } finally { clearTimeout(timer); }
        })());
        return;
    }
    // JS 与字体等静态文件保持同一发布版本；新版通过缓存版本号整体刷新。
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        try { return await save(cache, request, await fetch(request)); }
        catch { return new Response('', { status: 503, statusText: 'Offline' }); }
    })());
});
