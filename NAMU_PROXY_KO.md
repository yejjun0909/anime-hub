# 나무위키 프록시 (Cloudflare Worker) 배포 가이드

## 왜 필요한가
브라우저에서 나무위키를 직접 조회하면 DNS/CORS 문제로 실패합니다.  
Cloudflare Worker를 프록시로 두면 브라우저는 Worker만 호출하고, Worker가 나무위키를 대신 조회합니다.

## 배포 방법 (5분)
1. Cloudflare 계정 생성 (무료): https://dash.cloudflare.com
2. Workers & Pages → Create → Worker
3. `tools/namu-proxy-worker.js` 내용을 붙여넣기
4. Deploy → Worker URL 확인 (예: `https://namu-proxy.yourname.workers.dev`)
5. (선택) 커스텀 도메인 연결

## 앱에 연결
`data/namu-search.js`의 `ENDPOINTS`를 Worker URL로 교체하거나,  
`data/korean-source.js`에서 `searchNamu`를 Worker 호출로 바꿉니다.

예시:
```js
const NAMU_PROXY = "https://namu-proxy.yourname.workers.dev";
async function searchNamuWiki(query) {
  const res = await fetch(`${NAMU_PROXY}?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({ title: r.title, overview: r.snippet, source: "나무위키", url: `https://namu.wiki/wiki/${encodeURIComponent(r.title)}` }));
}
```

## 주의
- 나무위키는 MediaWiki가 아니므로 엔드포인트가 변경될 수 있습니다.
- Worker 실패 시 앱은 자동으로 한국어 위키백과로 폴백합니다.
- 무료 Worker는 일 100,000 요청 제한이 있습니다.
""", "path">
E:\다운로드\anime-hub\NAMU_PROXY_KO.md