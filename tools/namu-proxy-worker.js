// Cloudflare Worker: Namu Wiki 검색 프록시 (best-effort)
// 배포: wrangler deploy 또는 Cloudflare Dashboard에서 Worker 생성 후 붙여넣기.
// 사용: https://<worker>.workers.dev/?q=귀멸의+칼날
//
// 주의: 나무위키는 MediaWiki가 아닌 자체 엔진(the seed)을 사용합니다.
// 공개 검색 엔드포인트가 변경될 수 있으므로 best-effort로 동작합니다.

const NAMU_ENDPOINTS = [
  "https://wiki-api.namu.la/api",
  "https://namu.wiki/api"
];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300"
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: corsHeaders() });
    }

    for (const base of NAMU_ENDPOINTS) {
      try {
        const target = `${base}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`;
        const res = await fetch(target, { headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        const data = await res.json();
        const items = (data?.query?.search || []).map((r) => ({
          title: r.title,
          snippet: (r.snippet || "").replace(/<[^>]*>/g, "")
        }));
        if (items.length) {
          return new Response(JSON.stringify({ results: items, source: "namu" }), { status: 200, headers: corsHeaders() });
        }
      } catch (error) {
        // best-effort: 다음 엔드포인트 시도
      }
    }

    return new Response(JSON.stringify({ results: [], source: "namu", error: "no results" }), { status: 200, headers: corsHeaders() });
  }
};
""", "path">
E:\다운로드\anime-hub\tools\namu-proxy-worker.js