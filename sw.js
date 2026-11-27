/* 라운지 인기글 오프라인 캐시
 * - 앱 껍데기(HTML·JS·폰트·샘플·썸네일)는 캐시 우선
 * - Apps Script 아카이브 요청(script.google.com 등 외부)은 캐시하지 않음
 */
const VERSION = "lounge-v1.2.2";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./data/samples.js",
  "./assets/fonts/PretendardVariable.woff2",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/icon-maskable-512.png"
];
for (let i = 1; i <= 10; i++) {
  const n = String(i).padStart(2, "0");
  CORE.push(`./assets/img/t${n}.jpg`, `./assets/img/t${n}_sm.jpg`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 API는 그대로 통과

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
