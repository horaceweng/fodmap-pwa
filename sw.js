const CACHE_VERSION = "v2";
const CACHE_NAME = `fodmap-shell-${CACHE_VERSION}`;
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./classify.js", "./claude.js", "./image.js",
  "./manifest.webmanifest", "./data/fodmap.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.anthropic.com") return; // 不快取 API 請求
  if (url.origin !== self.location.origin) return; // CDN 等交給瀏覽器
  // 網路優先：有網路時拿最新版（程式或食物表更新才會生效），離線時才用快取
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
