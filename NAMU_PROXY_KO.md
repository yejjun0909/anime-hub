# ?섎Т?꾪궎 ?꾨줉??(Cloudflare Worker) 諛고룷 媛?대뱶

## ???꾩슂?쒓?
釉뚮씪?곗??먯꽌 ?섎Т?꾪궎瑜?吏곸젒 議고쉶?섎㈃ DNS/CORS 臾몄젣濡??ㅽ뙣?⑸땲??  
Cloudflare Worker瑜??꾨줉?쒕줈 ?먮㈃ 釉뚮씪?곗???Worker留??몄텧?섍퀬, Worker媛 ?섎Т?꾪궎瑜????議고쉶?⑸땲??

## 諛고룷 諛⑸쾿 (5遺?
1. Cloudflare 怨꾩젙 ?앹꽦 (臾대즺): https://dash.cloudflare.com
2. Workers & Pages ??Create ??Worker
3. `tools/namu-proxy-worker.js` ?댁슜??遺숈뿬?ｊ린
4. Deploy ??Worker URL ?뺤씤 (?? `https://namu-proxy.yourname.workers.dev`)
5. (?좏깮) 而ㅼ뒪? ?꾨찓???곌껐

## ?깆뿉 ?곌껐
`data/namu-search.js`??`ENDPOINTS`瑜?Worker URL濡?援먯껜?섍굅??  
`data/korean-source.js`?먯꽌 `searchNamu`瑜?Worker ?몄텧濡?諛붽퓠?덈떎.

?덉떆:
```js
const NAMU_PROXY = "https://namu-proxy.yourname.workers.dev";
async function searchNamuWiki(query) {
  const res = await fetch(`${NAMU_PROXY}?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({ title: r.title, overview: r.snippet, source: "?섎Т?꾪궎", url: `https://namu.wiki/wiki/${encodeURIComponent(r.title)}` }));
}
```

## 二쇱쓽
- ?섎Т?꾪궎??MediaWiki媛 ?꾨땲誘濡??붾뱶?ъ씤?멸? 蹂寃쎈맆 ???덉뒿?덈떎.
- Worker ?ㅽ뙣 ???깆? ?먮룞?쇰줈 ?쒓뎅???꾪궎諛깃낵濡??대갚?⑸땲??
- 臾대즺 Worker????100,000 ?붿껌 ?쒗븳???덉뒿?덈떎.
""", "path">
E:\?ㅼ슫濡쒕뱶\anime-hub\NAMU_PROXY_KO.md
## 앱에서 설정
설정(⚙) → 나무위키 프록시 (선택)에서 Worker URL을 입력하면 자동으로 사용됩니다.

