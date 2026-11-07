// ANIME HUB 서비스 워커 (v4.7+)
//
// 앱 코드(HTML/JS/CSS/JSON)는 네트워크 우선으로 가져와 새 배포가 즉시 반영되게 합니다.
// 이미지·아이콘 같은 정적 자산만 캐시 우선으로 처리합니다.
// 오프라인일 때는 마지막으로 캐시된 앱 셸을 사용합니다.

const CACHE_NAME = 'anime-hub-shell-v4-7-0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/korean-catalog.js',
  './data/korean-match.js',
  './data/korean-query.js',
  './data/korean-source.js',
  './data/search-aliases.js',
  './data/korean-josa.js',
  './data/api-vars.js',
  './data/schedule-merge.js',
  './data/schedule-cache.js',
  './data/schedule-status.js',
  './data/recommend-score.js',
  './data/recommend-eval.js',
  './data/sync-merge.js',
  './data/sync-queue.js',
  './data/user-korean.js',
  './data/machine-translate.js',
  './data/gemini-translate.js',
  './data/korean-titles-db.js',
  './data/korean-titles-db.json',
  './data/fuzzy-search.js',
  './data/namu-search.js',
  './data/korean-wiki.js',
  './manifest.webmanifest',
  './robots.txt',
  './sitemap.xml',
  './offline.html',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// 네트워크 우선으로 갱신할 앱 코드 확장자
const APP_CODE = /\.(?:html|js|css|json|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('anime-hub-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

function isAppCode(url) {
  return url.pathname.endsWith('/') || APP_CODE.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './offline.html'));
    return;
  }

  event.respondWith(isAppCode(url) ? networkFirst(request) : cacheFirst(request));
});
