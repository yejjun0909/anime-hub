// 애니허브 서비스 워커 (v4.7+)
//
// 앱 코드(HTML/JS/CSS/JSON)는 네트워크 우선으로 가져와 새 배포가 즉시 반영되게 합니다.
// 이미지·아이콘 같은 정적 자산은 캐시 우선으로 처리합니다.
// 오프라인일 때는 마지막으로 캐시된 앱 셸과 포스터 이미지를 사용합니다.

const CACHE_NAME = 'anime-hub-shell-v4-11-0';
const IMAGE_CACHE = 'anime-hub-images-v1';
const IMAGE_HOSTS = new Set([
  's4.anilist.co',
  'image.tmdb.org',
  'cdn.myanimelist.net',
  'img.youtube.com',
  'i.ytimg.com'
]);
const IMAGE_CACHE_MAX = 180;
const PLACEHOLDER_IMAGE = new Response(
  '<svg xmlns="http://www.w3.org/2000/svg" width="230" height="320" viewBox="0 0 230 320">' +
  '<rect width="230" height="320" fill="#11131b"/>' +
  '<text x="115" y="165" fill="#5b6172" font-family="sans-serif" font-size="16" text-anchor="middle">이미지 없음</text>' +
  '</svg>',
  { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' } }
);
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/korean-catalog.js',
  './data/korean-match.js',
  './data/korean-platform-catalog.js',
  './data/korean-platform-match.js',
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
  './data/korean-common-titles.js',
  './data/korean-title-index.js',
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
      // HTTP 캐시가 아니라 서버에서 새 파일을 받아 셸을 갱신합니다.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
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

async function trimImageCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMAGE_CACHE_MAX) return;
  await Promise.all(keys.slice(0, keys.length - IMAGE_CACHE_MAX).map((key) => cache.delete(key)));
}

// 외부 포스터 이미지는 캐시 우선으로 보여 주고, 오프라인에 없으면 자리 표시자를 반환합니다.
async function cachedImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // 외부 이미지는 CORS 없이 오는 opaque 응답일 수 있으므로 함께 캐시합니다.
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      trimImageCache(cache).catch(() => {});
      return response;
    }
  } catch (error) {
    // 오프라인 상태: 아래 자리 표시자로 대체합니다.
  }
  return PLACEHOLDER_IMAGE.clone();
}

function isAppCode(url) {
  return url.pathname.endsWith('/') || APP_CODE.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (request.destination === 'image' && IMAGE_HOSTS.has(url.hostname)) {
      event.respondWith(cachedImage(request));
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './offline.html'));
    return;
  }

  event.respondWith(isAppCode(url) ? networkFirst(request) : cacheFirst(request));
});
