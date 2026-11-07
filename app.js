import { findKoreanCatalogRecord } from './data/korean-match.js';
import { pruneNullVariables } from './data/api-vars.js';
import { mergeAiringRows } from './data/schedule-merge.js';
import { readAiringCache, writeAiringCache, isFreshAiringCache } from './data/schedule-cache.js';
import { classifyAiring, writeAiringBaseline, readAiringBaseline } from './data/schedule-status.js';
import { getUserKorean, setUserKorean, deleteUserKorean } from './data/user-korean.js';
import { lookupKoreanTitle, loadKoreanTitlesDb, isDbLoaded } from './data/korean-titles-db.js';
import { getGeminiKey, setGeminiKey } from './data/gemini-translate.js';
import { lookupKoreanSource } from './data/korean-source.js';
import { rankCandidates, selectDiverse } from './data/recommend-score.js';
import { evaluateRecommendation as recommendationMetrics, coldStartStrategy } from './data/recommend-eval.js';
import { mergeWatchlistWithConflicts } from './data/sync-merge.js';
import { readQueue, writeQueue, dequeue, markAttempt } from './data/sync-queue.js';
import { fuzzyFilter, searchVariants, normalizeForSearch } from './data/fuzzy-search.js';

const APP_VERSION = '4.7.0';
const ANILIST_URL = 'https://graphql.anilist.co';
const JIKAN_URL = 'https://api.jikan.moe/v4';
const CONFIG_KEY = 'animehub_supabase_config_v1';
const LOCAL_LIST_KEY = 'animehub_watchlist_v1';
const API_CACHE_KEY = 'animehub_api_cache_v2_v4_5';
const SAVED_SEARCH_KEY = 'animehub_saved_searches_v1';
const TRANSLATION_CACHE_KEY = 'animehub_translation_ko_v1';
const TMDB_CONFIG_KEY = 'animehub_tmdb_config_v1';
const KOREAN_METADATA_CACHE_KEY = 'animehub_korean_metadata_v3';
const KOREAN_ALIAS_CACHE_KEY = 'animehub_korean_title_aliases_v1';
const LOCAL_OWNER_KEY = 'animehub_local_owner_v1';
const CLIENT_ID_KEY = 'animehub_client_id_v1';
const LOCAL_COLLECTION_KEY = 'animehub_collections_v1';
const RELEASE_ALERT_KEY = 'animehub_release_alerts_v1';
const RELEASE_SEEN_KEY = 'animehub_release_seen_v1';
const API_CACHE_TTL_MS = 20 * 60 * 1000;
const AUTO_REFRESH_MS = 20 * 60 * 1000;
const API_CACHE_MAX_ITEMS = 18;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  route: location.hash.replace('#', '') || 'home', recentViews: readRecentViews(),
  query: '', page: 1, hasNext: false, results: [], filters: defaultFilters(),
  watchlist: loadLocalList(), collections: loadCollections(), savedSearches: loadSavedSearches(), user: null, supabase: null, supabaseError: '',
  installPrompt: null, lastAiring: [], homeMedia: [], movieMedia: [], recommendedMedia: [], currentModal: null, browseMode: 'anime', mediaIndex: new Map(), watchStatusFilter: '', activeCollectionId: null, franchiseFocus: null, peopleMode: 'ALL', notificationsEnabled: localStorage.getItem(RELEASE_ALERT_KEY)==='1',
  forceRefreshApi: false, lastAutoRefresh: Date.now(), lastDataUpdated: 0, staleDataUsed: false, syncStatus: 'idle', cloudProfileWarned: false, pendingConflicts: [], recommendMetrics: null, lastSearchFuzzy: false, airingMineOnly: false, airingAllItems: [], airingSource: 'AniList 방영 일정', airingTimeZone: (localStorage.getItem('animehub_airing_tz_v1') || 'Asia/Seoul')
};

const MEDIA_FIELDS = `
  id idMal
  title { romaji english native userPreferred }
  synonyms
  coverImage { extraLarge large }
  bannerImage
  description(asHtml:false)
  format status episodes duration season seasonYear
  startDate { year month day } endDate { year month day }
  averageScore popularity favourites genres
  studios(isMain:true) { nodes { id name } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  siteUrl
`;

// 목록·검색 화면에서는 카드에 필요한 데이터만 요청합니다. 작품 소개 등 무거운 필드는 상세 화면에서 별도로 가져옵니다.
const LIST_MEDIA_FIELDS = `
  id idMal title { romaji english native userPreferred }
  synonyms
  coverImage { extraLarge large }
  bannerImage
  format status episodes season seasonYear countryOfOrigin
  startDate { year month day }
  averageScore popularity favourites genres
  studios(isMain:true) { nodes { id name } }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  siteUrl
`;
const SCHEDULE_MEDIA_FIELDS = `id idMal title{romaji english native userPreferred} synonyms coverImage{extraLarge large} format status episodes seasonYear genres averageScore popularity siteUrl`;

const GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller'];
const FORMATS = [
  ['TV','TV 시리즈'], ['TV_SHORT','단편 TV'], ['MOVIE','영화'], ['SPECIAL','스페셜'], ['OVA','OVA'], ['ONA','ONA'], ['MUSIC','뮤직 비디오']
];
const STATUSES = [
  ['PLANNING','볼 예정'], ['CURRENT','시청 중'], ['COMPLETED','시청 완료'], ['PAUSED','보류'], ['DROPPED','하차']
];

function defaultFilters(){ return {status:'',format:'',country:'',yearFrom:'',yearTo:'',episodeMin:'',episodeMax:'',scoreMin:'',scoreMax:'',genres:[],sort:'POPULARITY_DESC'}; }
function getClientId(){
  try{
    let id=localStorage.getItem(CLIENT_ID_KEY);
    if(!id){id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem(CLIENT_ID_KEY,id);}
    return id;
  }catch(error){return 'c'+Date.now().toString(36);}
}
function loadLocalList(){ try { return JSON.parse(localStorage.getItem(LOCAL_LIST_KEY) || '[]'); } catch { return []; } }
function saveLocalList(){ localStorage.setItem(LOCAL_LIST_KEY, JSON.stringify(state.watchlist)); }
function loadCollections(){ try { const value=JSON.parse(localStorage.getItem(LOCAL_COLLECTION_KEY)||'[]'); return Array.isArray(value)?value:[]; } catch { return []; } }
function saveCollections(options={}){ try { localStorage.setItem(LOCAL_COLLECTION_KEY,JSON.stringify(state.collections)); if(options.cloud!==false)syncUserDataQuietly(); } catch { toast('컬렉션을 저장할 공간이 부족합니다.','error'); } }
function loadSavedSearches(){ try { const value=JSON.parse(localStorage.getItem(SAVED_SEARCH_KEY)||'[]'); return Array.isArray(value)?value:[]; } catch { return []; } }
function saveSavedSearches(options={}){ try { localStorage.setItem(SAVED_SEARCH_KEY,JSON.stringify(state.savedSearches)); if(options.cloud!==false)syncUserDataQuietly(); } catch { toast('검색 조건을 저장할 공간이 부족합니다.','error'); } }
function esc(value='') { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cleanDescription(value=''){ return String(value).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/\s+\n/g,'\n').replace(/[ \t]{2,}/g,' ').trim(); }
function titleOf(m){ return m?.title?.english || m?.title?.romaji || m?.title?.userPreferred || m?.title?.native || m?.title || '제목 미상'; }
function posterOf(m){ return m?.coverImage?.extraLarge || m?.coverImage?.large || m?.images?.jpg?.large_image_url || m?.images?.webp?.large_image_url || ''; }
function yearOf(m){ return m?.seasonYear || m?.startDate?.year || m?.year || '연도 미상'; }
function scoreOf(m){ return m?.averageScore ?? (m?.score ? Math.round(m.score * 10) : null); }
function formatOf(m){ return ({TV:'TV',TV_SHORT:'단편',MOVIE:'영화',SPECIAL:'스페셜',OVA:'OVA',ONA:'ONA',MUSIC:'뮤직'}[m?.format || m?.type] || m?.format || m?.type || '작품'); }
function statusOf(s){ return ({FINISHED:'방영 완료',RELEASING:'방영 중',NOT_YET_RELEASED:'방영 예정',CANCELLED:'취소',HIATUS:'휴재/중단'}[s] || s || '정보 없음'); }
function localDate(unix){ if(!unix) return '일정 미정'; return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(unix*1000)); }
function currentSeason(){ const m = new Date().getMonth()+1; return (m===12 || m<=2)?'WINTER':m<=5?'SPRING':m<=8?'SUMMER':'FALL'; }
function seasonLabel(s){ return ({WINTER:'겨울',SPRING:'봄',SUMMER:'여름',FALL:'가을'}[s] || s || ''); }
function dateRange(year){ return {startGreater: year*10000, startLesser:(year+1)*10000}; }
function toast(message, type=''){ const node=document.createElement('div');node.className='toast '+type;node.textContent=message;$('#toast-root').append(node);setTimeout(()=>node.remove(),3300); }
function setLoading(node, message='불러오는 중...'){ if(node) node.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍◌</div><strong>${esc(message)}</strong><span>외부 데이터베이스에서 정보를 가져오고 있습니다.</span></div>`; }

// AniList 요청은 직렬화하고 캐시·재시도·시간 제한을 적용합니다.
let aniQueue = Promise.resolve();
let lastAniRequest = 0;
const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms));
function hashText(value){ let h=2166136261; for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
function readApiCache(){ try { const value=JSON.parse(localStorage.getItem(API_CACHE_KEY)||'{}'); return value&&typeof value==='object'?value:{}; } catch { return {}; } }
function writeApiCache(key,data){
  try{
    const cache=readApiCache();cache[key]={savedAt:Date.now(),data};
    const entries=Object.entries(cache).sort((a,b)=>(b[1]?.savedAt||0)-(a[1]?.savedAt||0)).slice(0,API_CACHE_MAX_ITEMS);
    localStorage.setItem(API_CACHE_KEY,JSON.stringify(Object.fromEntries(entries)));
  }catch(error){ console.warn('API cache save skipped:',error); }
}
async function anilist(query, variables={}, options={}){
  // AniList는 비교 연산자(averageScore_greater 등)에 null이 오면 400을 반환합니다.
  // 값이 없는 필터는 요청에서 제거하고, 캐시 키도 같은 기준으로 만듭니다.
  const requestVariables=pruneNullVariables(variables);
  const cacheKey=hashText(query+'|'+JSON.stringify(requestVariables));
  const cache=readApiCache();
  const cached=cache[cacheKey];
  const force=options.forceRefresh===true || state.forceRefreshApi;
  if(cached?.data && !force && Date.now()-cached.savedAt<API_CACHE_TTL_MS){ state.lastDataUpdated=cached.savedAt;return cached.data; }
  const task=async()=>{
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      const wait=Math.max(0,2100-(Date.now()-lastAniRequest));
      if(wait) await waitMs(wait);
      lastAniRequest=Date.now();
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),25000);
      try{
        const response=await fetch(ANILIST_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query,variables:requestVariables}),signal:controller.signal});
        if(response.status===429 || response.status>=500){
          const retryAfter=Number(response.headers.get('Retry-After'));
          const delay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,30000):3500*(attempt+1);
          lastError=new Error(response.status===429?'AniList 요청 제한에 도달했습니다.':'AniList 서버가 일시적으로 응답하지 않습니다.');
          if(attempt<2){await waitMs(delay);continue;}
          throw lastError;
        }
        let body; try{body=await response.json();}catch{throw new Error('AniList 응답을 해석하지 못했습니다.');}
        if(!response.ok || body.errors?.length){
          const msg=body.errors?.[0]?.message || `AniList 요청 오류 (${response.status})`;
          throw new Error(msg);
        }
        writeApiCache(cacheKey,body.data);
        state.lastDataUpdated=Date.now();
        return body.data;
      }catch(error){
        lastError=error.name==='AbortError'?new Error('AniList 응답 시간이 초과되었습니다.'):error;
        if(attempt<2 && (error.name==='TypeError' || error.name==='AbortError')){await waitMs(1200*(attempt+1));continue;}
        throw lastError;
      }finally{clearTimeout(timeout);}
    }
    throw lastError||new Error('AniList 요청에 실패했습니다.');
  };
  const result=aniQueue.then(task,task);aniQueue=result.catch(()=>{});
  try{return await result;}catch(error){
    if(cached?.data){state.staleDataUsed=true;state.lastDataUpdated=cached.savedAt;console.warn('AniList stale cache used:',error);return cached.data;}
    throw error;
  }
}

let jikanQueue=Promise.resolve();
let lastJikanRequest=0;
async function jikan(path){
  const url=`${JIKAN_URL}${path}`;const cacheKey=`jikan:${hashText(url)}`;
  const cache=readApiCache();const cached=cache[cacheKey];
  if(cached?.data && !state.forceRefreshApi && Date.now()-cached.savedAt<API_CACHE_TTL_MS)return cached.data;
  const task=async()=>{
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      const wait=Math.max(0,380-(Date.now()-lastJikanRequest));if(wait)await waitMs(wait);
      lastJikanRequest=Date.now();
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
      try{
        const response=await fetch(url,{signal:controller.signal});
        if(response.status===429){lastError=new Error('MyAnimeList 보조 데이터 요청이 잠시 제한되었습니다.');if(attempt===0){await waitMs(3500);continue;}throw lastError;}
        if(!response.ok)throw new Error(`MyAnimeList 보조 데이터 연결 실패 (${response.status})`);
        const data=await response.json();writeApiCache(cacheKey,data);return data;
      }catch(error){lastError=error.name==='AbortError'?new Error('MyAnimeList 보조 데이터 응답 시간이 초과되었습니다.'):error;if(attempt===0&&(error.name==='TypeError'||error.name==='AbortError')){await waitMs(1000);continue;}break;}
      finally{clearTimeout(timeout);}
    }
    if(cached?.data){state.staleDataUsed=true;return cached.data;}
    throw lastError||new Error('MyAnimeList 보조 데이터 조회에 실패했습니다.');
  };
  const result=jikanQueue.then(task,task);jikanQueue=result.catch(()=>{});return result;
}

function hasHangul(value=''){ return /[가-힣]/.test(String(value)); }
function isMostlyKorean(value=''){const text=String(value).replace(/[^\p{L}\p{N}]/gu,'');if(!text)return false;const matches=String(value).match(/[가-힣]/g)||[];return matches.length/Math.max(1,text.length)>=0.65;}
function parseJikanDate(value){
  if(!value)return null;const parts=String(value).slice(0,10).split('-').map(Number);
  return {year:parts[0]||null,month:parts[1]||null,day:parts[2]||null};
}
function nextBroadcastTimestamp(broadcast, now=new Date()){
  if(!broadcast?.day||!broadcast?.time)return null;
  const timezone=String(broadcast.timezone||'Asia/Tokyo');
  if(!['Asia/Tokyo','Asia/Seoul'].includes(timezone))return null;
  const days={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
  const dayKey=String(broadcast.day).toLowerCase().replace(/s$/,'').trim();
  const targetDay=days[dayKey];
  const match=String(broadcast.time).match(/^(\d{1,2}):(\d{2})/);
  if(targetDay==null||!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]);if(hour>23||minute>59)return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const today=new Date(`${values.year}-${values.month}-${values.day}T12:00:00+09:00`);
  const dayDelta=(targetDay-today.getUTCDay()+7)%7;
  let candidate=new Date(today.getTime()+dayDelta*86400000);
  candidate=new Date(`${candidate.toISOString().slice(0,10)}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+09:00`);
  if(candidate.getTime()<=now.getTime())candidate=new Date(candidate.getTime()+7*86400000);
  return Math.floor(candidate.getTime()/1000);
}
function mapJikanScheduleItem(item){
  const media=mapJikanAnime(item);const airingAt=nextBroadcastTimestamp(item.broadcast);
  if(!airingAt)return null;
  media.nextAiringEpisode={airingAt,episode:null};media.broadcast=item.broadcast?.string||'';return media;
}
function mapJikanAnime(item){
  const typeMap={TV:'TV',Movie:'MOVIE',OVA:'OVA',ONA:'ONA',Special:'SPECIAL',Music:'MUSIC'};
  const statusMap={'Finished Airing':'FINISHED','Currently Airing':'RELEASING','Not yet aired':'NOT_YET_RELEASED'};
  const genres=(item.genres||[]).map(x=>x.name).filter(Boolean);
  const startDate=parseJikanDate(item.aired?.from);
  return {
    id:`mal:${item.mal_id}`,mal_id:item.mal_id,idMal:item.mal_id,
    title:{romaji:item.title||'',english:item.title_english||null,native:item.title_japanese||null,userPreferred:item.title_english||item.title||''},
    synonyms:[...(item.title_synonyms||[]),...(item.titles||[]).map(x=>x?.title).filter(Boolean)],
    coverImage:{extraLarge:item.images?.webp?.large_image_url||item.images?.jpg?.large_image_url||item.images?.webp?.image_url||item.images?.jpg?.image_url||''},
    description:item.synopsis||'',format:typeMap[item.type]||item.type||'작품',status:statusMap[item.status]||item.status||'',
    episodes:item.episodes||null,duration:null,season:null,seasonYear:item.year||startDate?.year||null,startDate,
    endDate:parseJikanDate(item.aired?.to),averageScore:item.score?Math.round(item.score*10):null,
    popularity:item.members||0,favourites:item.favorites||0,genres,
    studios:{nodes:(item.studios||[]).map(x=>({name:x.name}))},siteUrl:item.url||'',nextAiringEpisode:null
  };
}
function loadTMDBConfig(){try{return JSON.parse(localStorage.getItem(TMDB_CONFIG_KEY)||'{}')||{};}catch{return {};}}
function tmdbToken(){return String(loadTMDBConfig().readAccessToken||'').trim();}
function normalizeTitleForMatch(value=''){return String(value||'').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu,'').replace(/시즌\d+|season\d+/g,'');}
async function tmdbGet(path,params={}){
  const token=tmdbToken();if(!token)throw new Error('TMDB Read Access Token이 설정되지 않았습니다.');
  const url=new URL(`https://api.themoviedb.org/3${path}`);Object.entries(params).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));});
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
  try{const response=await fetch(url,{headers:{accept:'application/json',Authorization:`Bearer ${token}`},signal:controller.signal});if(!response.ok){if(response.status===401)throw new Error('TMDB 인증에 실패했습니다. Read Access Token을 확인해 주세요.');if(response.status===429)throw new Error('TMDB 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');throw new Error(`TMDB 응답 오류 (${response.status})`);}return await response.json();}
  finally{clearTimeout(timeout);}
}
function tmdbCandidateTitles(media,extra=[]){
  const main=[media?.title?.english,media?.title?.userPreferred,media?.title?.romaji,media?.title?.native].filter(Boolean);
  const aliases=(media?.synonyms||[]).filter(Boolean);
  const korean=[...aliases.filter(hasHangul),...extra.filter(hasHangul)];
  const rest=[...aliases.filter(x=>!hasHangul(x)),...extra.filter(x=>!hasHangul(x))];
  return [...new Set([...main,...korean,...rest].map(x=>String(x).trim()).filter(x=>x.length>1))].slice(0,24);
}
function tmdbSearchQueries(media,extra=[]){
  const values=tmdbCandidateTitles(media,extra);
  const out=[];const seen=new Set();
  for(const value of values){
    const key=normalizeTitleForMatch(value);if(key.length<3||seen.has(key))continue;seen.add(key);
    const language=hasHangul(value)?'ko-KR':/[ぁ-ヿ一-龯]/u.test(value)?'ja-JP':'en-US';
    out.push({query:value,language});
    if(out.length>=15)break;
  }
  return out;
}
function tmdbResultYear(result,kind){const date=kind==='movie'?result.release_date:result.first_air_date;const year=Number(String(date||'').slice(0,4));return Number.isFinite(year)&&year>0?year:null;}
function chooseTMDBMatch(results,media,kind,searchQuery=''){
  const candidates=tmdbCandidateTitles(media).map(normalizeTitleForMatch).filter(x=>x.length>=3);
  const queryKey=normalizeTitleForMatch(searchQuery);
  const year=Number(media?.seasonYear||media?.startDate?.year||media?.year||0)||null;
  const expectedJapan=media?.countryOfOrigin==='JP';
  const ranked=(results||[]).map((item,index)=>{
    const names=[kind==='movie'?item.original_title:item.original_name,kind==='movie'?item.title:item.name].filter(Boolean).map(normalizeTitleForMatch);
    let titleHit=0;
    for(const a of [...candidates,queryKey].filter(Boolean))for(const b of names){
      if(!a||!b)continue;
      if(a===b)titleHit=Math.max(titleHit,12);
      else if(Math.min(a.length,b.length)>=6){
        const shorter=a.length<=b.length?a:b, longer=a.length>b.length?a:b;
        if(longer.includes(shorter)&&shorter.length/longer.length>=0.72)titleHit=Math.max(titleHit,8);
      }
    }
    const itemYear=tmdbResultYear(item,kind);const yearGap=year&&itemYear?Math.abs(year-itemYear):null;
    const yearScore=yearGap===0?4:yearGap===1?2:yearGap===2?1:yearGap===null?0:-8;
    const originJapan=(item.origin_country||[]).includes('JP')||item.original_language==='ja';
    const genreAnimation=(item.genre_ids||[]).includes(16);
    const typeScore=(expectedJapan&&originJapan?2:originJapan?1:0)+(genreAnimation?2:0);
    const rankScore=index===0?0.6:index<3?0.25:0;
    return {...item,_localMatchScore:titleHit+yearScore+typeScore+rankScore,_yearGap:yearGap,_titleHit:titleHit,_originJapan:originJapan,_genreAnimation:genreAnimation,_resultIndex:index};
  });
  // Normal matching is title-based. A cautious fallback is permitted only when TMDB itself
  // returned a clear first result for the query and Japanese animation/year metadata agree.
  const exact=ranked.filter(item=>item._titleHit>=5&&(item._yearGap===null||item._yearGap<=5));
  exact.sort((a,b)=>b._localMatchScore-a._localMatchScore||Number(b.popularity||0)-Number(a.popularity||0));
  if(exact.length)return exact[0];
  const safeFallback=ranked.filter(item=>item._resultIndex===0&&item._originJapan&&item._genreAnimation&&(item._yearGap===null||item._yearGap<=2));
  return safeFallback.length?safeFallback[0]:null;
}
function readKoreanAliasCache(){try{const data=JSON.parse(localStorage.getItem(KOREAN_ALIAS_CACHE_KEY)||'{}');return data&&typeof data==='object'?data:{};}catch{return {};}}
function writeKoreanAliasCache(media,value){
  const id=media?.id!=null?String(media.id):null,mal=media?.idMal?`mal:${media.idMal}`:null;if(!id&&!mal)return;
  try{const cache=readKoreanAliasCache();for(const key of [id,mal].filter(Boolean))cache[key]={...value,savedAt:Date.now()};const entries=Object.entries(cache).sort((a,b)=>(b[1]?.savedAt||0)-(a[1]?.savedAt||0)).slice(0,600);localStorage.setItem(KOREAN_ALIAS_CACHE_KEY,JSON.stringify(Object.fromEntries(entries)));}catch(error){console.warn('Korean title alias cache save skipped:',error);}
}
function cachedKoreanAlias(media){const cache=readKoreanAliasCache();for(const key of [media?.id!=null?String(media.id):null,media?.idMal?`mal:${media.idMal}`:null].filter(Boolean)){const item=cache[key];if(item){const partial=!!item.titles?.length!==!!item.overview;const ttl=item.missing?14:partial?30:90;if(Date.now()-Number(item.savedAt||0)<ttl*86400000)return item;}}return null;}
function cleanKoreanAlias(value){const text=cleanDescription(value||'').replace(/\s+/g,' ').trim();return hasHangul(text)&&text.length>=2&&text.length<=90?text:'';}
function collectJikanKoreanAliases(data){
  const values=[...(data?.title_synonyms||[]),...(data?.titles||[]).map(x=>x?.title).filter(Boolean)];
  const unique=[...new Set(values.map(cleanKoreanAlias).filter(Boolean))];
  return unique.sort((a,b)=>koreanAliasQuality(b)-koreanAliasQuality(a)||b.length-a.length);
}
async function getJikanKoreanInfo(media){
  const id=Number(media?.idMal||media?.mal_id||0);if(!Number.isInteger(id)||id<=0)return null;
  const old=cachedKoreanAlias(media);if(old)return old.missing?null:old;
  try{
    const payload=await jikan(`/anime/${id}/full`);const data=payload?.data||{};
    const titles=collectJikanKoreanAliases(data);
    const synopsis=isMostlyKorean(data.synopsis||'')?cleanDescription(data.synopsis):'';
    const value={titles,overview:synopsis,source:'MyAnimeList / Jikan',url:`https://myanimelist.net/anime/${id}`,missing:!titles.length&&!synopsis};
    writeKoreanAliasCache(media,value);return value.missing?null:value;
  }catch(error){console.warn('Korean MAL alias lookup skipped:',error.message);return null;}
}
async function getTMDBKoreanTranslation(match,kind){
  if(!match?.id)return null;
  try{
    const payload=await tmdbGet(`/${kind}/${match.id}/translations`);
    const rows=(payload.translations||[]).filter(row=>row.iso_639_1==='ko'&&row.data);
    const preferred=rows.find(row=>row.iso_3166_1==='KR')||rows.find(row=>row.iso_3166_1==='US')||rows[0];
    if(!preferred)return null;
    const data=preferred.data||{};
    return {title:String(data.title||data.name||'').trim(),overview:String(data.overview||'').trim(),country:preferred.iso_3166_1||''};
  }catch(error){console.warn('TMDB Korean translation endpoint skipped:',error.message);return null;}
}
async function getTMDBKoreanDetails(match,kind){
  if(!match?.id)return null;
  try{const detail=await tmdbGet(`/${kind}/${match.id}`,{language:'ko-KR'});const title=String(detail.title||detail.name||'').trim(),overview=String(detail.overview||'').trim();return {title,overview,titleCountry:hasHangul(title)?'KR':'',overviewCountry:isMostlyKorean(overview)?'KR':''};}
  catch(error){console.warn('TMDB Korean detail request skipped:',error.message);return null;}
}
async function findKoreanMetadata(media,options={}){
  if(!tmdbToken())return null;
  const old=options.force?null:cachedKoreanMetadata(media);if(old)return old.missing?null:old;
  const kind=media?.format==='MOVIE'?'movie':'tv';
  const jikanInfo=options.jikanInfo||cachedKoreanAlias(media)||await getJikanKoreanInfo(media);
  const aliases=jikanInfo?.titles||[];const queries=tmdbSearchQueries(media,aliases);if(!queries.length)return null;
  let match=null;
  for(const item of queries){
    const params={query:item.query,language:item.language,include_adult:false};
    const year=Number(media?.seasonYear||media?.startDate?.year||media?.year||0);
    if(year)params[kind==='movie'?'year':'first_air_date_year']=year;
    let payload=await tmdbGet(`/search/${kind}`,params);
    match=chooseTMDBMatch(payload.results,media,kind,item.query);
    if(!match&&year){delete params[kind==='movie'?'year':'first_air_date_year'];payload=await tmdbGet(`/search/${kind}`,params);match=chooseTMDBMatch(payload.results,media,kind,item.query);}
    if(match)break;
  }
  let accepted=null;
  if(match){
    const detail=await getTMDBKoreanDetails(match,kind);
    let title=detail?.title||'',overview=detail?.overview||'';
    let titleCountry=detail?.titleCountry||'',overviewCountry=detail?.overviewCountry||'';
    if(!hasHangul(title)||!isMostlyKorean(overview)){
      const translated=await getTMDBKoreanTranslation(match,kind);
      if(translated){
        if(!hasHangul(title)&&hasHangul(translated.title)){title=translated.title;titleCountry=translated.country||'ko';}
        if(!isMostlyKorean(overview)&&isMostlyKorean(translated.overview)){overview=translated.overview;overviewCountry=translated.country||'ko';}
      }
    }
    if(hasHangul(title)||isMostlyKorean(overview)){
      accepted={title:hasHangul(title)?title:'',overview:isMostlyKorean(overview)?cleanDescription(overview):'',source:'TMDB',titleCountry,overviewCountry,translationCountry:titleCountry||overviewCountry,tmdbId:match.id,mediaType:kind,url:`https://www.themoviedb.org/${kind}/${match.id}`,missing:!hasHangul(title)&&!isMostlyKorean(overview)};
    }
  }
  if(!accepted)accepted={title:'',overview:'',source:'TMDB',missing:true};
  writeKoreanMetadata(media,accepted);return accepted.missing?null:accepted;
}
async function enrichKoreanMetadata(items,concurrency=2){
  if(!Array.isArray(items)||!items.length)return;
  let cursor=0;const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(cursor<items.length){const item=items[cursor++];
      try{
        let alias=cachedKoreanAlias(item);
        if(!curatedKoreanOverride(item)&&!koreanAniListSynonym(item)&&!alias)alias=await getJikanKoreanInfo(item);
        if(tmdbToken()&&!cachedKoreanMetadata(item))await findKoreanMetadata(item,{jikanInfo:alias});
      }catch(error){console.warn('Korean metadata enrichment skipped:',titleOf(item),error.message);}
    }
  });await Promise.all(workers);
}
// 한국어 소스 폴백 (v4.7+): 나무위키(best-effort) → AI 후보로 나무위키 재검색 → 한국어 위키백과
// AI는 오직 나무위키 검색 후보 생성에만 사용하며, 화면 표시 출처로 쓰지 않습니다.
async function lookupKoreanFallback(nativeTitle){
  return lookupKoreanSource(nativeTitle);
}
async function loadKoreanMetadataIntoDetail(media,options={}){
  const root=$('#modal-root');const modal=state.currentModal;if(!media||!root||modal?.media?.id!==media.id)return;
  const titleNode=$('[data-translate-title]',root),descNode=$('[data-translate-description]',root),sourceNode=$('[data-korean-metadata-source]',root);
  if(!titleNode||!descNode)return;
  const refresh=()=>{
    titleNode.textContent=localizedTitle(media);
    const overview=localizedDescription(media);if(overview){descNode.textContent=overview;descNode.dataset.descriptionKind='localized';}
    else{descNode.textContent=cleanDescription(media.description||media.synopsis||'작품 설명이 등록되지 않았습니다.');descNode.dataset.descriptionKind='original';}
    if(sourceNode)sourceNode.innerHTML=koreanMetadataSourceMarkup(media);
  };
  refresh();
  try{
    if(!curatedKoreanOverride(media)&&!koreanAniListSynonym(media)&&!cachedKoreanAlias(media))await getJikanKoreanInfo(media);
    if(tmdbToken()&&(options.force||!cachedKoreanMetadata(media)||cachedKoreanMetadata(media)?.missing))await findKoreanMetadata(media,{force:options.force===true});
    // 한국어 소스 조회 (v4.7+): 나무위키 → AI 보조 재검색 → 한국어 위키백과
    // 이미 확인된 한국어 제목(카탈로그/DB/사용자/TMDB/AniList)이 있으면 덮어쓰지 않습니다.
    if(!curatedKoreanOverride(media)&&!getUserKorean(media)&&!cachedKoreanMetadata(media)?.title){
      const nativeTitle=media?.title?.native||media?.title?.romaji||media?.title?.english;
      if(nativeTitle&&String(nativeTitle).trim().length>1){
        const found=await lookupKoreanFallback(nativeTitle);
        if(found?.title)writeKoreanMetadata(media,{title:found.title,overview:found.overview||'',source:found.source,kind:found.kind,titleCountry:'KR',missing:false,url:found.url||''});
      }
    }
    if(state.currentModal?.media?.id!==media.id)return;
    refresh();
    const originalNode=$('[data-translation-original-content]',root);if(originalNode)originalNode.textContent=cleanDescription(media.description||media.synopsis||'원문 설명이 없습니다.');
    const card=document.querySelector(`[data-open="${CSS.escape(String(media.id))}"] .card-title`);if(card)card.textContent=localizedTitle(media);
  }catch(error){if(sourceNode)sourceNode.textContent=`한국어 정보 조회 중 오류 · ${error.message}`;}
}
function readTranslationCache(){try{const value=JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
function writeTranslationCache(key,value){try{const cache=readTranslationCache();cache[key]={savedAt:Date.now(),value};const entries=Object.entries(cache).sort((a,b)=>(b[1]?.savedAt||0)-(a[1]?.savedAt||0)).slice(0,120);localStorage.setItem(TRANSLATION_CACHE_KEY,JSON.stringify(Object.fromEntries(entries)));}catch{/* translation cache is optional */}}
function decodeTranslationEntities(value=''){
  return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'\"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ');
}
async function translateWithMyMemory(text,target='ko'){
  const chunks=[];for(let i=0;i<text.length;i+=430)chunks.push(text.slice(i,i+430));
  const out=[];
  for(const chunk of chunks){
    const params=new URLSearchParams({q:chunk,langpair:`autodetect|${target}`});
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(`https://api.mymemory.translated.net/get?${params}`,{signal:controller.signal});
      if(!response.ok)throw new Error(`번역 보조 서버 응답 오류 (${response.status})`);
      const payload=await response.json();const translated=payload?.responseData?.translatedText;
      if(!translated||payload?.responseStatus&&Number(payload.responseStatus)>=400)throw new Error('번역 결과가 비어 있습니다.');
      out.push(decodeTranslationEntities(translated));
    }finally{clearTimeout(timeout);}
  }
  return out.join('');
}
async function translateText(text,target='ko'){
  const source=String(text||'').trim();if(!source)return '';
  if(target==='ko'&&isMostlyKorean(source))return source;
  const cacheKey=hashText(`${target}|${source}`);const cached=readTranslationCache()[cacheKey];
  if(cached?.value&&Date.now()-cached.savedAt<30*24*60*60*1000)return cached.value;
  // Google 공개 번역 엔드포인트를 우선 사용하고, 실패하면 MyMemory 공개 번역 API를 보조로 사용합니다.
  const chunks=[];for(let i=0;i<source.length;i+=2800)chunks.push(source.slice(i,i+2800));
  try{
    const translated=[];
    for(const chunk of chunks){
      const params=new URLSearchParams({client:'gtx',sl:'auto',tl:target,dt:'t',q:chunk});
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),6500);
      try{
        const response=await fetch(`https://translate.googleapis.com/translate_a/single?${params}`,{signal:controller.signal});
        if(!response.ok)throw new Error(`Google 번역 서버 응답 오류 (${response.status})`);
        const payload=await response.json();
        const textPart=Array.isArray(payload?.[0])?payload[0].map(x=>x?.[0]||'').join(''):'';
        if(!textPart)throw new Error('Google 번역 결과가 비어 있습니다.');
        translated.push(textPart);
      }finally{clearTimeout(timeout);}
    }
    const result=translated.join('');writeTranslationCache(cacheKey,result);return result;
  }catch(error){
    console.warn('Primary Korean translation unavailable; trying fallback:',error);
    try{const result=await translateWithMyMemory(source,target);if(result){writeTranslationCache(cacheKey,result);return result;}}
    catch(fallbackError){console.warn('Fallback translation unavailable:',fallbackError);}
    return null;
  }
}
function cachedTranslation(source,target='ko'){
  // Kept only for backwards compatibility with old saved search text; not used to translate display names.
  const cache=readTranslationCache();const item=cache[hashText(`${target}|${String(source||'').trim()}`)];
  return item&&Date.now()-item.savedAt<30*24*60*60*1000?item.value:null;
}
async function localizeMarked(root=document){
  // Proper names and descriptive metadata are not machine-translated. Keep the original form
  // unless an actual Korean alias/official localized record exists in the source databases.
  if(!root?.querySelectorAll)return;
  root.querySelectorAll('[data-localize-text]').forEach(node=>{node.dataset.localized='original';});
}
async function translateDescriptionNode(node,source){
  // Deliberately disabled: a machine-translated synopsis is not treated as Korean catalogue data.
  if(!node)return;node.dataset.translationStatus='original';node.textContent=cleanDescription(source||node.textContent);
}
function localizedNameMarkup(name,extraClass=''){
  const value=String(name||'이름 정보 없음');return `<span class="${extraClass}">${esc(value)}</span>`;
}
function readKoreanMetadataCache(){try{const value=JSON.parse(localStorage.getItem(KOREAN_METADATA_CACHE_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}}
function koreanMetadataKeys(media){return [media?.id!=null?String(media.id):null,media?.idMal?`mal:${media.idMal}`:null].filter(Boolean);}
function cachedKoreanMetadata(media){const cache=readKoreanMetadataCache();for(const key of koreanMetadataKeys(media)){const entry=cache[key];if(entry){const partial=!!entry.title!==!!entry.overview;const ttl=entry.missing?7:partial?21:90;if(Date.now()-Number(entry.savedAt||0)<ttl*86400000)return entry;}}return null;}
function writeKoreanMetadata(media,value){try{const cache=readKoreanMetadataCache();for(const key of koreanMetadataKeys(media))cache[key]={...value,savedAt:Date.now()};const entries=Object.entries(cache).sort((a,b)=>(b[1]?.savedAt||0)-(a[1]?.savedAt||0)).slice(0,500);localStorage.setItem(KOREAN_METADATA_CACHE_KEY,JSON.stringify(Object.fromEntries(entries)));}catch(error){console.warn('Korean metadata cache save skipped:',error);}}
// 수동 한국어 카탈로그(v4.6): data/korean-catalog.json 에서 관리합니다.
// 수정 후 `py tools/build_korean_catalog.py`로 data/korean-catalog.js를 다시 생성하세요.
// 기존 호출부와 호환되도록 {title, overview, source, url} 형태를 그대로 반환합니다.
const curatedKoreanOverride = findKoreanCatalogRecord;

function koreanAliasQuality(value){
  const text=String(value||'').trim();let score=0;
  if(text.length>=4&&text.length<=28)score+=5;
  else if(text.length<=36)score+=2;
  else score-=3;
  if(/[가-힣]/.test(text))score+=4;
  if(/(?:\s|^)(?:시즌\s*\d+|\d+기|파트\s*\d+|Part\s*\d+)$/i.test(text))score-=2;
  if(/^(?:극장판|OVA|OAD|스페셜)\s/.test(text))score-=2;
  if(/[\[\]【】]/.test(text))score-=1;
  if(text.length<=3)score-=3;
  return score;
}
function bestKoreanAlias(values){
  const unique=[...new Set((values||[]).map(cleanKoreanAlias).filter(Boolean))];
  return unique.sort((a,b)=>koreanAliasQuality(b)-koreanAliasQuality(a)||b.length-a.length)[0]||null;
}
function koreanAniListSynonym(media){return bestKoreanAlias(media?.synonyms||[]);}

function tmdbKoreanSourceLabel(country){
  if(country==='KR')return 'TMDB 대한민국 등록 번역';
  if(country)return `TMDB 한국어 등록 번역 (${country})`;
  return 'TMDB 한국어 등록 번역';
}
function koreanTitleInfo(media){
  const curated=curatedKoreanOverride(media);if(curated?.title)return {title:curated.title,source:curated.source,url:curated.url,kind:'curated'};
  const user=getUserKorean(media);if(user?.title)return {title:user.title,source:user.source,url:user.url,kind:'user'};
  const db=lookupKoreanTitle(media);if(db?.title)return db;
  const cached=cachedKoreanMetadata(media);
  const directKind=cached?.kind==='namu'||cached?.source==='나무위키'?'namu':cached?.kind==='wiki'?'wiki':null;
  if(cached?.title&&!directKind)return {title:cached.title,source:cached.source&&!/^TMDB/i.test(cached.source)?cached.source:tmdbKoreanSourceLabel(cached.titleCountry||cached.translationCountry),url:cached.url,kind:'tmdb'};
  const ani=koreanAniListSynonym(media);if(ani)return {title:ani,source:'AniList 한글 별칭',url:media?.siteUrl||'https://anilist.co',kind:'anilist'};
  const jikan=cachedKoreanAlias(media);if(jikan?.titles?.length)return {title:jikan.titles[0],source:'MyAnimeList 대체 제목',url:jikan.url,kind:'jikan'};
  if(cached?.title&&directKind)return {title:cached.title,source:cached.source||(directKind==='wiki'?'한국어 위키백과':'나무위키'),url:cached.url||'',kind:directKind};
  return {title:titleOf(media),source:'원제',url:media?.siteUrl||'',kind:'original'};
}
function koreanDescriptionInfo(media){
  const curated=curatedKoreanOverride(media);if(curated?.overview)return {overview:curated.overview,source:curated.source,url:curated.url,kind:'curated'};
  const user=getUserKorean(media);if(user?.overview)return {overview:user.overview,source:user.source,url:user.url,kind:'user'};
  const db=lookupKoreanTitle(media);if(db?.overview)return {overview:db.overview,source:db.source,url:db.url,kind:db.kind};
  const cached=cachedKoreanMetadata(media);
  const directKind=cached?.kind==='namu'||cached?.source==='나무위키'?'namu':cached?.kind==='wiki'?'wiki':null;
  if(cached?.overview&&!directKind&&isMostlyKorean(cached.overview))return {overview:cached.overview,source:cached.source&&!/^TMDB/i.test(cached.source)?cached.source:tmdbKoreanSourceLabel(cached.overviewCountry||cached.translationCountry),url:cached.url,kind:'tmdb'};
  const jikan=cachedKoreanAlias(media);if(jikan?.overview&&isMostlyKorean(jikan.overview))return {overview:jikan.overview,source:'MyAnimeList 한국어 소개',url:jikan.url,kind:'jikan'};
  if(cached?.overview&&directKind&&isMostlyKorean(cached.overview))return {overview:cached.overview,source:cached.source||(directKind==='wiki'?'한국어 위키백과':'나무위키'),url:cached.url||'',kind:directKind};
  return null;
}
function localizedTitle(media){return koreanTitleInfo(media).title;}
function localizedDescription(media){return koreanDescriptionInfo(media)?.overview||'';}
function koreanMetadataSourceMarkup(media){
  const titleInfo=koreanTitleInfo(media),descInfo=koreanDescriptionInfo(media);
  const link=(info)=>info?.url?`<a href="${esc(info.url)}" target="_blank" rel="noopener" class="text-link">${esc(info.source)} 출처 ↗</a>`:esc(info?.source||'확인되지 않음');
  const titleLine=`제목: ${link(titleInfo)}`;
  const descLabel=descInfo?.kind==='curated'?'소개(국내 카탈로그 바탕 요약)': '소개';
  const descLine=descInfo?`${descLabel}: ${link(descInfo)}`:'소개: 한국어 등록 자료 없음 · 원문 표시';
  const note=titleInfo.kind==='original'?'한국어 제목을 확인하지 못해 원제를 유지합니다.':titleInfo.kind==='anilist'||titleInfo.kind==='jikan'?'커뮤니티 별칭 데이터이며 국내 유통사의 표기와 다를 수 있습니다.':titleInfo.kind==='tmdb'?'TMDB에 등록된 한국어 번역입니다. 국내 판권사의 최종 표기와 다를 수 있습니다.':titleInfo.kind==='user'?'사용자가 직접 입력한 한국어 자료입니다. 공식 표기와 다를 수 있습니다.':titleInfo.kind==='namu'?'나무위키 문서에서 확인한 표기입니다. 문서 표기와 다를 수 있습니다.':titleInfo.kind==='wiki'?'한국어 위키백과 문서에서 확인한 표기입니다. 문서 표기와 다를 수 있습니다.':'국내 플랫폼 카탈로그를 확인해 제목을 정리했습니다.';
  return `${titleLine}<br>${descLine}${note?`<br><small>${esc(note)}</small>`:''}${!tmdbToken()?'<br><small>TMDB 연결을 설정하면 추가 한국어 현지화 정보를 확인할 수 있습니다.</small>':''}`;
}
function mediaKey(media){return media?.id==null?'':String(media.id);}
function knownMedia(id){
  const key=String(id);return state.mediaIndex.get(key)||[...state.results,...state.lastAiring,...state.homeMedia,...state.movieMedia,...state.recommendedMedia].find(x=>String(x.id)===key)||state.watchlist.find(x=>String(x.media_id)===key)?.media_snapshot||state.collections.flatMap(c=>c.items||[]).find(x=>String(x.id)===key)||null;
}

function compactMediaSnapshot(media){
  const m=media||{};
  return {
    id:m.id,idMal:m.idMal||m.mal_id||null,mal_id:m.mal_id||null,
    title:m.title||{userPreferred:titleOf(m)},synonyms:Array.isArray(m.synonyms)?m.synonyms:[],
    coverImage:m.coverImage||{extraLarge:posterOf(m)},bannerImage:m.bannerImage||null,
    format:m.format||m.type||null,status:m.status||null,episodes:m.episodes??null,duration:m.duration??null,
    season:m.season||null,seasonYear:m.seasonYear||m.year||null,countryOfOrigin:m.countryOfOrigin||null,
    startDate:m.startDate||null,endDate:m.endDate||null,averageScore:m.averageScore??(m.score?Math.round(m.score*10):null),
    popularity:m.popularity||m.members||0,favourites:m.favourites||m.favorites||0,
    genres:Array.isArray(m.genres)?m.genres:[],studios:{nodes:(m.studios?.nodes||m.studios||[]).map(x=>({id:x.id||null,name:x.name})).filter(x=>x.name)},
    siteUrl:m.siteUrl||m.url||'',description:cleanDescription(m.description||m.synopsis||'').slice(0,1400)
  };
}
function localizedTitleSource(media){
  const title=media?.title||{};
  return title.english||title.romaji||title.userPreferred||title.native||'제목 정보 없음';
}
function localRole(value){
  const key=String(value||'').toUpperCase();
  const known={MAIN:'주연',SUPPORTING:'조연',BACKGROUND:'단역','ORIGINAL CREATOR':'원작','ORIGINAL STORY':'원작','DIRECTOR':'감독','CHIEF DIRECTOR':'총감독','ASSISTANT DIRECTOR':'조감독','SERIES COMPOSITION':'시리즈 구성','SCRIPT':'각본','SCREENPLAY':'각본','CHARACTER DESIGN':'캐릭터 디자인','ORIGINAL CHARACTER DESIGN':'원안 캐릭터 디자인','MUSIC':'음악','SOUND DIRECTOR':'음향 감독','ART DIRECTOR':'미술 감독','ANIMATION DIRECTOR':'작화 감독','CHIEF ANIMATION DIRECTOR':'총작화 감독','EPISODE DIRECTOR':'에피소드 감독','STORYBOARD':'콘티','STORYBOARDING':'콘티','KEY ANIMATION':'원화','SECOND KEY ANIMATION':'제2원화','COLOR DESIGN':'색채 설계','BACKGROUND ART':'배경 미술','DIRECTOR OF PHOTOGRAPHY':'촬영 감독','EDITOR':'편집','PRODUCER':'프로듀서','EXECUTIVE PRODUCER':'총괄 프로듀서','PLANNING':'기획','PRODUCTION':'제작','ANIMATION PRODUCTION':'애니메이션 제작','THEME SONG PERFORMANCE':'주제가 노래','THEME SONG LYRICS':'주제가 작사','THEME SONG COMPOSITION':'주제가 작곡','THEME SONG ARRANGEMENT':'주제가 편곡','CASTING':'캐스팅'};
  return known[key]||value||'역할 정보 없음';
}
async function jikanAnimeSearch(query,sort='POPULARITY_DESC'){
  const orderMap={POPULARITY_DESC:'popularity',START_DATE_DESC:'start_date',SCORE_DESC:'score',TRENDING_DESC:'popularity',FAVOURITES_DESC:'favorites'};
  const order=orderMap[sort]||'popularity';
  const data=await jikan(`/anime?q=${encodeURIComponent(query)}&limit=24&order_by=${order}&sort=desc`);
  return (data.data||[]).map(mapJikanAnime);
}
function filterJikanResults(items,filters={}){
  return (items||[]).filter(m=>{
    if(filters.status&&m.status!==filters.status)return false;
    if(filters.format&&m.format!==filters.format)return false;
    const year=Number(m.seasonYear||m.startDate?.year||0);
    if(filters.yearFrom&&(!year||year<Number(filters.yearFrom)))return false;
    if(filters.yearTo&&(!year||year>Number(filters.yearTo)))return false;
    if(filters.episodeMin&&(!m.episodes||m.episodes<Number(filters.episodeMin)))return false;
    if(filters.episodeMax&&(!m.episodes||m.episodes>Number(filters.episodeMax)))return false;
    const score=scoreOf(m);
    if(filters.scoreMin&&(score==null||score<Number(filters.scoreMin)*10))return false;
    if(filters.scoreMax&&(score==null||score>Number(filters.scoreMax)*10))return false;
    if(filters.genres?.length&&!filters.genres.some(g=>(m.genres||[]).includes(g)))return false;
    return true;
  });
}
function animeQuery(){
  return `query AnimeList(
    $page:Int!, $perPage:Int!, $search:String,
    $formats:[MediaFormat], $genres:[String], $status:MediaStatus,
    $startGreater:FuzzyDateInt, $startLesser:FuzzyDateInt,
    $countries:[CountryCode], $minScore:Int, $maxScore:Int,
    $episodeGreater:Int, $episodeLesser:Int, $sort:[MediaSort]
  ) {
    Page(page:$page,perPage:$perPage) {
      pageInfo { currentPage hasNextPage total }
      media(
        type:ANIME, isAdult:false, search:$search,
        format_in:$formats, genre_in:$genres, status:$status,
        startDate_greater:$startGreater, startDate_lesser:$startLesser,
        countryOfOrigin_in:$countries, averageScore_greater:$minScore, averageScore_lesser:$maxScore,
        episodes_greater:$episodeGreater, episodes_lesser:$episodeLesser, sort:$sort
      ) { ${LIST_MEDIA_FIELDS} }
    }
  }`;
}
async function fetchAnimeList(filters={}){
  const variables={
    page:filters.page||1,
    perPage:Math.min(filters.perPage||24,50),
    search:filters.search||null,
    formats:filters.formats?.length?filters.formats:null,
    genres:filters.genres?.length?filters.genres:null,
    status:filters.status||null,
    startGreater:filters.startGreater??null,
    startLesser:filters.startLesser??null,
    countries:filters.countries?.length?filters.countries:null,
    minScore:filters.minScore==null?null:filters.minScore,
    maxScore:filters.maxScore==null?null:filters.maxScore,
    episodeGreater:filters.episodeGreater==null?null:filters.episodeGreater,
    episodeLesser:filters.episodeLesser==null?null:filters.episodeLesser,
    sort:filters.sort||['POPULARITY_DESC']
  };
  return anilist(animeQuery(),variables, {forceRefresh:filters.forceRefresh===true}).then(d=>d.Page);
}

async function fetchAnimeListSimple({page=1,perPage=50,search='',sort=['POPULARITY_DESC'],forceRefresh=false}={}){
  const q=`query AnimeListFallback($page:Int!,$perPage:Int!,$search:String,$sort:[MediaSort]){Page(page:$page,perPage:$perPage){pageInfo{currentPage hasNextPage total} media(type:ANIME,isAdult:false,search:$search,sort:$sort){${LIST_MEDIA_FIELDS}}}}`;
  const data=await anilist(q,{page,perPage:Math.min(perPage,50),search:search||null,sort},{forceRefresh});
  return data.Page;
}
function filterClientMedia(items,f={}){
  return (items||[]).filter(m=>{
    if(f.status&&m.status!==f.status)return false;
    if(f.format&&m.format!==f.format)return false;
    if(f.country&&m.countryOfOrigin!==f.country)return false;
    const year=Number(m.seasonYear||m.startDate?.year||0);
    if(f.yearFrom&&(!year||year<Number(f.yearFrom)))return false;
    if(f.yearTo&&(!year||year>Number(f.yearTo)))return false;
    if(f.episodeMin&&(!m.episodes||m.episodes<Number(f.episodeMin)))return false;
    if(f.episodeMax&&(!m.episodes||m.episodes>Number(f.episodeMax)))return false;
    const score=scoreOf(m);
    if(f.scoreMin&&(score==null||score<Number(f.scoreMin)*10))return false;
    if(f.scoreMax&&(score==null||score>Number(f.scoreMax)*10))return false;
    if(f.genres?.length&&!f.genres.some(g=>(m.genres||[]).includes(g)))return false;
    return true;
  });
}

function cardMarkup(m, showActions=false, recommendation=false){
  const poster=posterOf(m); const score=scoreOf(m); const sourceTitle=titleOf(m); const title=localizedTitle(m);
  const status=state.watchlist.find(x=>String(x.media_id)===String(m.id) || (m.idMal && x.idMal===m.idMal));
  const id=m.id ?? `mal:${m.mal_id}`;
  state.mediaIndex.set(String(id),m);
  return `<article class="anime-card" data-open="${esc(id)}" tabindex="0" role="button" aria-label="${esc(sourceTitle)} 상세 정보">
    <div class="poster-wrap">${poster?`<img class="poster" src="${esc(poster)}" alt="${esc(title)} 포스터" loading="lazy" decoding="async" onerror="this.style.display='none'">`:`<div class="poster-placeholder">✦</div>`}<div class="poster-gradient"></div>${score?`<span class="poster-score">★ ${esc((score/10).toFixed(1))}</span>`:''}<span class="poster-format">${esc(formatOf(m))}</span><span class="poster-year">${esc(yearOf(m))}</span></div>
    <div class="card-title">${esc(title)}</div><div class="card-meta">${esc((m.genres||[]).slice(0,2).map(g=>GENRE_LABELS[g]||g).join(' · ') || statusOf(m.status))}</div>${recommendation?`<div class="recommendation-match"><b>취향 적합도 ${Math.round(m._recommendScore||0)}점</b><span>${esc((m._recommendReasons||[]).join(' · ')||'평점과 인기도를 함께 고려했습니다.')}</span></div>`:''}
    ${showActions?`<div class="card-actions"><button class="mini-action" data-open="${esc(id)}">상세 정보</button>${status?`<span class="mini-action">${esc(STATUSES.find(s=>s[0]===status.status)?.[1]||'보관 중')}</span>`:`<button class="mini-action" data-add="${esc(id)}">＋ 담기</button>`}</div>`:''}
  </article>`;
}

function sectionHead(title,kicker='',action=''){return `<div class="section-head"><div>${kicker?`<div class="section-kicker">${esc(kicker)}</div>`:''}<h2 class="section-title">${esc(title)}</h2></div>${action?`<button class="text-link" data-route="${esc(action)}">전체 보기 ↗</button>`:''}</div>`;}
async function hydrateKoreanCardTitles(items,root,maxItems=8){
  if(!Array.isArray(items)||!items.length||!root)return;
  const unique=[...new Map(items.filter(m=>m?.id!=null).map(m=>[String(m.id),m])).values()];
  const pending=unique.filter(m=>!curatedKoreanOverride(m)&&!koreanAniListSynonym(m)&&(!cachedKoreanAlias(m)||tmdbToken()&&!cachedKoreanMetadata(m))).slice(0,maxItems);
  if(pending.length)await enrichKoreanMetadata(pending,2);
  // 한국어 소스 조회 (v4.7+): 나무위키 → AI 보조 재검색 → 한국어 위키백과
  const sourcePending=unique.filter(m=>!curatedKoreanOverride(m)&&!getUserKorean(m)&&!koreanAniListSynonym(m)&&!cachedKoreanMetadata(m)?.title&&(!cachedKoreanAlias(m)||tmdbToken()&&!cachedKoreanMetadata(m))).slice(0,maxItems);
  for(const m of sourcePending){
    try{
      const nativeTitle=m?.title?.native||m?.title?.romaji||m?.title?.english;
      const found=await lookupKoreanFallback(nativeTitle);
      if(found?.title){
        writeKoreanMetadata(m,{title:found.title,overview:found.overview||'',source:found.source,kind:found.kind,titleCountry:'KR',missing:false,url:found.url||''});
        const card=$$('.anime-card,.schedule-row',root).find(node=>String(node.dataset.open)===String(m.id));
        const titleNode=card?.querySelector('.card-title,.schedule-name');
        if(titleNode)titleNode.textContent=found.title;
      }
    }catch(error){}
  }
  if(!root.isConnected)return;
  for(const media of unique){
    const title=localizedTitle(media);
    const card=$$('.anime-card,.schedule-row',root).find(node=>String(node.dataset.open)===String(media.id));
    const titleNode=card?.querySelector('.card-title,.schedule-name');if(titleNode&&title)titleNode.textContent=title;
  }
}
function gridMarkup(items, showActions=false, recommendation=false){return items?.length?`<div class="anime-grid ${recommendation?'recommendation-grid':''}">${items.map(m=>cardMarkup(m,showActions,recommendation)).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">🔍⌕</div><strong>표시할 작품이 없습니다.</strong><span>검색어나 필터 조건을 바꿔 다시 시도해 보세요.</span></div>`;}

async function renderHome(){
  const main=$('#main-content');
  main.innerHTML=`<section class="welcome-skeleton"><div class="skeleton wide"></div><div class="skeleton row"></div><div class="skeleton cards"></div></section>`;
  const yr=new Date().getFullYear(), season=currentSeason();
  try{
    const query=`query Home($season:MediaSeason!,$year:Int!){trending:Page(page:1,perPage:10){media(type:ANIME,isAdult:false,sort:[TRENDING_DESC]){${LIST_MEDIA_FIELDS}}} seasonal:Page(page:1,perPage:10){media(type:ANIME,isAdult:false,season:$season,seasonYear:$year,sort:[POPULARITY_DESC]){${LIST_MEDIA_FIELDS}}} movies:Page(page:1,perPage:5){media(type:ANIME,isAdult:false,format:MOVIE,sort:[POPULARITY_DESC]){${LIST_MEDIA_FIELDS}}}}`;
    const data=await anilist(query,{season,year:yr});
    const trending=data.trending.media, seasonal=data.seasonal.media, movies=data.movies.media;
    state.homeMedia=[...trending,...seasonal,...movies];
    const featured=trending[0]||seasonal[0];
    main.innerHTML=`<section class="hero">${featured?.bannerImage?`<img class="hero-image" src="${esc(featured.bannerImage)}" alt="" loading="eager" fetchpriority="high" decoding="async" onerror="this.remove()">`:''}<div class="hero-copy"><span class="hero-tag">애니메이션 통합 정보 · ${yr}</span><h1>애니메이션의 모든 순간,<br>한곳에서 발견하다.</h1><p>새로운 작품을 찾고, 방영 일정을 확인하고, 나만의 시청 기록을 관리하세요. 전 세계 애니메이션 데이터베이스를 한 화면에 모았습니다.</p><button class="primary-button" data-route="browse">애니메이션 탐색하기 →</button></div></section>
      <section class="section">${sectionHead('지금 주목받는 작품','실시간 인기','browse')}${gridMarkup(trending.slice(0,5))}</section>
      <section class="section">${sectionHead(`${yr}년 ${seasonLabel(season)} 시즌 신작`,'이번 시즌','airing')}${gridMarkup(seasonal.slice(0,5))}</section>
      <section class="feature-strip"><div class="feature-tile"><span class="feature-icon">◷</span><div><b>방영 일정</b><small>요일별 최신 방영작 확인</small></div></div><div class="feature-tile"><span class="feature-icon">♡</span><div><b>나만의 보관함</b><small>시청 상태와 평점 관리</small></div></div><div class="feature-tile"><span class="feature-icon">⌕</span><div><b>인물·제작진 탐색</b><small>성우와 제작사로 작품 찾기</small></div></div></section>
      <section class="section">${sectionHead('인기 극장판','추천 영화','movies')}${gridMarkup(movies.slice(0,5))}</section>
      ${state.recentViews?.length?`<section class="section">${sectionHead('최근 본 작품','최근에 연 작품','browse')}${gridMarkup(state.recentViews.slice(0,5).map(v=>knownMedia(v.id)||v))}</section>`:''}
      <p class="source-footnote">작품·이미지·평점 정보: AniList API. 개인 평점 및 일부 상세 정보: Jikan API. 원본 데이터의 표기와 갱신 시점은 각 제공처에 따릅니다.</p>`;
    localizeMarked(main);hydrateKoreanCardTitles(state.homeMedia,main,10);
  }catch(error){main.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍!</div><strong>홈 데이터를 불러오지 못했습니다.</strong><span>${esc(error.message)}</span><br><button class="ghost-button" data-retry="home">다시 시도</button></div>`;}
}

function pageHead(title,sub,kicker='탐색'){const source=String(title||'');Promise.resolve().then(()=>localizeMarked($('#main-content')));return `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1 class="page-title" data-localize-text="${esc(source)}">${esc(source)}</h1><p class="page-subtitle">${esc(sub)}</p></div></div>`;}
const GENRE_LABELS={
  Action:'액션',Adventure:'모험',Comedy:'코미디',Drama:'드라마',Fantasy:'판타지',Horror:'공포',
  'Mahou Shoujo':'마법소녀',Mecha:'메카',Music:'음악',Mystery:'미스터리',Psychological:'심리',
  Romance:'로맨스','Sci-Fi':'SF','Slice of Life':'일상',Sports:'스포츠',Supernatural:'초자연',Thriller:'스릴러'
};
const RELEASE_FILTERS=[
  ['', '전체'],['FINISHED','완결·방영 완료'],['RELEASING','방영 중'],['NOT_YET_RELEASED','방영 예정'],['CANCELLED','취소'],['HIATUS','중단']
];
const SORT_OPTIONS=[
  ['POPULARITY_DESC','인기순'],['START_DATE_DESC','최신 방영순'],['SCORE_DESC','평점순'],
  ['TRENDING_DESC','최근 화제순'],['FAVOURITES_DESC','즐겨찾기순']
];
const COUNTRY_OPTIONS=[['','전체 국가'],['JP','일본'],['KR','한국'],['CN','중국'],['TW','대만']];
function selectedAttr(a,b){return String(a??'')===String(b??'')?'selected':'';}
function filterMarkup(){
  const f={...defaultFilters(),...state.filters};
  const years=Array.from({length:new Date().getFullYear()-1959},(_,i)=>new Date().getFullYear()-i);
  const savedOptions=state.savedSearches.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  return `<div class="browse-tools">
    <div class="quick-filter-head"><div><span class="section-kicker">빠른 필터</span><strong>작품 상태</strong></div><div class="quick-filter-row">${RELEASE_FILTERS.map(([v,l])=>`<button type="button" class="quick-filter ${String(f.status||'')===v?'active':''}" data-quick-status="${v}">${l}</button>`).join('')}</div></div>
    <div class="filter-panel filter-panel-v2">
      <label class="filter-field search-field"><span>작품 검색</span><input id="filter-search" type="search" placeholder="작품명 검색 (한국어·영어·일본어)" value="${esc(state.query)}"></label>
      <label class="filter-field"><span>작품 형식</span><select id="filter-format"><option value="">모든 형식</option>${FORMATS.map(([v,l])=>`<option value="${v}" ${selectedAttr(f.format,v)}>${l}</option>`).join('')}</select></label>
      <label class="filter-field"><span>국가</span><select id="filter-country">${COUNTRY_OPTIONS.map(([v,l])=>`<option value="${v}" ${selectedAttr(f.country,v)}>${l}</option>`).join('')}</select></label>
      <label class="filter-field"><span>정렬 기준</span><select id="filter-sort">${SORT_OPTIONS.map(([v,l])=>`<option value="${v}" ${selectedAttr(f.sort||'POPULARITY_DESC',v)}>${l}</option>`).join('')}</select></label>
      <div class="filter-field year-field"><span>방영 시작 연도</span><div class="year-range"><select id="filter-year-from"><option value="">시작 연도</option>${years.map(y=>`<option value="${y}" ${selectedAttr(f.yearFrom,y)}>${y}년</option>`).join('')}</select><span>~</span><select id="filter-year-to"><option value="">종료 연도</option>${years.map(y=>`<option value="${y}" ${selectedAttr(f.yearTo,y)}>${y}년</option>`).join('')}</select></div></div>
      <div class="filter-field"><span>화수 범위 <small>TV·시리즈 작품 기준</small></span><div class="year-range"><input id="filter-episode-min" type="number" min="1" max="999" step="1" placeholder="최소" value="${esc(f.episodeMin)}"><span>~</span><input id="filter-episode-max" type="number" min="1" max="999" step="1" placeholder="최대" value="${esc(f.episodeMax)}"></div></div>
      <div class="filter-field"><span>평점 범위 <small>AniList 기준 · 10점 만점</small></span><div class="year-range"><select id="filter-score-min"><option value="">최저 제한 없음</option>${[5,6,7,8,9].map(v=>`<option value="${v}" ${selectedAttr(f.scoreMin,v)}>${v}.0 이상</option>`).join('')}</select><span>~</span><select id="filter-score-max"><option value="">최고 제한 없음</option>${[5,6,7,8,9,10].map(v=>`<option value="${v}" ${selectedAttr(f.scoreMax,v)}>${v}.0 이하</option>`).join('')}</select></div></div>
      <div class="filter-field genre-field"><span>장르 <small>여러 개 선택 가능 · 선택한 장르 중 하나 이상 포함</small></span><div class="genre-options">${GENRES.map(g=>`<button type="button" class="genre-toggle ${(f.genres||[]).includes(g)?'active':''}" data-genre="${esc(g)}" aria-pressed="${(f.genres||[]).includes(g)}">${esc(GENRE_LABELS[g]||g)}</button>`).join('')}</div></div>
      <div class="filter-footer"><span id="filter-active-count">필터 ${activeFilterCount(f)}개 적용 중</span><div><button type="button" class="ghost-button" id="reset-filters">초기화</button><button type="button" class="primary-button" id="apply-filters">필터 적용</button></div></div>
    </div>
    <div class="saved-search-panel"><div class="saved-search-label"><b>저장한 검색 조건</b><small>자주 쓰는 필터 조합을 저장해 다시 불러올 수 있습니다.</small></div><select id="saved-search-select"><option value="">저장된 조건 선택</option>${savedOptions}</select><div class="saved-search-actions"><button type="button" class="ghost-button" id="load-saved-search" ${state.savedSearches.length?'':'disabled'}>불러오기</button><button type="button" class="ghost-button" id="delete-saved-search" ${state.savedSearches.length?'':'disabled'}>삭제</button><button type="button" class="secondary-button" id="save-search">현재 조건 저장</button></div></div>
  </div>`;
}
function activeFilterCount(f){return [f.status,f.format,f.country,f.yearFrom,f.yearTo,f.episodeMin,f.episodeMax,f.scoreMin,f.scoreMax].filter(Boolean).length+(f.genres||[]).length+(state.query?1:0);}
function yearBounds(from,to){
  const a=from?Number(from):null,b=to?Number(to):null;
  return {startGreater:a?(a*10000-1):null,startLesser:b?((b+1)*10000):null};
}
function readBrowseFilters(){
  const from=$('#filter-year-from')?.value||'',to=$('#filter-year-to')?.value||'';
  const episodeMin=$('#filter-episode-min')?.value||'',episodeMax=$('#filter-episode-max')?.value||'';
  const scoreMin=$('#filter-score-min')?.value||'',scoreMax=$('#filter-score-max')?.value||'';
  if(from&&to&&Number(from)>Number(to)){toast('시작 연도는 종료 연도보다 늦을 수 없습니다.','error');return null;}
  if(episodeMin&&episodeMax&&Number(episodeMin)>Number(episodeMax)){toast('최소 화수는 최대 화수보다 클 수 없습니다.','error');return null;}
  if(episodeMin&&Number(episodeMin)<1||episodeMax&&Number(episodeMax)<1){toast('화수는 1 이상 입력해 주세요.','error');return null;}
  if(scoreMin&&scoreMax&&Number(scoreMin)>Number(scoreMax)){toast('최저 평점은 최고 평점보다 클 수 없습니다.','error');return null;}
  const range=yearBounds(from,to);
  return {
    status:state.filters.status||'',format:$('#filter-format')?.value||'',country:$('#filter-country')?.value||'',
    yearFrom:from,yearTo:to,episodeMin,episodeMax,scoreMin,scoreMax,
    genres:[...(state.filters.genres||[])],sort:$('#filter-sort')?.value||'POPULARITY_DESC',...range
  };
}
function renderBrowseShell(){
  const main=$('#main-content');
  main.innerHTML=`${pageHead('전체 애니메이션','완결 여부부터 장르·연도·화수·평점까지 조합해 원하는 작품을 찾아보세요.','애니메이션 탐색')}<div class="browse-content">${filterMarkup()}<div id="browse-results"></div></div>`;
}
async function renderBrowse(){renderBrowseShell();await runBrowseSearch(1,false);}
function saveCurrentSearch(){
  const filters=readBrowseFilters();if(!filters)return;
  const query=$('#filter-search')?.value.trim()||'';
  const defaultName=[filters.status==='FINISHED'?'완결':null,filters.genres?.length?filters.genres.map(g=>GENRE_LABELS[g]||g).join('·'):null,filters.yearFrom||filters.yearTo?`${filters.yearFrom||'전체'}-${filters.yearTo||'현재'}`:null].filter(Boolean).join(' / ')||'내 검색 조건';
  const name=prompt('저장할 검색 조건의 이름을 입력해 주세요.',defaultName);
  if(name===null)return;
  if(!name.trim()){toast('검색 조건 이름을 입력해 주세요.','error');return;}
  const id=`s${Date.now()}${Math.random().toString(36).slice(2,6)}`;
  state.filters={...filters,genres:[...(filters.genres||[])]};state.query=query;$('#global-search').value=query;
  state.savedSearches.unshift({id,name:name.trim().slice(0,40),query,filters:{...filters,genres:[...(filters.genres||[])]},savedAt:new Date().toISOString()});
  state.savedSearches=state.savedSearches.slice(0,30);saveSavedSearches();renderBrowse();toast('검색 조건을 저장했습니다.');
}
function loadSavedSearch(){
  const id=$('#saved-search-select')?.value;const item=state.savedSearches.find(x=>x.id===id);
  if(!item){toast('불러올 검색 조건을 선택해 주세요.','error');return;}
  state.filters={...defaultFilters(),...item.filters,genres:[...(item.filters.genres||[])]};state.query=item.query||'';$('#global-search').value=state.query;renderBrowse();
}
function deleteSavedSearch(){
  const id=$('#saved-search-select')?.value;if(!id){toast('삭제할 검색 조건을 선택해 주세요.','error');return;}
  const item=state.savedSearches.find(x=>x.id===id);if(!item||!confirm(`'${item.name}' 검색 조건을 삭제할까요?`))return;
  state.savedSearches=state.savedSearches.filter(x=>x.id!==id);saveSavedSearches();renderBrowse();toast('저장한 검색 조건을 삭제했습니다.');
}
async function runBrowseSearch(page=1,append=false,forceRefresh=false){
  const target=$('#browse-results');if(!target)return;
  if(!append)setLoading(target,'조건에 맞는 작품을 찾고 있습니다.');else $('.load-more',target)?.remove();
  const f={...defaultFilters(),...state.filters};
  const query=state.query.trim();
  const requestFilters={
    page,perPage:24,search:query,formats:f.format?[f.format]:[],genres:f.genres||[],
    status:f.status||null,countries:f.country?[f.country]:[],startGreater:f.startGreater,startLesser:f.startLesser,
    minScore:f.scoreMin?Math.max(0,Number(f.scoreMin)*10-1):null,
    maxScore:f.scoreMax?Math.min(100,Number(f.scoreMax)*10+1):null,
    episodeGreater:f.episodeMin?Math.max(0,Number(f.episodeMin)-1):null,
    episodeLesser:f.episodeMax?Number(f.episodeMax)+1:null,
    sort:[f.sort||'POPULARITY_DESC'],forceRefresh
  };
  let data=null;let fallbackUsed=false;let lastError=null;
  try{
    data=await fetchAnimeList(requestFilters);
  }catch(error){lastError=error;}
  // If the complex filter query fails or returns no matches, retry with a minimal query and apply filters locally.
  if((!data||!data.media?.length)&&query&&hasHangul(query)){
    try{
      const translated=await translateText(query,'en');
      if(translated&&translated.toLowerCase()!==query.toLowerCase()){
        const retry=await fetchAnimeListSimple({page,perPage:50,search:translated,sort:requestFilters.sort,forceRefresh:true});
        const filtered=filterClientMedia(retry.media,f);
        if(filtered.length)data={...retry,media:filtered,total:filtered.length};
      }
    }catch(error){if(!lastError)lastError=error;}
  }
  if((!data||!data.media?.length)&&query){
    try{
      const retry=await fetchAnimeListSimple({page,perPage:50,search:query,sort:requestFilters.sort,forceRefresh:true});
      const filtered=filterClientMedia(retry.media,f);
      if(filtered.length)data={...retry,media:filtered,total:filtered.length};
    }catch(error){if(!lastError)lastError=error;}
  }
  if(!data||data.media?.length===0){
    // 퍼지 검색 폴백: 정확한 매칭이 모두 실패하면 유사한 이름의 작품을 결과로 반환합니다.
    try{
      const retry=await fetchAnimeListSimple({page,perPage:50,sort:requestFilters.sort,forceRefresh:true});
      const pool=retry?.media||[];
      const source=query?fuzzyFilter(pool,query,0.6):pool;
      const filtered=filterClientMedia(source,f);
      if(filtered.length){
        data={...retry,media:filtered,total:filtered.length};fallbackUsed=true;
        if(query)state.lastSearchFuzzy=true;
      }
    }catch(error){if(!lastError)lastError=error;}
  }
  // AniList 우선 조회 후, Jikan 결과는 지원 가능한 필터를 브라우저에서 다시 적용해 보완합니다.
  const hasCountryFilter=!!f.country;
  if((!data||!data.media.length)&&query&&!hasCountryFilter){
    try{
      let found=await jikanAnimeSearch(query,f.sort||'POPULARITY_DESC');
      found=filterJikanResults(found,f);
      if(!found.length&&hasHangul(query)){
        const translated=await translateText(query,'en');
        if(translated&&translated.toLowerCase()!==query.toLowerCase())found=filterJikanResults(await jikanAnimeSearch(translated,f.sort||'POPULARITY_DESC'),f);
      }
      if(found.length){data={media:found,pageInfo:{currentPage:page,hasNextPage:false,total:found.length}};fallbackUsed=true;}
    }catch(error){if(!lastError)lastError=error;}
  }
  if(!data){target.innerHTML=`<div class="empty-state"><strong>검색에 실패했습니다.</strong><span>${esc(lastError?.message||'데이터 제공처에 연결할 수 없습니다.')}</span><br><button class="ghost-button" data-retry="browse">다시 시도</button></div>`;return;}
  if(!data.media.length){target.innerHTML=`<div class="empty-state"><strong>검색 결과가 없습니다.</strong><span>한국어·영어·일본어 제목을 바꾸거나 다른 검색어를 입력해 보세요.</span></div>`;state.results=[];state.hasNext=false;return;}
  state.hasNext=!!data.pageInfo.hasNextPage;state.page=page;state.results=append?[...state.results,...data.media]:data.media;
  const sortLabel=SORT_OPTIONS.find(x=>x[0]===(f.sort||'POPULARITY_DESC'))?.[1]||'인기순';
  const statusLabel=RELEASE_FILTERS.find(x=>x[0]===(f.status||''))?.[1]||'전체';
  const updated=state.staleDataUsed?'저장된 이전 정보 표시':`갱신 확인 ${new Date(state.lastDataUpdated||Date.now()).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`;
  target.innerHTML=`<div class="result-toolbar"><div class="result-info">검색 결과 <b>${Number(data.pageInfo.total||data.media.length).toLocaleString('ko-KR')}</b>개 <span>· ${esc(statusLabel)} · ${esc(sortLabel)}</span><small class="data-update-time">${fallbackUsed?'보조 조회 또는 브라우저 필터 적용':esc(updated)}</small></div><div class="result-toolbar-actions"><span class="result-page">${page}페이지</span><button type="button" class="ghost-button refresh-results" id="refresh-results">↻ 최신 정보 확인</button></div></div>${gridMarkup(state.results,true)}${state.hasNext?`<button class="ghost-button load-more" id="load-more">다음 작품 불러오기 ↓</button>`:''}<p class="source-footnote">방영 상태·평점·인기도·화수는 AniList 기준입니다. 필터 조회 결과가 비어 있으면 단순 조회 후 브라우저에서 조건을 다시 적용하며, 제목 검색은 Jikan으로도 보완합니다. 보조 결과에는 일부 필터와 상세 정보가 제한될 수 있습니다.</p>`;
  localizeMarked(target);hydrateKoreanCardTitles(data.media||[],target,8);
}


function airingTimeZone(){if(state.airingTimeZone==='local')return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Seoul';return state.airingTimeZone||'Asia/Seoul';}
function airingTimeZoneLabel(tz){if(tz==='Asia/Seoul')return 'KST';if(tz==='UTC')return 'UTC';return '로컬';}

async function renderAiring(){
  const main=$('#main-content');main.innerHTML=`${pageHead('방영 일정','앞으로 7일 동안 예정된 회차를 한국 시간(KST) 기준으로 확인합니다.','방영 일정')}<div class="result-toolbar" id="airing-toolbar"><div class="result-info" id="airing-filter-info"></div><div class="result-toolbar-actions"><select id="airing-tz" class="ghost-button"><option value="Asia/Seoul" ${state.airingTimeZone==='Asia/Seoul'?'selected':''}>KST</option><option value="UTC" ${state.airingTimeZone==='UTC'?'selected':''}>UTC</option><option value="local" ${state.airingTimeZone==='local'?'selected':''}>로컬</option></select><button class="ghost-button ${state.airingMineOnly?'active':''}" id="airing-mine-toggle">${state.airingMineOnly?'내 보관함만':'전체 방영 일정'}</button><button class="ghost-button" id="airing-refresh">↻ 새로고침</button></div></div><div id="airing-results"></div>`;
  const target=$('#airing-results');setLoading(target,'방영 예정 회차를 조회하고 있습니다.');
  const now=Math.floor(Date.now()/1000),from=now-60*60,to=now+7*24*60*60;

  // 1) 캐시가 있으면 즉시 표시 (stale-while-revalidate)
  const cached=readAiringCache();
  if(cached?.items?.length){
    state.lastAiring=cached.items.slice().sort((a,b)=>a.nextAiringEpisode.airingAt-b.nextAiringEpisode.airingAt);
    renderAiringList(target,state.lastAiring,cached.source,!isFreshAiringCache(cached),cached.savedAt);
  }

  // 2) 최신 일정 수집 (AniList perPage 50 제한을 보완하기 위해 최대 3페이지)
  let collected=[],firstError=null;
  try{
    for(let page=1;page<=3;page++){
      const q=`query Schedule($page:Int!,$from:Int!,$to:Int!){Page(page:$page,perPage:50){pageInfo{currentPage hasNextPage total} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,notYetAired:true,sort:[TIME]){id airingAt episode media{${SCHEDULE_MEDIA_FIELDS}}}}}`;
      const data=await anilist(q,{page,from,to});
      const rows=data.Page.airingSchedules||[];
      collected=collected.concat(rows);
      if(!rows.length||!data.Page.pageInfo?.hasNextPage)break;
      if(rows[rows.length-1].airingAt>=to)break;
    }
  }catch(error){firstError=error;}

  let items=mergeAiringRows(collected);
  let source='AniList 방영 일정';

  // 3) AniList 전용 일정이 비면 기존 폴백 유지
  if(!items.length){
    try{
      const fallback=await fetchAnimeList({page:1,perPage:50,status:'RELEASING',sort:['POPULARITY_DESC']});
      items=(fallback.media||[]).filter(m=>m.nextAiringEpisode&&m.nextAiringEpisode.airingAt>=now&&m.nextAiringEpisode.airingAt<=to)
        .sort((a,b)=>a.nextAiringEpisode.airingAt-b.nextAiringEpisode.airingAt);
      if(items.length)source='방영 중 작품의 다음 회차';
    }catch(error){if(!firstError)firstError=error;}
  }
  if(!items.length){
    try{
      const weekdays=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      const unique=new Map();let successfulDays=0;
      for(const day of weekdays){
        try{
          const response=await jikan(`/schedules?filter=${day}&sfw=true&limit=25&page=1`);
          successfulDays++;
          for(const item of (response.data||[])){
            const mapped=mapJikanScheduleItem(item);
            if(mapped&&mapped.nextAiringEpisode.airingAt>=now&&mapped.nextAiringEpisode.airingAt<=to&&!unique.has(mapped.id))unique.set(mapped.id,mapped);
          }
        }catch(error){if(!firstError)firstError=error;}
      }
      items=[...unique.values()].sort((a,b)=>a.nextAiringEpisode.airingAt-b.nextAiringEpisode.airingAt);
      if(items.length)source=`Jikan 주간 방송 편성 (${successfulDays}/7일 조회)`;
    }catch(error){if(!firstError)firstError=error;}
  }

  if(!items.length&&firstError&&!cached?.items?.length){
    target.innerHTML=`<div class="empty-state"><strong>방영 일정을 불러오지 못했습니다.</strong><span>${esc(firstError.message)}<br>AniList에 일정이 등록되지 않았거나 API 연결이 일시적으로 제한됐을 수 있습니다.</span><br><button class="ghost-button" data-retry="airing">다시 시도</button></div>`;
    return;
  }
  if(items.length){
    state.airingAllItems=items;
    state.airingSource=source;
    state.lastAiring=items;
    writeAiringCache(items,source);
    writeAiringBaseline(items);
    renderAiringView(target,source,false,Date.now());
  }else if(cached?.items?.length){
    state.airingAllItems=cached.items.slice();
    renderAiringView(target,cached.source,true,cached.savedAt);
  }else{
    target.innerHTML='<div class="empty-state"><strong>앞으로 7일 이내에 등록된 방영 일정이 없습니다.</strong><span>일정이 등록되면 자동으로 여기에 표시됩니다.</span></div>';
  }
}

function renderAiringView(target,source,stale,savedAt){
  let items=(state.airingAllItems||[]).slice();
  if(state.airingMineOnly){const watching=new Set(state.watchlist.filter(x=>x.status==='CURRENT').map(x=>String(x.media_id)));items=items.filter(m=>watching.has(String(m.id)));}
  state.lastAiring=items;
  renderAiringList(target,items,source,stale,savedAt);
}

function renderAiringList(target,items,source,stale,savedAt){
  const groups={};items.forEach(m=>{
    const d=new Date(m.nextAiringEpisode.airingAt*1000);
    const key=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:airingTimeZone()}).format(d);
    (groups[key] ||= []).push(m);
  });
  if(!items.length){
    target.innerHTML='<div class="empty-state"><strong>앞으로 7일 이내에 등록된 방영 일정이 없습니다.</strong><span>일정이 등록되면 자동으로 여기에 표시됩니다.</span></div>';
    return;
  }
  const airingBaseline=readAiringBaseline();
  const daySections=[];
  for(const [day,list] of Object.entries(groups)){
    const rows=list.map(m=>{
      const time=new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:airingTimeZone()}).format(new Date(m.nextAiringEpisode.airingAt*1000));
      const date=new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',timeZone:airingTimeZone()}).format(new Date(m.nextAiringEpisode.airingAt*1000));
      const genres=(m.genres||[]).slice(0,2).map(g=>GENRE_LABELS[g]||g).join(' · ');
      const statusInfo=classifyAiring(m,Date.now()/1000,airingBaseline[String(m.id)]);
      const badgeClass=statusInfo.tone==='warn'?'schedule-badge schedule-badge--warn':statusInfo.tone==='danger'?'schedule-badge schedule-badge--danger':statusInfo.tone==='muted'?'schedule-badge schedule-badge--muted':'schedule-badge';
      const badge=`<span class="${badgeClass}">${esc(statusInfo.label)}</span>`;
      return `<div class="schedule-row" data-open="${esc(m.id)}" role="button" tabindex="0"><div><div class="schedule-time">${time}</div><div class="schedule-day">${date}</div></div><img class="schedule-poster" src="${esc(posterOf(m))}" alt="" loading="lazy"><div><div class="schedule-name">${esc(localizedTitle(m))}</div><div class="schedule-extra">${m.nextAiringEpisode.episode?`${esc(m.nextAiringEpisode.episode)}화`:'정기 편성'} · ${esc(formatOf(m))} · ${esc(genres)}</div></div>${badge}</div>`;
    }).join('');
    daySections.push(`<section class="section">${sectionHead(day,'예정 회차')}<div class="schedule-list">${rows}</div></section>`);
  }
  const staleLabel=stale&&savedAt?` · 저장된 이전 일정 (마지막 갱신 ${new Date(savedAt).toLocaleString('ko-KR')})`:'';
  target.innerHTML=`<div class="result-info">${items.length}개 작품 · ${esc(source)}${esc(staleLabel)} · ${esc(airingTimeZoneLabel(airingTimeZone()))}</div>${daySections.join('')}`;localizeMarked(target);hydrateKoreanCardTitles(items,target,8);
}

async function renderMovies(){
  const main=$('#main-content');main.innerHTML=`${pageHead('극장판 · 애니메이션 영화','TV 시리즈와 구분된 장편 애니메이션 및 영화 작품을 모았습니다.','영화 모음')}<div id="movie-results"></div>`;
  const target=$('#movie-results');setLoading(target,'애니메이션 영화를 불러오고 있습니다.');
  let items=[],label='',aniError=null,jikanError=null;
  try{
    const q=`query MovieArchive($page:Int!,$perPage:Int!){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage total} media(type:ANIME,format:MOVIE,isAdult:false,sort:[POPULARITY_DESC]){${LIST_MEDIA_FIELDS}}}}`;
    const data=await anilist(q,{page:1,perPage:30});items=data.Page?.media||[];if(items.length)label='AniList';
  }catch(error){aniError=error;}
  if(!items.length){
    try{const backup=await jikan('/anime?type=movie&sfw=true&limit=25&order_by=popularity&sort=desc');items=(backup.data||[]).map(mapJikanAnime);if(items.length)label='Jikan 검색 데이터';}
    catch(error){jikanError=error;}
  }
  if(!items.length){
    try{const backup=await jikan('/top/anime?type=movie&limit=25&page=1');items=(backup.data||[]).map(mapJikanAnime);if(items.length)label='Jikan 인기 영화';}
    catch(error){if(!jikanError)jikanError=error;}
  }
  state.movieMedia=items;
  if(items.length){target.innerHTML=`<div class="result-info">인기 애니메이션 영화 ${items.length}개 · ${esc(label)}</div>${gridMarkup(items,true)}`;localizeMarked(target);hydrateKoreanCardTitles(items,target,10);return;}
  const details=[aniError?.message,jikanError?.message].filter(Boolean).map(esc).join('<br>');
  target.innerHTML=`<div class="empty-state"><strong>애니메이션 영화 목록을 가져오지 못했습니다.</strong><span>${details||'두 데이터 제공처 모두 영화 결과를 반환하지 않았습니다.'}</span><br><button class="ghost-button" data-retry="movies">다시 시도</button></div>`;
}


async function renderStudios(){
  const main=$('#main-content');main.innerHTML=`${pageHead('애니메이션 제작사','인기 제작사를 둘러보거나 한국어·영어·일본어 이름으로 검색하세요.','제작사 목록')}<div class="filter-panel" style="grid-template-columns:1fr auto"><input id="studio-search" class="field" placeholder="예: 마파, 교토 애니메이션, MAPPA"><button class="primary-button" id="studio-search-button">검색</button></div><div id="studio-results"></div>`;
  await searchStudios('');
}
function studioQuery(search){
  const selection='{id name favourites isAnimationStudio siteUrl}';
  return search
    ? `query StudioSearch($search:String!){Page(page:1,perPage:30){studios(search:$search,sort:[SEARCH_MATCH])${selection}}}`
    : `query PopularStudios{Page(page:1,perPage:40){studios(sort:[FAVOURITES_DESC])${selection}}}`;
}
async function fetchStudioMatches(search){
  const q=studioQuery(search);const data=await anilist(q,search?{search}:{});
  const records=data.Page?.studios||[];
  return search?records:records.filter(x=>x.isAnimationStudio);
}
function mapJikanProducer(item){
  const title=(Array.isArray(item.titles)?item.titles:[]).find(x=>x.type==='Default')?.title||(Array.isArray(item.titles)?item.titles:[])[0]?.title||item.name||'이름 미상';
  return {id:`mal:${item.mal_id}`,mal_id:item.mal_id,name:title,favourites:item.favorites||0,isAnimationStudio:null,siteUrl:item.url||'',media:{nodes:[]},animeCount:item.count||0};
}
async function jikanProducerSearch(search=''){
  const query=search?`q=${encodeURIComponent(search)}&`:'';
  const data=await jikan(`/producers?${query}limit=25&order_by=count&sort=desc`);
  return (data.data||[]).map(mapJikanProducer).filter(x=>x.name);
}
function renderStudioCards(target,items,search,source='AniList'){
  if(!items.length){target.innerHTML=`<div class="empty-state"><strong>검색 결과가 없습니다.</strong><span>MAPPA, 교토 애니메이션, 토에이 애니메이션 등으로 검색해 보세요.</span></div>`;return;}
  target.innerHTML=`<div class="result-info">${search?'제작사 검색 결과':'인기 애니메이션 제작사'} ${items.length}개 · ${source}</div><div class="studio-grid">${items.map(s=>`<article class="studio-card" data-studio="${s.id}" data-studio-name="${esc(s.name)}"><b data-localize-text="${esc(s.name)}">${esc(s.name)}</b><small>${s.isAnimationStudio===true?'애니메이션 제작사':s.isAnimationStudio===false?'관련 제작·배급 회사':'MyAnimeList 제작사'} · ${Number(s.favourites||0).toLocaleString('ko-KR')}명 즐겨찾기${s.animeCount?` · 참여 작품 ${s.animeCount}개`:''}</small><div class="card-meta" style="margin-top:10px">대표 작품 ${(s.media?.nodes||[]).map(n=>{const title=localizedTitle(n);return title?`<span>${esc(title)}</span>`:'';}).filter(Boolean).join(' · ')||'선택하여 참여 작품 보기'}</div></article>`).join('')}</div>`;
}
async function searchStudios(search){
  const target=$('#studio-results');if(!target)return;setLoading(target,search?'제작사를 검색하고 있습니다.':'인기 제작사를 불러오고 있습니다.');
  let items=[],aniError=null,source='AniList';
  try{items=await fetchStudioMatches(search);}
  catch(error){aniError=error;}
  if(!items.length&&search&&hasHangul(search)){
    const translated=await translateText(search,'en');
    if(translated&&translated.toLowerCase()!==search.toLowerCase()){
      try{items=await fetchStudioMatches(translated);if(items.length)source='AniList · 검색어 변환';}catch(error){if(!aniError)aniError=error;}
    }
  }
  // AniList에 없는 제작사는 공식 Jikan /producers 검색으로 보완합니다.
  if(!items.length){
    try{items=await jikanProducerSearch(search);source='Jikan 제작사 데이터';}
    catch(error){if(!aniError)aniError=error;}
  }
  if(!items.length&&search&&hasHangul(search)){
    const translated=await translateText(search,'en');
    if(translated&&translated.toLowerCase()!==search.toLowerCase()){
      try{items=await jikanProducerSearch(translated);if(items.length)source='Jikan · 검색어 변환';}catch(error){if(!aniError)aniError=error;}
    }
  }
  if(!items.length&&!search){
    try{items=await jikanProducerSearch('');source='Jikan 인기 제작사';}catch(error){if(!aniError)aniError=error;}
  }
  if(items.length){renderStudioCards(target,items,search,source);localizeMarked(target);}
  else if(aniError)target.innerHTML=`<div class="empty-state"><strong>제작사 정보를 불러오지 못했습니다.</strong><span>${esc(aniError.message)}</span><br><button class="ghost-button" data-retry="studios">다시 시도</button></div>`;
  else renderStudioCards(target,[],search,source);
}
async function showStudioWorks(studioId,name){
  const main=$('#main-content');main.innerHTML=`${pageHead(name,'이 제작사가 참여한 작품 목록입니다.','제작사 참여 작품')}<div id="studio-works"></div>`;const target=$('#studio-works');setLoading(target,'제작 작품을 불러오고 있습니다.');
  try{
    if(String(studioId).startsWith('mal:')){
      const producerId=Number(String(studioId).split(':')[1]);const backup=await jikan(`/anime?producers=${producerId}&limit=25&order_by=popularity&sort=desc`);const items=(backup.data||[]).map(mapJikanAnime);
      target.innerHTML=items.length?gridMarkup(items,true):`<div class="empty-state"><strong>등록된 작품이 없습니다.</strong></div>`;localizeMarked(target);hydrateKoreanCardTitles(items,target,8);return;
    }
    const q=`query StudioWorks($id:Int!){Studio(id:$id){id name media(page:1,perPage:30,sort:[POPULARITY_DESC]){pageInfo{hasNextPage}nodes{${LIST_MEDIA_FIELDS}}}}}`;
    const data=await anilist(q,{id:Number(studioId)});const works=data.Studio?.media?.nodes||[];target.innerHTML=gridMarkup(works,true);localizeMarked(target);hydrateKoreanCardTitles(works,target,8);
  }catch(error){target.innerHTML=`<div class="empty-state"><strong>작품 목록을 불러오지 못했습니다.</strong><span>${esc(error.message)}</span></div>`;}
}


async function renderPeople(){
  const main=$('#main-content');main.innerHTML=`${pageHead('성우 · 스태프','성우와 제작진을 검색하고 참여 작품을 찾아봅니다. 작품 상세 페이지에서는 일본어 성우 연결 정보도 확인할 수 있습니다.','인물 정보')}<div class="filter-panel people-filter-panel" style="grid-template-columns:minmax(0,1fr) 190px auto"><input id="people-search" class="field" placeholder="성우·스태프 이름 검색 (한국어·영어·일본어)"><select id="people-mode" class="field"><option value="ALL">전체 인물</option><option value="VOICE">성우 중심</option><option value="DIRECTOR">감독</option><option value="WRITER">각본·구성</option><option value="MUSIC">음악</option><option value="ANIMATION">작화·애니메이션</option></select><button class="primary-button" id="people-search-button">검색</button></div><div id="people-results"><div class="empty-state"><strong>검색할 인물 이름을 입력해 주세요.</strong><span>예: 카지 유우키, Yuki Kaji, 梶裕貴</span></div></div>`;
}
async function searchPeople(search){
  const target=$('#people-results');if(!target||!search.trim())return;setLoading(target,'성우·제작진 정보를 검색하고 있습니다.');
  const mode=$('#people-mode')?.value||'ALL';state.peopleMode=mode;const q=`query People($search:String!){Page(page:1,perPage:40){staff(search:$search,sort:[SEARCH_MATCH]){id name{full native} primaryOccupations image{large} staffMedia(type:ANIME,sort:[POPULARITY_DESC]){nodes{id title{userPreferred} coverImage{large}}} characterMedia(sort:[POPULARITY_DESC]){nodes{id title{userPreferred} coverImage{large}}}}}}}`;
  let people=[],errors=[];const terms=[search];
  if(hasHangul(search)){const translated=await translateText(search,'en');if(translated&&translated.toLowerCase()!==search.toLowerCase())terms.push(translated);}
  for(const term of [...new Set(terms)]){try{const data=await anilist(q,{search:term});people=data.Page?.staff||[];if(mode==='VOICE')people=people.filter(p=>(p.characterMedia?.nodes||[]).length>0);else if(mode!=='ALL'){const terms={DIRECTOR:['director'],WRITER:['writer','screenplay','script'],MUSIC:['music','composer'],ANIMATION:['animation','animator','key animation','character design']}[mode]||[];people=people.filter(p=>(p.primaryOccupations||[]).some(role=>terms.some(t=>role.toLowerCase().includes(t))));}if(people.length)break;}catch(error){errors.push(error.message);}}
  if(people.length){target.innerHTML=`<div class="result-info">인물 검색 결과 ${people.length}명</div><div class="people-grid">${people.map(person=>{const count=new Set([...(person.staffMedia?.nodes||[]),...(person.characterMedia?.nodes||[])].map(m=>m.id)).size;const name=person.name.full;return `<article class="person-card" data-person="${person.id}" data-person-name="${esc(name)}">${person.image?.large?`<img src="${esc(person.image.large)}" alt="">`:`<div class="feature-icon">인</div>`}<div><b data-localize-text="${esc(name)}">${esc(name)}</b><small>${person.name.native?`원어: ${esc(person.name.native)} · `:''}${(person.primaryOccupations||[]).slice(0,2).map(x=>esc(localRole(x))).join(' · ')||'참여 인물'} · 참여 작품 ${count}개</small></div></article>`;}).join('')}</div>`;localizeMarked(target);}
  else target.innerHTML=`<div class="empty-state"><strong>${errors.length?'인물 검색에 실패했습니다.':'검색 결과가 없습니다.'}</strong><span>${esc(errors[0]||'한국어·영어·일본어 이름으로 검색해 보세요.')}</span></div>`;
}

async function showPersonWorks(personId,name){
  const main=$('#main-content');main.innerHTML=`${pageHead(name,'해당 인물이 참여한 애니메이션 작품입니다.','인물별 참여 작품')}<div id="person-works"></div>`;const target=$('#person-works');setLoading(target,'참여 작품을 불러오고 있습니다.');
  const q=`query Person($id:Int!){Staff(id:$id){id name{full native} description staffMedia(type:ANIME,sort:[POPULARITY_DESC]){nodes{${LIST_MEDIA_FIELDS}}} characterMedia(sort:[POPULARITY_DESC]){nodes{${LIST_MEDIA_FIELDS}}}}}`;
  try{const p=(await anilist(q,{id:Number(personId)})).Staff;const works=[...(p.staffMedia?.nodes||[]),...(p.characterMedia?.nodes||[])];const unique=[...new Map(works.map(m=>[m.id,m])).values()];const personDescription=cleanDescription(p.description||'인물 소개가 등록되지 않았습니다.').slice(0,500);target.innerHTML=`<div class="warning-box" style="margin-bottom:16px"><span data-localize-text="${esc(personDescription)}">${esc(personDescription)}</span><br>제작 참여 및 성우 출연 작품을 함께 표시합니다.</div>${gridMarkup(unique,true)}`;localizeMarked(target);hydrateKoreanCardTitles(unique,target,8);}catch(error){target.innerHTML=`<div class="empty-state"><strong>참여 작품을 불러오지 못했습니다.</strong><span>${esc(error.message)}</span></div>`;}
}

function watchStatusLabel(status){return STATUSES.find(x=>x[0]===status)?.[1]||status;}
function mediaGenres(media){return Array.isArray(media?.genres)?media.genres:[];}
function getPreferenceProfile(){
  const genre=new Map(),disliked=new Map(),format=new Map(),studio=new Map();let ratedCount=0,positiveRatedCount=0,negativeRatedCount=0;
  const statusSignal={COMPLETED:.42,CURRENT:.32,PLANNING:.12,PAUSED:.02,DROPPED:-.65};
  for(const item of state.watchlist){
    const m=item.media_snapshot||{};
    const hasRating=item.score!==null&&item.score!==undefined&&item.score!==''&&Number.isFinite(Number(item.score));
    const rating=hasRating?Math.max(0,Math.min(100,Number(item.score)))/10:null;
    const status=item.status||'PLANNING';const base=statusSignal[status]??0;
    let positive=0,negative=0;
    if(status==='DROPPED'){
      // 하차 기록은 평점이 높게 남아 있어도 추천에서는 명확한 비선호 신호로 처리합니다.
      negative=.85+(hasRating&&rating<=5?(5-rating)*.08:0);
      if(hasRating){ratedCount++;negativeRatedCount++;}
    }else if(hasRating){
      ratedCount++;
      if(rating>=8.5){positive=1.25+Math.max(0,base)*.35;positiveRatedCount++;}
      else if(rating>=7){positive=.72+(rating-7)*.18+Math.max(0,base)*.25;positiveRatedCount++;}
      else if(rating<=5){negative=.55+(5-rating)*.18+Math.max(0,-base)*.35;negativeRatedCount++;}
      else{positive=Math.max(0,base)*.12;}
    }else if(base>0)positive=base;
    else if(base<0)negative=-base;
    for(const g of mediaGenres(m)){
      if(positive>0)genre.set(g,(genre.get(g)||0)+positive);
      if(negative>0)disliked.set(g,(disliked.get(g)||0)+negative);
    }
    const f=m.format||m.type;
    if(f&&positive>0)format.set(f,(format.get(f)||0)+positive);
    for(const st of (m.studios?.nodes||m.studios||[])){
      if(st.name&&positive>0)studio.set(st.name,(studio.get(st.name)||0)+positive);
    }
  }
  const sortMap=map=>[...map].sort((a,b)=>b[1]-a[1]);
  const sum=map=>[...map.values()].reduce((total,value)=>total+value,0);
  return {genre,disliked,format,studio,topGenres:sortMap(genre).slice(0,5),dislikedGenres:sortMap(disliked).slice(0,3),topFormats:sortMap(format).slice(0,3),topStudios:sortMap(studio).slice(0,3),ratedCount,positiveRatedCount,negativeRatedCount,positiveGenreTotal:sum(genre),dislikedGenreTotal:sum(disliked),hasTaste:genre.size>0||disliked.size>0||format.size>0||studio.size>0};
}
function recommendationCandidateQuery(){return `query RecommendationCandidates($genres:[String],$formats:[MediaFormat]){
  trending:Page(page:1,perPage:50){media(type:ANIME,isAdult:false,sort:[TRENDING_DESC]){${LIST_MEDIA_FIELDS}}}
  genrePopular:Page(page:1,perPage:50){media(type:ANIME,isAdult:false,genre_in:$genres,sort:[POPULARITY_DESC]){${LIST_MEDIA_FIELDS}}}
  genreRated:Page(page:1,perPage:50){media(type:ANIME,isAdult:false,genre_in:$genres,format_in:$formats,averageScore_greater:70,sort:[SCORE_DESC,POPULARITY_DESC]){${LIST_MEDIA_FIELDS}}}
}`;}
function scoreRecommendations(candidates,profile){
  const rankedRaw=rankCandidates(candidates||[],profile||{});
  const diverse=selectDiverse(rankedRaw,24);
  const maxPopularity=Math.max(1,...(candidates||[]).map(m=>Number(m.popularity)||0));
  return diverse.map(entry=>{
    const item=entry.item;
    const reasons=[];
    const matched=entry.matched||[];
    const dislikedMatched=entry.dislikedMatched||[];
    const formatFit=entry.formatFit||0;
    const studioFit=entry.studioFit||0;
    if(matched.length)reasons.push(`선호 장르 ${matched.map(g=>GENRE_LABELS[g]||g).join('·')}`);
    if(formatFit>=.5)reasons.push(`선호 형식 ${formatOf(item)}`);
    const matchingStudios=(item.studios?.nodes||[]).filter(st=>(profile.studio.get(st.name)||0)>0).sort((a,b)=>(profile.studio.get(b.name)||0)-(profile.studio.get(a.name)||0));
    if(matchingStudios.length&&studioFit>=.5)reasons.push(`선호 제작사 ${matchingStudios[0].name}`);
    if(dislikedMatched.length)reasons.push(`비선호 장르 ${dislikedMatched.map(g=>GENRE_LABELS[g]||g).join('·')}`);
    if(Number(item.averageScore)>=82)reasons.push('높은 이용자 평점');
    if(!reasons.length)reasons.push(Number(item.averageScore)>=75?'평점이 검증된 작품':'새로운 장르 발견');
    return {...item,_recommendScore:Math.max(0,Math.min(100,entry.score)),_recommendReasons:reasons,_genreFit:entry.genreFit,_negativePenalty:entry.negativePenalty};
  });
}

function exportAllData(){
  const payload={app:'ANIME HUB',version:APP_VERSION,exportedAt:new Date().toISOString(),watchlist:state.watchlist,collections:state.collections,savedSearches:state.savedSearches};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`anime-hub-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('보관함·컬렉션·검색 조건을 백업했습니다.');
}
async function importAllData(file){
  if(!file)return;try{const data=JSON.parse(await file.text());if(!data||data.app!=='ANIME HUB')throw new Error('ANIME HUB 백업 파일이 아닙니다.');
    const watch=Array.isArray(data.watchlist)?data.watchlist:[];const collections=Array.isArray(data.collections)?data.collections:[];const searches=Array.isArray(data.savedSearches)?data.savedSearches:[];
    if(!confirm(`백업 데이터를 불러올까요?\n보관함 ${watch.length}개 · 컬렉션 ${collections.length}개 · 검색 조건 ${searches.length}개\n기존 데이터와 합쳐집니다.`))return;
    const map=new Map(state.watchlist.map(x=>[String(x.media_id),x]));for(const item of watch){if(item?.media_id!=null)map.set(String(item.media_id),item);}state.watchlist=[...map.values()];
    const cm=new Map(state.collections.map(x=>[String(x.id),x]));for(const c of collections){if(c?.id==null)continue;const old=cm.get(String(c.id));if(old){const items=new Map([...(old.items||[]),...(c.items||[])].map(x=>[String(x.id),x]));const ids=[...new Set([...(old.mediaIds||[]),...(c.mediaIds||[])].map(String))];cm.set(String(c.id),{...old,...c,mediaIds:ids,items:[...items.values()],updatedAt:new Date().toISOString()});}else cm.set(String(c.id),c);}state.collections=[...cm.values()];
    const sm=new Map(state.savedSearches.map(x=>[String(x.id),x]));for(const x of searches){if(x?.id!=null)sm.set(String(x.id),x);}state.savedSearches=[...sm.values()];
    saveLocalList();saveCollections({cloud:false});saveSavedSearches({cloud:false});
    if(state.supabase&&state.user){
      try{
        for(const item of state.watchlist){if(Number.isInteger(Number(item.media_id))&&!String(item.media_id).startsWith('mal:'))await syncUpsert(item);}
        await syncUserData();toast('백업 데이터를 복원하고 계정에 동기화했습니다.');
      }catch(error){toast(`기기에는 복원했지만 클라우드 동기화에 실패했습니다: ${error.message}`,'error');}
    }else toast('백업 데이터를 복원했습니다.');
    if(state.route==='watchlist')renderWatchlist();
  }catch(error){toast(`백업을 불러오지 못했습니다: ${error.message}`,'error');}
}
function renderFranchisePage(media){
  if(!media)return;state.franchiseFocus=media;$('#modal-root').innerHTML='';const edges=media.relations?.edges||[];const label={PREQUEL:'전작',SEQUEL:'후속작',SIDE_STORY:'외전',SPIN_OFF:'스핀오프',ADAPTATION:'원작·각색',ALTERNATIVE:'다른 버전',PARENT:'상위 작품',SUMMARY:'요약판'};
  const ordered=[...edges].sort((a,b)=>{const rank={PREQUEL:0,PARENT:1,SEQUEL:2,SIDE_STORY:3,SPIN_OFF:4,ADAPTATION:5,ALTERNATIVE:6,SUMMARY:7};return (rank[a.relationType]??9)-(rank[b.relationType]??9);});
  const root=$('#main-content');root.innerHTML=`<div class="page-head"><div><div class="eyebrow">작품 탐색 · 시리즈</div><h1 class="page-title">${esc(localizedTitle(media))} 관계도</h1><p class="page-subtitle">데이터베이스에 등록된 직접 연관 작품을 관계 유형별로 정리했습니다. 공식 감상 순서와 다를 수 있습니다.</p></div><button class="ghost-button" id="back-franchise-detail">← 작품 상세로</button></div><div class="franchise-board"><article class="franchise-main"><span>선택한 작품</span><b>${esc(localizedTitle(media))}</b><small>${esc(formatOf(media))} · ${esc(yearOf(media))}</small></article>${ordered.length?`<div class="franchise-list">${ordered.map(edge=>{const n=edge.node||{};const title=n.title?.userPreferred||n.title?.english||n.title?.native||'제목 미상';return `<button class="franchise-item" data-open="${esc(n.id)}"><span>${esc(label[edge.relationType]||edge.relationType||'연관 작품')}</span><b>${esc(localizedTitle(n))}</b><small>${esc(formatOf(n))} · ${esc(statusOf(n.status))}</small></button>`;}).join('')}</div>`:`<div class="empty-state"><strong>연관 작품 정보가 등록되지 않았습니다.</strong><span>정보 제공처에 관계 데이터가 없을 수 있습니다.</span></div>`}<div class="source-footnote">작품 관계는 AniList에 등록된 관계 데이터 기준입니다. 작품의 공식 감상 순서를 보장하지 않습니다.</div></div>`;
}

async function renderWatchlist(){
  const main=$('#main-content');const counts=Object.fromEntries(STATUSES.map(([status])=>[status,state.watchlist.filter(x=>x.status===status).length]));
  main.innerHTML=`${pageHead('내 보관함','보고 싶은 작품부터 시청을 마친 작품까지 나만의 목록으로 관리합니다.','나의 애니메이션')}<div class="watch-controls">${STATUSES.map(([status,label])=>`<button class="pill ${state.watchStatusFilter===status?'active':''}" data-watch-filter="${status}">${label} <b>${counts[status]||0}</b></button>`).join('')}<button class="pill ${!state.watchStatusFilter?'active':''}" data-watch-filter="ALL">전체 <b>${state.watchlist.length}</b></button></div><div id="watch-results" style="margin-top:18px"></div><p class="source-footnote">${state.user?'계정에 저장된 AniList 작품은 로그인한 기기에서 동기화됩니다.':'이 보관함은 현재 브라우저에 저장됩니다. 브라우저 데이터 삭제 전 JSON 백업을 권장합니다.'}</p>`;
  const filtered=state.watchStatusFilter?state.watchlist.filter(x=>x.status===state.watchStatusFilter):state.watchlist;
  const target=$('#watch-results');
  target.innerHTML=filtered.length?`<div class="watchlist-grid">${filtered.map(item=>{const media=item.media_snapshot||{id:item.media_id,title:{userPreferred:`작품 #${item.media_id}`}};const key=String(item.media_id);return `<div class="watch-card-shell">${cardMarkup(media,false)}<div class="watch-card-tools"><select data-watch-status="${esc(key)}" aria-label="시청 상태 변경">${STATUSES.map(([status,label])=>`<option value="${status}" ${status===item.status?'selected':''}>${label}</option>`).join('')}</select><input type="number" min="0" max="10" step="0.5" placeholder="내 평점 / 10" value="${item.score==null?'':Number(item.score)/10}" data-watch-score="${esc(key)}" aria-label="개인 평점"><button class="ghost-button" data-save-watch-edit="${esc(key)}">저장</button><button class="ghost-button danger-button" data-remove-watch="${esc(key)}">삭제</button></div></div>`;}).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">🔍♡</div><strong>아직 보관한 작품이 없습니다.</strong><span>작품 상세 화면에서 시청 상태를 선택해 목록에 추가해 보세요.</span><br><button class="ghost-button" data-route="browse">작품 찾아보기</button></div>`;
  localizeMarked(target);hydrateKoreanCardTitles(filtered,target,8);
}

function createCollectionPrompt(){
  const name=prompt('새 컬렉션 이름을 입력해 주세요.');if(name===null)return null;if(!name.trim()){toast('컬렉션 이름을 입력해 주세요.','error');return null;}
  const collection={id:`c${Date.now()}${Math.random().toString(36).slice(2,6)}`,name:name.trim().slice(0,40),mediaIds:[],items:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};state.collections.unshift(collection);saveCollections();toast('새 컬렉션을 만들었습니다.');return collection;
}
function addMediaToCollection(collectionId,media){
  if(!media||media.id==null){toast('작품 정보를 찾을 수 없습니다.','error');return;}
  const collection=state.collections.find(x=>x.id===collectionId);if(!collection)return;
  const key=String(media.id);if(collection.mediaIds.some(x=>String(x)===key)){toast('이미 이 컬렉션에 담긴 작품입니다.');return;}
  collection.mediaIds=collection.mediaIds.filter(x=>String(x)!==key);collection.mediaIds.unshift(media.id);collection.items=collection.items||[];collection.items=collection.items.filter(x=>String(x.id)!==key);collection.items.unshift(compactMediaSnapshot(media));collection.updatedAt=new Date().toISOString();state.mediaIndex.set(key,media);saveCollections();toast(`'${collection.name}' 컬렉션에 추가했습니다.`);
  if(state.route==='collections')renderCollectionDetail(collection.id);
}
function removeMediaFromCollection(collectionId,mediaId){
  const collection=state.collections.find(x=>x.id===collectionId);if(!collection)return;
  collection.mediaIds=collection.mediaIds.filter(x=>String(x)!==String(mediaId));collection.items=(collection.items||[]).filter(x=>String(x.id)!==String(mediaId));collection.updatedAt=new Date().toISOString();saveCollections();renderCollectionDetail(collectionId);toast('컬렉션에서 작품을 제거했습니다.');
}
function deleteCollectionById(id){
  const collection=state.collections.find(x=>x.id===id);if(!collection||!confirm(`'${collection.name}' 컬렉션을 삭제할까요? 보관함 작품은 삭제되지 않습니다.`))return;
  state.collections=state.collections.filter(x=>x.id!==id);saveCollections();renderCollections();toast('컬렉션을 삭제했습니다.');
}
function renderCollections(){
  const main=$('#main-content');main.innerHTML=`${pageHead('나만의 컬렉션','주제나 취향에 맞게 작품을 모아 나만의 목록을 만드세요.','개인 컬렉션')}<div class="collection-toolbar"><span>총 ${state.collections.length}개 컬렉션</span><button class="primary-button" id="create-collection">＋ 새 컬렉션</button></div>${state.collections.length?`<div class="collection-grid">${state.collections.map(collection=>{const first=(collection.items||[])[0]||collection.mediaIds.map(id=>knownMedia(id)).find(Boolean);return `<article class="collection-card" data-open-collection="${esc(collection.id)}"><div class="collection-cover">${first&&posterOf(first)?`<img src="${esc(posterOf(first))}" alt="">`:`<div class="poster-placeholder">▣</div>`}</div><div><b>${esc(collection.name)}</b><small>${(collection.mediaIds||[]).length}개 작품</small></div><button class="ghost-button danger-button" data-delete-collection="${esc(collection.id)}">삭제</button></article>`;}).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">🔍▣</div><strong>아직 컬렉션이 없습니다.</strong><span>새 컬렉션을 만들고 작품 상세 화면에서 작품을 담아보세요.</span></div>`}`;
}
function renderCollectionDetail(id){
  state.currentCollectionId=id;const collection=state.collections.find(x=>x.id===id);if(!collection){renderCollections();return;}
  const items=(collection.items?.length?collection.items:collection.mediaIds.map(mediaId=>knownMedia(mediaId))).filter(Boolean);
  const main=$('#main-content');main.innerHTML=`<div class="page-head"><div><div class="eyebrow">나만의 컬렉션</div><h1 class="page-title">${esc(collection.name)}</h1><p class="page-subtitle">${items.length}개 작품을 모았습니다.</p></div><button class="ghost-button" id="share-collection">공유 링크</button><button class="ghost-button" id="back-collections">← 컬렉션 목록</button></div>${items.length?`<div class="collection-items-grid">${items.map(media=>`<div class="watch-card-shell">${cardMarkup(media,false)}<button class="ghost-button danger-button" data-remove-collection-item="${esc(collection.id)}" data-media-id="${esc(media.id)}">컬렉션에서 제거</button></div>`).join('')}</div>`:`<div class="empty-state"><strong>이 컬렉션은 비어 있습니다.</strong><span>작품 상세 화면에서 이 컬렉션에 추가할 수 있습니다.</span><button class="ghost-button" data-route="browse">작품 찾기</button></div>`}`;
  localizeMarked(main);hydrateKoreanCardTitles(items,main,8);
}
function removeWatchlistItem(id){
  const old=state.watchlist.find(x=>String(x.media_id)===String(id));if(!old)return;
  state.watchlist=state.watchlist.filter(x=>String(x.media_id)!==String(id));saveLocalList();
  if(state.supabase&&state.user&&Number.isInteger(Number(id))&&!String(id).startsWith('mal:'))syncDelete(id).catch(e=>toast(`기기에서는 삭제했지만 계정 삭제는 실패했습니다: ${e.message}`,'error'));
  renderWatchlist();toast('보관함에서 제거했습니다.');
}
function updateWatchlistItem(id){
  const item=state.watchlist.find(x=>String(x.media_id)===String(id));if(!item)return;
  const status=$(`[data-watch-status="${CSS.escape(String(id))}"]`);const score=$(`[data-watch-score="${CSS.escape(String(id))}"]`);
  if(status)item.status=status.value;
  if(score&&score.value!==''){const value=Number(score.value);if(!Number.isFinite(value)||value<0||value>10){toast('개인 평점은 0~10 사이로 입력해 주세요.','error');return;}item.score=Math.round(value*10);}else if(score)item.score=null;
  item.updated_at=new Date().toISOString();saveLocalList();if(state.supabase&&state.user&&!String(id).startsWith('mal:'))syncUpsert(item).catch(e=>toast(`이 기기에는 저장했지만 계정 동기화는 실패했습니다: ${e.message}`,'error'));toast('시청 기록을 저장했습니다.');renderWatchlist();
}
function renderStats(){
  const main=$('#main-content');const total=state.watchlist.length;const counts=Object.fromEntries(STATUSES.map(([key])=>[key,state.watchlist.filter(x=>x.status===key).length]));
  const scores=state.watchlist.map(x=>x.score).filter(x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))).map(Number);const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length/10:0;
  const genres=new Map();for(const item of state.watchlist){for(const genre of item.media_snapshot?.genres||[])genres.set(genre,(genres.get(genre)||0)+1);}
  const topGenres=[...genres].sort((a,b)=>b[1]-a[1]).slice(0,8);const maxGenre=Math.max(1,...topGenres.map(x=>x[1]));const completedItems=state.watchlist.filter(x=>x.status==='COMPLETED');const completedEpisodes=completedItems.reduce((sum,x)=>sum+Number(x.media_snapshot?.episodes||0),0);const estimatedMinutes=completedItems.reduce((sum,x)=>sum+Number(x.media_snapshot?.episodes||0)*Number(x.media_snapshot?.duration||24),0);
  main.innerHTML=`${pageHead('시청 통계','내가 모으고 감상한 애니메이션 기록을 한눈에 확인합니다.','나의 감상 기록')}<div class="stats-grid"><article><small>보관한 작품</small><strong>${total}</strong><span>전체</span></article><article><small>시청 완료</small><strong>${counts.COMPLETED||0}</strong><span>완결 및 감상 완료로 표시한 작품</span></article><article><small>시청 중</small><strong>${counts.CURRENT||0}</strong><span>현재 감상 중</span></article><article><small>개인 평균 평점</small><strong>${scores.length?avg.toFixed(1):'—'}</strong><span>${scores.length}개 작품 평가</span></article><article><small>완료한 총 화수</small><strong>${completedEpisodes.toLocaleString('ko-KR')}</strong><span>시청 완료 작품 기준</span></article><article><small>추정 감상 시간</small><strong>${estimatedMinutes?`${(estimatedMinutes/60).toFixed(1)}시간`:'—'}</strong><span>완료 작품 · 회당 24분 가정</span></article></div><section class="section stats-section"><h2 class="section-title">시청 상태별 작품 수</h2><div class="stats-bars">${STATUSES.map(([key,label])=>`<div class="stats-bar-row"><span>${label}</span><div><i style="width:${total?counts[key]/total*100:0}%"></i></div><b>${counts[key]||0}</b></div>`).join('')}</div></section><section class="section stats-section"><h2 class="section-title">내가 많이 본 장르</h2>${topGenres.length?`<div class="stats-bars">${topGenres.map(([genre,count])=>`<div class="stats-bar-row"><span>${esc(GENRE_LABELS[genre]||genre)}</span><div><i style="width:${count/maxGenre*100}%"></i></div><b>${count}</b></div>`).join('')}</div>`:`<div class="empty-state"><span>보관함에 작품을 추가하면 선호 장르를 분석합니다.</span></div>`}</section><button class="ghost-button" data-route="watchlist">내 보관함 관리</button>`;
}
async function renderRecommendations(force=false){
  const main=$('#main-content');main.innerHTML=`${pageHead('취향 기반 추천','내가 높게 평가한 작품은 더 반영하고, 낮게 평가하거나 하차한 작품의 특징은 추천에서 줄입니다.','개인 맞춤 추천')}<div class="recommend-toolbar"><p>${state.watchlist.length?'보관함의 시청 상태·개인 평점·장르·형식·제작사를 함께 분석합니다.':'보관함이 비어 있어 평점과 화제성이 높은 작품부터 보여줍니다.'}</p><div><button class="ghost-button" id="enable-release-alerts">${state.notificationsEnabled?'새 작품 알림 켜짐':'새 작품 알림 켜기'}</button><button class="ghost-button" id="random-recommendation">무작위 발견</button><button class="ghost-button" id="refresh-recommendations">추천 새로고침</button></div></div><div id="recommend-results"></div>`;
  const target=$('#recommend-results');setLoading(target,'내 취향을 분석하고 작품 후보를 찾고 있습니다.');
  const profile=getPreferenceProfile();
  const favoriteGenres=profile.topGenres.slice(0,4).map(x=>x[0]);const favoriteFormats=profile.topFormats.map(x=>x[0]);
  try{
    const data=await anilist(recommendationCandidateQuery(),{genres:favoriteGenres.length?favoriteGenres:null,formats:favoriteFormats.length?favoriteFormats:null},{forceRefresh:force});
    const seen=new Set(state.watchlist.flatMap(x=>[String(x.media_id),x.idMal?`mal:${x.idMal}`:null].filter(Boolean)));
    const map=new Map();for(const item of [...(data.trending?.media||[]),...(data.genrePopular?.media||[]),...(data.genreRated?.media||[])])if(item?.id!=null)map.set(String(item.id),item);
    const candidates=[...map.values()].filter(item=>!seen.has(String(item.id))&&!(item.idMal&&seen.has(`mal:${item.idMal}`)));
    const ranked=scoreRecommendations(candidates,profile).slice(0,24);state.recommendedMedia=ranked;
    const recMetrics=recommendationMetrics({recommended:ranked.map(r=>r.id),relevant:new Set(),catalogSize:candidates.length,items:ranked.map(r=>({...r,score:r._recommendScore})),k:ranked.length||1})||{diversity:0,avgScore:0};
    state.recommendMetrics={...recMetrics,strategy:coldStartStrategy(profile),computedAt:Date.now()};
    const positives=profile.topGenres.map(([g])=>GENRE_LABELS[g]||g);const negatives=profile.dislikedGenres.map(([g])=>GENRE_LABELS[g]||g);
    const profileMarkup=profile.hasTaste?`<div class="recommend-profile"><div><b>선호하는 장르</b><span>${positives.length?positives.join(' · '):'아직 뚜렷한 선호 장르가 없습니다.'}</span></div><div><b>추천에서 줄이는 장르</b><span>${negatives.length?negatives.join(' · '):'낮은 평점·하차 기록에서 확인된 비선호 장르가 없습니다.'}</span></div><div><b>선호 형식</b><span>${profile.topFormats.length?profile.topFormats.map(([f])=>formatOf({format:f})).join(' · '):'아직 뚜렷한 형식 선호가 없습니다.'}</span></div><div><b>자주 본 제작사</b><span>${profile.topStudios.length?profile.topStudios.map(([name])=>esc(name)).join(' · '):'제작사 취향 데이터가 부족합니다.'}</span></div><small>평점을 입력한 ${profile.ratedCount}개 작품을 반영했습니다. 8.5점 이상은 강한 선호, 7점 이상은 선호, 5점 이하는 비선호로 계산하며 하차 기록은 별도 감점 신호로 사용합니다.</small></div>`:`<div class="recommend-profile"><div><b>취향 분석이 아직 부족합니다.</b><span>보관함에 작품을 추가하고 개인 평점을 입력하면 장르·형식·제작사 선호를 반영합니다. 현재는 ${coldStartStrategy(profile)==='popular-quality'?'평점·인기도 기반 추천':coldStartStrategy(profile)==='explore-genres'?'장르 탐색 모드':'개인화 모드'}로 동작합니다.</span></div></div>`;
    target.innerHTML=`${profileMarkup}<div class="recommend-result-head"><b>추천 작품 ${ranked.length}개</b><span>개인 취향 점수순 · 보관함 작품 제외</span></div>${ranked.length?gridMarkup(ranked,true,true):`<div class="empty-state"><strong>추천할 작품을 찾지 못했습니다.</strong><span>보관함의 작품을 더 추가하거나 새로고침해 주세요.</span></div>`}<p class="source-footnote">추천 점수는 보관함에서 추정한 장르·형식·제작사 선호와 AniList 평점·인기도를 조합한 개인화 점수입니다. 학습형 AI가 아니며, 추천 적합도를 보장하지 않습니다. 다양성 ${(recMetrics?.diversity??0).toFixed(2)} · 평균 점수 ${(recMetrics?.avgScore??0).toFixed(1)}.</p>`;
    if(ranked.length){
      const info=$('.recommend-result-head span',target);if(info)info.textContent='한국어 제목 별칭 확인 중 · 개인 취향 점수순';
      // Check only the first eight cards to keep unauthenticated Jikan lookups bounded.
      // TMDB enrichment remains optional and runs only when the user configured a token.
      enrichKoreanMetadata(ranked.slice(0,8),3).then(()=>{
        if(state.route!=='recommend'||!$('#recommend-results'))return;
        const cards=$$('.anime-card',target);for(const card of cards){const id=card.dataset.open;const item=ranked.find(x=>String(x.id)===String(id));if(item){const title=$('.card-title',card);if(title)title.textContent=localizedTitle(item);}}
        const current=$('.recommend-result-head span',target);if(current)current.textContent='확인 가능한 한국어 제목 반영 · 개인 취향 점수순';
      }).catch(error=>console.warn('Recommendation Korean title hydration skipped:',error));
    }
  }catch(error){target.innerHTML=`<div class="empty-state"><strong>추천 작품을 불러오지 못했습니다.</strong><span>${esc(error.message)}</span><button class="ghost-button" id="refresh-recommendations">다시 시도</button></div>`;}
}
async function enableReleaseAlerts(){
  if(!('Notification' in window)){toast('현재 브라우저는 알림 기능을 지원하지 않습니다.','error');return;}
  const permission=await Notification.requestPermission();if(permission!=='granted'){toast('브라우저 알림 권한이 허용되지 않았습니다.','error');return;}
  state.notificationsEnabled=true;localStorage.setItem(RELEASE_ALERT_KEY,'1');toast('새 작품 알림을 켰습니다.');
  await checkNewReleaseAlerts(true);
  if(state.route==='recommend')renderRecommendations();
}
async function checkNewReleaseAlerts(initial=false){
  if(!state.notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;
  const last=Number(localStorage.getItem('animehub_release_check_at')||0);if(!initial&&Date.now()-last<12*60*60*1000)return;
  try{
    const data=await fetchAnimeList({page:1,perPage:20,sort:['START_DATE_DESC']});const list=data.media||[];const seen=new Set(JSON.parse(localStorage.getItem(RELEASE_SEEN_KEY)||'[]').map(String));
    const fresh=list.filter(item=>!seen.has(String(item.id)));
    if(seen.size&&fresh.length){fresh.slice(0,3).forEach(item=>new Notification('ANIME HUB · 새 작품',{body:`${localizedTitle(item)} 작품 정보가 새로 등록되었을 수 있습니다.`,icon:'./assets/icon-192.png'}));}
    const next=[...new Set([...list.map(x=>String(x.id)),...seen])].slice(0,300);localStorage.setItem(RELEASE_SEEN_KEY,JSON.stringify(next));
    const watching=state.watchlist.filter(x=>x.status==='CURRENT'&&Number.isInteger(Number(x.media_id))).map(x=>Number(x.media_id)).slice(0,30);
    if(watching.length){const now=Math.floor(Date.now()/1000),to=now+7*86400;try{const q=`query MyUpcoming($ids:[Int],$from:Int!,$to:Int!){Page(page:1,perPage:50){airingSchedules(mediaId_in:$ids,airingAt_greater:$from,airingAt_lesser:$to,notYetAired:true,sort:[TIME]){id airingAt episode media{id title{userPreferred english romaji}}}}}`;const schedule=await anilist(q,{ids:watching,from:now,to},{cacheTtl:60*60*1000});const aired=new Set(JSON.parse(localStorage.getItem('animehub_episode_alert_seen')||'[]').map(String));for(const row of schedule.Page?.airingSchedules||[]){const key=String(row.id);if(!aired.has(key)){if(!initial)new Notification('ANIME HUB · 새 회차 예정',{body:`${titleOf(row.media)} · ${row.episode}화 · ${localDate(row.airingAt)}`,icon:'./assets/icon-192.png'});aired.add(key);}}localStorage.setItem('animehub_episode_alert_seen',JSON.stringify([...aired].slice(-500))); }catch(error){console.warn('시청 중 작품 일정 확인 실패:',error);}}
    localStorage.setItem('animehub_release_check_at',String(Date.now()));
  }catch(error){console.warn('새 작품 확인 실패:',error);}
}

async function renderRoute(){
  state.lastAutoRefresh=Date.now();state.staleDataUsed=false;
  $$('.nav-item').forEach(a=>a.classList.toggle('active',a.dataset.route===state.route));
  if(state.route==='home')return renderHome();
  if(state.route==='browse')return renderBrowse();
  if(state.route==='airing')return renderAiring();
  if(state.route==='movies')return renderMovies();
  if(state.route==='studios')return renderStudios();
  if(state.route==='people')return renderPeople();
  if(state.route==='watchlist')return renderWatchlist();
  if(state.route==='recommend')return renderRecommendations();
  if(state.route==='collections')return renderCollections();
  if(state.route==='stats')return renderStats();
  state.route='home';return renderHome();
}
function readRecentViews(){try{return JSON.parse(localStorage.getItem('animehub_recent_views')||'[]');}catch{return [];}}
function writeRecentViews(list){localStorage.setItem('animehub_recent_views',JSON.stringify(list.slice(0,12)));}
function recordRecentView(media){if(!media?.id)return;const snap=compactMediaSnapshot(media);const list=readRecentViews().filter(x=>String(x.id)!==String(media.id));list.unshift(snap);writeRecentViews(list);state.recentViews=list;}
function continueCandidate(){
  const items=(state.watchlist||[]).filter(x=>x.status==='CURRENT');
  if(!items.length)return null;
  items.sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
  return items[0];
}
function updateContinueBar(){
  let bar=document.getElementById('continue-bar');
  const item=continueCandidate();
  if(!item){ if(bar)bar.remove(); return;}
  const media=item.media_snapshot||{title:{userPreferred:`작품 #${item.media_id}`}};
  const title=localizedTitle?localizedTitle(media): (media.title?.userPreferred||media.title?.english||'작품');
  const progress=item.progress?`${item.progress}/${media.episodes||'?'}`:'이어서 보기';
  if(!bar){ bar=document.createElement('div'); bar.id='continue-bar'; bar.className='continue-bar'; document.body.appendChild(bar);}
  bar.innerHTML=`<span>▶</span><div><b>${esc(title)}</b><br><small>${esc(progress)} · ${esc(statusOf?statusOf('CURRENT'):'시청 중')}</small></div><button class="primary-button" data-open="${esc(item.media_id)}">이어서 보기</button>`;
}
function navigate(route){state.route=route;state.watchStatusFilter='';history.replaceState(null,'',`#${route}`);renderRoute();updateContinueBar();window.scrollTo({top:0,behavior:'smooth'});}

async function openAnime(id){
  const root=$('#modal-root');
  const cachedMedia=knownMedia(id);
  const isMal=String(id).startsWith('mal:');
  const malId=isMal?Number(String(id).split(':')[1]):null;
  const showAndEnrich=(media,malData=null)=>{
    state.currentModal={media,mal:malData};
    renderDetailModal(media,malData,{extrasLoading:Number.isInteger(media.id)});
    recordRecentView(media);
    if(Number.isInteger(media.id))loadAnimeExtras(media.id).catch(error=>{
      if(state.currentModal?.media?.id!==media.id)return;
      const slot=$('[data-detail-extras]');if(slot)slot.innerHTML=`<p class="muted">인물·제작진 정보를 가져오지 못했습니다: ${esc(error.message)}</p>`;
    });
    if(media.idMal&&!malData)loadMalDetails(media).catch(()=>{});
  };
  if(cachedMedia){showAndEnrich(cachedMedia);return;}
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div style="padding:25px"><div class="empty-state"><div class="empty-icon">🔍◌</div><strong>작품 기본 정보를 불러오고 있습니다.</strong><span>기본 정보가 도착하면 상세 화면이 먼저 열리고, 추가 정보는 뒤에서 표시됩니다.</span></div></div></div></div>`;
  try{
    let media=null,malData=null,aniError=null;
    if(isMal){
      try{
        const response=await anilist(`query AnimeDetailByMal($idMal:Int!){Media(idMal:$idMal,type:ANIME){${LIST_MEDIA_FIELDS}}}`,{idMal:malId});
        media=response.Media||null;
      }catch(error){aniError=error;}
      if(!media){const full=await jikan(`/anime/${malId}/full`);malData=full.data;media=mapJikanAnime(full.data);}
    }else{
      const query=`query AnimeDetail($id:Int!){Media(id:$id,type:ANIME){${LIST_MEDIA_FIELDS}}}`;
      const response=await anilist(query,{id:Number(id)});media=response.Media||null;
    }
    if(!media)throw aniError||new Error('작품을 찾을 수 없습니다.');
    showAndEnrich(media,malData);
  }catch(error){
    root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="empty-state"><strong>상세 정보를 불러오지 못했습니다.</strong><span>${esc(error.message)}</span></div></div></div>`;
  }
}
async function loadMalDetails(media){
  if(!media?.idMal)return;
  const data=await jikan(`/anime/${media.idMal}/full`);if(state.currentModal?.media?.id!==media.id)return;
  state.currentModal.mal=data.data;const mal=data.data;
  const target=$('[data-detail-mal]');if(target&&mal.score)target.innerHTML=`<span class="stat-chip"><strong>★ ${esc(mal.score)}</strong>MyAnimeList</span>`;
  const rank=$('[data-detail-rank]'),source=$('[data-detail-source]');if(rank)rank.textContent=mal.rank?`#${esc(mal.rank)}`:'정보 없음';if(source)source.textContent=mal.source||'정보 없음';
  if(!String(media.description||'').trim()&&mal.synopsis){
    media.description=mal.synopsis;const descriptionNode=$('[data-translate-description]'),originalNode=$('[data-translation-original-content]');
    if(descriptionNode&&!localizedDescription(media))descriptionNode.textContent=cleanDescription(mal.synopsis);
    if(originalNode)originalNode.textContent=cleanDescription(mal.synopsis);
  }
}
async function loadAnimeExtras(id){
  const q=`query AnimeDetailExtras($id:Int!){Media(id:$id,type:ANIME){description(asHtml:false) duration season seasonYear startDate{year month day} endDate{year month day} relations{edges{relationType node{id title{userPreferred english native} format type status season seasonYear}}} characters(page:1,perPage:10){edges{role node{name{full native} image{large}} voiceActors(language:JAPANESE){id name{full native} image{large}}}} staff(page:1,perPage:12){edges{role node{id name{full native} image{large}}}}}}`;
  const response=await anilist(q,{id});if(!response.Media)throw new Error('추가 정보를 찾을 수 없습니다.');
  if(state.currentModal?.media?.id!==id)return;
  Object.assign(state.currentModal.media,{description:response.Media.description,duration:response.Media.duration,season:response.Media.season,seasonYear:response.Media.seasonYear,startDate:response.Media.startDate,endDate:response.Media.endDate,relations:response.Media.relations,characters:response.Media.characters,staff:response.Media.staff});
  const desc=cleanDescription(response.Media.description||'작품 설명이 등록되지 않았습니다.');
  const descriptionNode=$('[data-translate-description]'),originalNode=$('[data-translation-original-content]');
  if(descriptionNode&&desc&&!localizedDescription(state.currentModal.media)){descriptionNode.textContent=desc;descriptionNode.dataset.descriptionKind='original';}
  if(originalNode)originalNode.textContent=desc;
  const production=$('[data-detail-production-info]');if(production)production.innerHTML=detailProductionMarkup(state.currentModal.media);
  const relationSlot=$('[data-detail-relations]');if(relationSlot)relationSlot.innerHTML=detailRelationsMarkup(state.currentModal.media);
  const slot=$('[data-detail-extras]');if(slot){const scroll=$('.modal')?.scrollTop||0;slot.outerHTML=detailExtrasMarkup(state.currentModal.media);if($('.modal'))$('.modal').scrollTop=scroll;localizeMarked($('#modal-root'));}
}
function detailProductionMarkup(m){
  return `시즌: ${esc(seasonLabel(m.season))} ${esc(m.seasonYear||'')}<br>방영 기간: ${esc([m.startDate?.year,m.startDate?.month,m.startDate?.day].filter(Boolean).join('.'))} ~ ${esc([m.endDate?.year,m.endDate?.month,m.endDate?.day].filter(Boolean).join('.'))}<br>회당 길이: ${m.duration?`${m.duration}분`:'정보 없음'}<br>MyAnimeList 순위: <span data-detail-rank>조회 중 또는 정보 없음</span> · 원작: <span data-detail-source>조회 중 또는 정보 없음</span>`;
}
function detailRelationsMarkup(m){
  const edges=m.relations?.edges||[];if(!edges.length)return '<section class="detail-section" data-empty-relations><h3>작품 관계도</h3><p class="muted">등록된 전작·후속작·외전 정보가 없습니다.</p></section>';
  const labels={PREQUEL:'전작',SEQUEL:'후속작',SIDE_STORY:'외전',ALTERNATIVE:'다른 버전',PARENT:'상위 작품',SUMMARY:'요약판',CHARACTER:'캐릭터 연관',SPIN_OFF:'스핀오프',ADAPTATION:'원작·각색'};
  const grouped=new Map();for(const edge of edges){const key=labels[edge.relationType]||'기타 연관 작품';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(edge.node);}
  return `<section class="detail-section"><div class="section-head"><h3>작품 관계도</h3><button class="ghost-button" id="open-franchise-map">전체 관계도 보기</button></div><div class="relation-map"><div class="relation-root">${esc(localizedTitle(m))}<small>현재 작품</small></div><div class="relation-groups">${[...grouped].map(([label,nodes])=>`<div class="relation-group"><b>${esc(label)}</b><div>${nodes.map(node=>`<button class="relation-chip" data-open="${esc(node.id)}"><span>${esc(localizedTitle(node))}</span> · ${esc(formatOf(node))}</button>`).join('')}</div></div>`).join('')}</div></div></section>`;
}

function detailExtrasMarkup(m){
  const characters=m.characters?.edges||[],staff=m.staff?.edges||[];
  const cast=characters.map(edge=>{const character=edge.node?.name?.full||'이름 정보 없음';const voice=(edge.voiceActors||[]).filter(v=>v.name?.full);return `<div class="person-card">${edge.node?.image?.large?`<img src="${esc(edge.node.image.large)}" alt="">`:`<div class="feature-icon">인</div>`}<div><b data-localize-text="${esc(character)}">${esc(character)}</b><small>${esc(localRole(edge.role))} · ${voice.length?voice.map(v=>`<button class="credit-link" data-person="${esc(v.id)}" data-person-name="${esc(v.name.full)}"><span data-localize-text="${esc(v.name.full)}">${esc(v.name.full)}</span></button>`).join(', '):'성우 정보 없음'}</small></div></div>`;}).join('');
  const credits=staff.map(edge=>{const name=edge.node?.name?.full||'이름 정보 없음';return `<span class="credit-chip"><button class="credit-link" data-person="${esc(edge.node?.id||'')}" data-person-name="${esc(name)}"><span data-localize-text="${esc(name)}">${esc(name)}</span></button> · ${esc(localRole(edge.role))}</span>`;}).join('');
  return `<div data-detail-extras>${characters.length?`<section class="detail-section"><h3>등장인물 · 일본어 성우</h3><div class="people-grid">${cast}</div></section>`:''}${staff.length?`<section class="detail-section"><h3>제작진</h3><div class="credit-list">${credits}</div></section>`:''}${!characters.length&&!staff.length?'<section class="detail-section"><p class="muted">등록된 인물·제작진 정보가 없습니다.</p></section>':''}</div>`;
}

function detailStudiosMarkup(m){const studios=m.studios?.nodes||m.studios||[];if(!studios.length)return '정보 없음';return studios.map(st=>st.id?`<button class="credit-link" data-studio="${esc(st.id)}" data-studio-name="${esc(st.name)}">${esc(st.name)}</button>`:`<span>${esc(st.name)}</span>`).join(', ');}

function showUserKoreanModal(media){
  const existing=getUserKorean(media);
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" style="max-width:520px"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="settings-wrap"><div class="eyebrow">사용자 입력</div><h2>한국어 제목·소개 직접 입력</h2><p class="page-subtitle">공식 자료가 없는 작품에 직접 한국어 제목과 소개를 입력할 수 있습니다. "사용자 입력"으로 표시되며, 언제든 수정·삭제할 수 있습니다.</p><form class="settings-form" id="user-korean-form"><label>한국어 제목<input id="uk-title" type="text" placeholder="예: 귀멸의 칼날" value="${esc(existing?.title||'')}"></label><label>한국어 소개<textarea id="uk-overview" rows="4" placeholder="작품 소개를 입력하세요">${esc(existing?.overview||'')}</textarea></label><label>출처 URL (선택)<input id="uk-url" type="url" placeholder="https://..." value="${esc(existing?.url||'')}"></label><div class="watch-controls"><button class="primary-button" type="submit">저장</button>${existing?`<button class="ghost-button danger-button" type="button" id="uk-delete">삭제</button>`:''}<button class="ghost-button" type="button" data-close-modal>취소</button></div></form></div></div></div>`;
  const form=$('#user-korean-form');
  form.onsubmit=e=>{e.preventDefault();const title=$('#uk-title').value.trim();const overview=$('#uk-overview').value.trim();const url=$('#uk-url').value.trim();if(!title&&!overview){toast('제목 또는 소개를 입력해 주세요.','error');return;}setUserKorean(media,{title,overview,url});toast('한국어 자료를 저장했습니다.');root.innerHTML='';state.currentModal={media};renderDetailModal(media);};
  $('#uk-delete')?.addEventListener('click',()=>{deleteUserKorean(media);toast('사용자 입력 자료를 삭제했습니다.');root.innerHTML='';state.currentModal={media};renderDetailModal(media);});
};

function renderDetailModal(m,mal=null,options={}){
  const root=$('#modal-root');const id=m.id;const saved=state.watchlist.find(x=>String(x.media_id)===String(id));const originalDesc=cleanDescription(m.description||'작품 설명이 등록되지 않았습니다.');
  const originalTitle=localizedTitleSource(m);const koreanTitle=localizedTitle(m);const koreanDescInfo=koreanDescriptionInfo(m);const koreanDesc=koreanDescInfo?.overview||'';const descriptionBadge=koreanDescInfo?.kind==='curated'?'국내 카탈로그 기반 요약':koreanDescInfo?.kind==='user'?'사용자 입력 소개':koreanDescInfo?'한국어 등록 소개':'한국어 소개 미등록 · 원문 표시';const displayedDesc=koreanDesc||cleanDescription(m.description||'작품 설명이 등록되지 않았습니다.');const native=m.title?.native||'';const english=m.title?.english||'';const romaji=m.title?.romaji||'';
  const originalNames=[native,english,romaji].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' · ');
  const relationMarkup=detailRelationsMarkup(m);
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal"><div class="modal-top"><button class="close-button" data-close-modal aria-label="닫기">×</button></div>
  <div class="detail-hero"><img class="detail-cover" src="${esc(posterOf(m))}" alt="${esc(originalTitle)}" loading="lazy" decoding="async" onerror="this.style.opacity='.2'"><div><div class="eyebrow">${esc(formatOf(m))} · ${esc(yearOf(m))}</div><h2 class="detail-title" data-translate-title>${esc(koreanTitle)}</h2><div class="detail-native">원제: ${esc(originalNames||originalTitle)}</div><div class="detail-stats"><span class="stat-chip"><strong>★ ${((m.averageScore||0)/10).toFixed(1)}</strong>AniList</span><span data-detail-mal></span><span class="stat-chip">${esc(statusOf(m.status))}</span>${m.episodes?`<span class="stat-chip">${m.episodes}화</span>`:''}<span class="stat-chip">인기 ${Number(m.popularity||0).toLocaleString('ko-KR')}</span></div><div class="tag-list">${(m.genres||[]).map(g=>`<span class="genre-tag">${esc(GENRE_LABELS[g]||g)}</span>`).join('')}</div><div class="card-meta">제작사: ${detailStudiosMarkup(m)}</div><div class="detail-actions"><select class="status-select" id="detail-status"><option value="">시청 상태 선택</option>${STATUSES.map(([s,l])=>`<option value="${s}" ${saved?.status===s?'selected':''}>${l}</option>`).join('')}</select><button class="secondary-button" data-save-anime="${esc(id)}">${saved?'목록 업데이트':'내 보관함에 추가'}</button><select class="status-select" id="detail-collection-select"><option value="">컬렉션 선택</option>${state.collections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><button class="ghost-button" data-add-collection="${esc(id)}">컬렉션에 담기</button><button class="ghost-button" data-create-collection-detail="${esc(id)}">새 컬렉션 만들기</button><a class="secondary-button" href="${esc(m.siteUrl||'#')}" target="_blank" rel="noopener">원본 정보 ↗</a><a class="ghost-button" href="https://www.google.com/search?q=${encodeURIComponent((koreanTitle||originalTitle||'')+' 굿즈 피규어')}" target="_blank" rel="noopener">굿즈 검색 ↗원본 정보 ↗</a></div></div></div>
  <div class="detail-body"><section class="detail-section"><h3>작품 소개 <span class="translation-badge">${esc(descriptionBadge)}</span></h3><div class="detail-desc" data-translate-description>${esc(displayedDesc)}</div><details class="translation-original"><summary>${koreanDesc?'원문 보기':'원문 정보'}</summary><div class="detail-desc" data-translation-original-content>${esc(originalDesc.slice(0,5000))}${originalDesc.length>5000?'…':''}</div></details><p class="translation-note" data-korean-metadata-source>${koreanMetadataSourceMarkup(m)}</p><button class="ghost-button" id="retry-korean-translation" type="button">한국어 등록 정보 다시 조회</button> <button class="ghost-button" id="user-korean-input" type="button">한국어 제목 직접 입력</button></section>
  <section class="detail-section"><h3>방영 · 제작 정보</h3><div class="detail-desc" data-detail-production-info>${detailProductionMarkup(m)}</div></section>
  <section class="detail-section similar-section"><h3>비슷한 작품</h3><button class="ghost-button" id="load-similar-works">비슷한 작품 찾기</button><div id="similar-works-results"></div></section><div data-detail-relations>${relationMarkup}</div>${options.extrasLoading?`<section class="detail-section" data-detail-extras><h3>등장인물 · 제작진</h3><p class="muted">기본 정보를 표시했습니다. 인물 및 제작진 정보를 이어서 불러오고 있습니다...</p></section>`:detailExtrasMarkup(m)}
  <p class="source-footnote">정보 출처: AniList · MyAnimeList/Jikan · TMDB(선택 설정) · 일부 국내 서비스 카탈로그를 확인해 정리한 한국어 자료. 한국어 제목 별칭과 한국어 줄거리는 출처와 신뢰 수준을 구분해 표시하며, 등록되지 않은 줄거리는 원문 그대로 제공합니다.</p></div></div></div>`;
  const descriptionNode=$('[data-translate-description]');
  localizeMarked(root);
  if(descriptionNode){descriptionNode.dataset.descriptionKind=koreanDesc?'localized':'original';}
  loadKoreanMetadataIntoDetail(m).catch(error=>console.warn('Korean title/description lookup failed:',error));
  if(mal){const scoreNode=$('[data-detail-mal]');if(scoreNode&&mal.score)scoreNode.innerHTML=`<span class="stat-chip"><strong>★ ${esc(mal.score)}</strong>MyAnimeList</span>`;const rank=$('[data-detail-rank]'),source=$('[data-detail-source]');if(rank)rank.textContent=mal.rank?`#${mal.rank}`:'정보 없음';if(source)source.textContent=mal.source||'정보 없음';}
}


async function loadSimilarWorks(){
  const media=state.currentModal?.media;const target=$('#similar-works-results');const button=$('#load-similar-works');if(!media||!target)return;
  if(button){button.disabled=true;button.textContent='찾는 중...';}
  setLoading(target,'비슷한 작품을 찾고 있습니다.');
  try{
    const genres=(media.genres||[]).slice(0,4);
    const page=await fetchAnimeList({page:1,perPage:30,genres,sort:['TRENDING_DESC']});
    const results=(page.media||[]).filter(item=>String(item.id)!==String(media.id)).slice(0,6);
    target.innerHTML=results.length?gridMarkup(results,false):'<div class="empty-state"><span>장르가 비슷한 작품을 찾지 못했습니다.</span></div>';
    localizeMarked(target);hydrateKoreanCardTitles(results,target,6);
  }catch(error){target.innerHTML=`<div class="empty-state"><strong>비슷한 작품을 찾지 못했습니다.</strong><span>${esc(error.message)}</span></div>`;}
  finally{if(button){button.disabled=false;button.textContent='다시 찾기';}}
}

function saveAnimeToList(media,status){
  if(!media||media.id==null){toast('작품 식별 정보가 없어 저장할 수 없습니다.','error');return false;}
  if(!status||!STATUSES.some(([key])=>key===status)){toast('시청 상태를 선택해 주세요.','error');return false;}
  const key=String(media.id);const existing=state.watchlist.find(x=>String(x.media_id)===key);
  const snapshot=compactMediaSnapshot(media);
  const item={user_id:state.user?.id||null,media_id:media.id,idMal:media.idMal||media.mal_id||null,status,score:existing?.score??null,note:existing?.note||'',media_snapshot:snapshot,updated_at:new Date().toISOString()};
  state.watchlist=state.watchlist.filter(x=>String(x.media_id)!==key);state.watchlist.unshift(item);
  try{saveLocalList();}catch(error){state.watchlist=state.watchlist.filter(x=>String(x.media_id)!==key);if(existing)state.watchlist.push(existing);toast('브라우저 저장 공간에 기록하지 못했습니다.','error');return false;}
  if(state.supabase&&state.user&&Number.isInteger(Number(media.id))&&!String(media.id).startsWith('mal:')){
    syncUpsert(item).then(()=>toast('보관함과 계정 동기화가 완료됐습니다.')).catch(e=>toast(`이 기기에는 저장했지만 계정 동기화는 실패했습니다: ${e.message}`,'error'));
  }else if(state.supabase&&state.user&&String(media.id).startsWith('mal:')){
    toast('이 작품은 이 기기에 저장했습니다. 외부 DB 작품은 계정 동기화에서 제외됩니다.');
  }else toast('내 보관함에 저장했습니다.');
  const saveButton=$(`[data-save-anime="${key.replace(/\"/g,'\\\"')}"]`,$('#modal-root'));
  if(saveButton)saveButton.textContent='목록 업데이트';
  if(state.route==='watchlist')renderWatchlist();
  if(state.route==='stats')renderStats();
  if(state.route==='recommend')renderRecommendations();
  return true;
}

async function syncUpsert(item){const {error}=await state.supabase.from('anime_lists').upsert({...item,user_id:state.user.id,client_id:getClientId(),deleted_at:null},{onConflict:'user_id,media_id'});if(error)throw error;}
async function syncDelete(id){if(!state.supabase||!state.user)return;const clientId=getClientId();const now=new Date().toISOString();const {error:tombstoneError}=await state.supabase.from('anime_lists').update({deleted_at:now,client_id:clientId,updated_at:now}).eq('user_id',state.user.id).eq('media_id',id).is('deleted_at',null);if(!tombstoneError)return;if(/column .* does not exist|deleted_at/i.test(tombstoneError.message||'')){const {error}=await state.supabase.from('anime_lists').delete().eq('user_id',state.user.id).eq('media_id',id);if(error)throw error;return;}throw tombstoneError;}
function syncUserDataQuietly(){if(state.supabase&&state.user)syncUserData().catch(error=>{state.syncStatus='error';console.warn('Cloud collections/search sync failed:',error);if(!state.cloudProfileWarned){state.cloudProfileWarned=true;toast('컬렉션·검색 조건 클라우드 동기화에 실패했습니다. Supabase에 최신 schema.sql을 적용했는지 확인해 주세요.','error');}});}
async function syncUserData(){
  if(!state.supabase||!state.user)return;
  state.syncStatus='syncing';
  const payload={user_id:state.user.id,collections:state.collections,saved_searches:state.savedSearches,updated_at:new Date().toISOString(),client_id:getClientId()};
  const {error}=await state.supabase.from('anime_user_data').upsert(payload,{onConflict:'user_id'});if(error){state.syncStatus='error';throw error;}state.syncStatus='ok';updateAccountButton();
}
function mergeWatchlist(localItems,cloudItems){
  const normalizeId=value=>typeof value==='string'&&value.startsWith('mal:')?value:Number(value);
  const map=new Map((cloudItems||[]).map(item=>[String(item.media_id),{...item,media_id:normalizeId(item.media_id)}]));
  for(const item of localItems||[]){const key=String(item.media_id);const old=map.get(key);const a=Date.parse(item.updated_at||0)||0,b=Date.parse(old?.updated_at||0)||0;if(!old||a>=b)map.set(key,{...item,media_id:normalizeId(item.media_id)});}
  return [...map.values()].sort((a,b)=>(Date.parse(b.updated_at||0)||0)-(Date.parse(a.updated_at||0)||0));
}
function recordUpdatedAt(item){
  const raw=item?.updatedAt||item?.updated_at||item?.savedAt||item?.createdAt||item?.created_at||'';
  return Date.parse(raw)||0;
}
function mergeById(localItems,cloudItems){
  const map=new Map((cloudItems||[]).filter(x=>x?.id!=null).map(x=>[String(x.id),x]));
  for(const item of localItems||[]){
    if(item?.id==null)continue;
    const key=String(item.id),old=map.get(key);
    if(!old||recordUpdatedAt(item)>=recordUpdatedAt(old))map.set(key,item);
  }
  return [...map.values()];
}
async function syncFromCloud(){
  if(!state.supabase||!state.user)return;
  state.syncStatus='syncing';
  const currentUserId=state.user.id;const previousOwner=localStorage.getItem(LOCAL_OWNER_KEY);
  const sameOrAnonymous=!previousOwner||previousOwner===currentUserId;
  const localList=loadLocalList(),localCollections=loadCollections(),localSearches=loadSavedSearches();
  const [{data:listData,error:listError},{data:userData,error:userDataError}]=await Promise.all([
    state.supabase.from('anime_lists').select('*').order('updated_at',{ascending:false}),
    state.supabase.from('anime_user_data').select('collections,saved_searches').eq('user_id',currentUserId).maybeSingle()
  ]);
  if(listError)throw listError;
  if(userDataError){console.warn('Cloud collection/search data is not available. Apply the updated Supabase schema.sql:',userDataError);if(!state.cloudProfileWarned){state.cloudProfileWarned=true;toast('보관함은 동기화되지만 컬렉션·검색 조건 동기화에는 최신 Supabase SQL이 필요합니다.','error');}}
  const cloudList=(listData||[]).map(x=>({...x,media_id:Number(x.media_id)}));
  const deletedIds=new Set((listData||[]).filter(x=>x.deleted_at).map(x=>String(x.media_id)));
  const localWithoutDeleted=localList.filter(x=>!deletedIds.has(String(x.media_id)));
  const mergeResult=sameOrAnonymous?mergeWatchlistWithConflicts(localWithoutDeleted,cloudList.filter(x=>!x.deleted_at)): {merged: cloudList.filter(x=>!x.deleted_at), conflicts:[]};
  state.watchlist=mergeResult.merged;
  state.pendingConflicts=mergeResult.conflicts||[];
  if(state.pendingConflicts.length) showConflictModal(state.pendingConflicts);
  const cloudCollections=Array.isArray(userData?.collections)?userData.collections:[];
  const cloudSearches=Array.isArray(userData?.saved_searches)?userData.saved_searches:[];
  state.collections=sameOrAnonymous?mergeById(localCollections,cloudCollections):cloudCollections;
  state.savedSearches=sameOrAnonymous?mergeById(localSearches,cloudSearches):cloudSearches;
  saveLocalList();localStorage.setItem(LOCAL_COLLECTION_KEY,JSON.stringify(state.collections));localStorage.setItem(SAVED_SEARCH_KEY,JSON.stringify(state.savedSearches));
  localStorage.setItem(LOCAL_OWNER_KEY,currentUserId);
  state.syncStatus='ok';
  if(sameOrAnonymous){
    const importable=state.watchlist.filter(item=>Number.isInteger(Number(item.media_id))&&!String(item.media_id).startsWith('mal:'));
    for(const item of importable){try{await syncUpsert(item);}catch(error){console.warn('Initial local watchlist merge failed:',error);}}
    if(!userDataError){try{await syncUserData();}catch(error){console.warn('Initial cloud user-data merge failed:',error);}}
  }
}

async function loadSupabase(){
  const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');if(!cfg.url||!cfg.key)return;
  try{
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');
    state.supabase=createClient(cfg.url,cfg.key);
    const {data:{session}}=await state.supabase.auth.getSession();
    state.user=session?.user||null;
    state.supabase.auth.onAuthStateChange((event,session)=>{
      state.user=session?.user||null;updateAccountButton();
      // Sign-in and initial-session synchronization are awaited by their respective handlers.
      // This listener only clears the visible local view after sign-out, preventing duplicate merge races.
      if(event==='SIGNED_OUT'){
        state.watchlist=[];state.collections=[];state.savedSearches=[];saveLocalList();
        localStorage.setItem(LOCAL_COLLECTION_KEY,'[]');localStorage.setItem(SAVED_SEARCH_KEY,'[]');
        if(['watchlist','collections','stats','recommend'].includes(state.route))renderRoute();
      }
    });
    if(state.user){try{await syncFromCloud();}catch(error){state.supabaseError=error.message;toast(`클라우드 목록을 읽을 수 없습니다. SQL 설정을 확인해 주세요: ${error.message}`,'error');}}
    updateAccountButton();
  }catch(error){state.supabaseError=error.message;state.supabase=null;console.warn('Supabase unavailable:',error);}
}
function updateAccountButton(){const label=$('#account-label');if(label){const base=state.user?(state.user.email?.split('@')[0]||'내 계정'):(state.supabase?'계정 동기화':'로컬 저장');const statusSuffix=state.user?(state.syncStatus==='error'?' · 동기화 오류':state.syncStatus==='syncing'?' · 동기화 중':''):'';label.textContent=base+statusSuffix;}const avatar=$('.avatar');if(avatar)avatar.textContent=state.user?(state.user.email?.[0]||'U').toUpperCase():'U';}
function showAuth(){
  let mode='login';const root=$('#modal-root');
  const draw=()=>{root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" style="max-width:460px"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="auth-wrap"><div class="eyebrow">계정 · 기기 간 동기화</div><h2>${state.user?'계정 정보':'ANIME HUB 계정'}</h2><p class="page-subtitle">로그인하면 PC·모바일에서 보관함, 컬렉션, 저장 검색 조건을 계정별로 동기화합니다.</p>${state.user?`<div class="account-status"><div><b>${esc(state.user.email)}</b><small>클라우드 동기화 사용 중</small></div><span class="live-dot"></span></div><button class="primary-button" id="sign-out" style="width:100%">로그아웃</button>`:`${!state.supabase?`<div class="warning-box">계정 동기화를 시작하려면 먼저 데이터·계정 설정에서 Supabase 프로젝트 URL과 공개 키를 등록해야 합니다. 로컬 보관함은 지금도 사용할 수 있습니다.</div>`:''}<div class="auth-tabs"><button data-auth-mode="login" class="${mode==='login'?'active':''}">로그인</button><button data-auth-mode="signup" class="${mode==='signup'?'active':''}">회원가입</button></div><form class="auth-form" id="auth-form"><label>이메일<input type="email" id="auth-email" required placeholder="you@example.com" autocomplete="email"></label><label>비밀번호<input type="password" id="auth-password" required minlength="6" placeholder="6자 이상" autocomplete="current-password"></label><button class="primary-button" type="submit" ${!state.supabase?'disabled':''}>${mode==='login'?'로그인':'계정 만들기'}</button></form><p class="hint">회원가입 후 이메일 인증이 필요한 경우, 인증을 완료한 다음 로그인하세요. 비밀번호는 이 앱에 저장하지 않고 Supabase 인증 시스템에서 처리합니다.</p>`}</div></div></div>`;};
  draw();root.dataset.mode=mode;
  root.onclick=async e=>{
    const tab=e.target.closest('[data-auth-mode]');
    if(tab){mode=tab.dataset.authMode;draw();return;}
    if(e.target.id==='sign-out' && state.supabase){await state.supabase.auth.signOut();state.user=null;state.watchlist=[];state.collections=[];state.savedSearches=[];saveLocalList();localStorage.setItem(LOCAL_COLLECTION_KEY,'[]');localStorage.setItem(SAVED_SEARCH_KEY,'[]');updateAccountButton();toast('로그아웃했습니다.');root.innerHTML='';if(state.route==='watchlist')renderWatchlist();}
  };
  root.onsubmit=async e=>{if(e.target.id!=='auth-form')return;e.preventDefault();if(!state.supabase)return;const email=$('#auth-email').value.trim(),password=$('#auth-password').value;const btn=$('button[type="submit"]',e.target);btn.disabled=true;btn.textContent='처리 중...';try{let result;if(mode==='signup')result=await state.supabase.auth.signUp({email,password});else result=await state.supabase.auth.signInWithPassword({email,password});if(result.error)throw result.error;if(mode==='signup'&&!result.data.session){toast('가입 요청을 보냈습니다. 이메일 인증 후 로그인해 주세요.');root.innerHTML='';}else{state.user=result.data.user;await syncFromCloud();updateAccountButton();toast('로그인했습니다.');root.innerHTML='';renderRoute();}}catch(error){toast(error.message||'인증에 실패했습니다.','error');btn.disabled=false;btn.textContent=mode==='login'?'로그인':'계정 만들기';}};
}
function showConflictModal(conflicts){
  if(!conflicts?.length)return;
  const root=$('#modal-root');
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" style="max-width:560px"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="settings-wrap"><div class="eyebrow">동기화 충돌</div><h2>같은 항목이 두 기기에서 바뀌었습니다</h2><p class="page-subtitle">아래 항목은 이 기기와 클라우드의 값이 동시에 바뀌었습니다. 사용할 값을 선택해 주세요.</p>${conflicts.map((c,idx)=>`<section class="detail-section"><h3>작품 #${esc(c.local?.media_id||c.key)}</h3><div class="watch-controls"><button class="ghost-button" data-conflict-choice="local" data-conflict-index="${idx}">이 기기 값 사용 (상태: ${esc(c.local?.status||'')})</button><button class="ghost-button" data-conflict-choice="remote" data-conflict-index="${idx}">클라우드 값 사용 (상태: ${esc(c.remote?.status||'')})</button></div></section>`).join('')}</div></div></div>`;
  root.onclick=e=>{
    const btn=e.target.closest('[data-conflict-choice]');
    if(!btn)return;
    const idx=Number(btn.dataset.conflictIndex);
    const choice=btn.dataset.conflictChoice;
    const conflict=state.pendingConflicts[idx];
    if(!conflict)return;
    const winner=choice==='local'?conflict.local:conflict.remote;
    const map=new Map(state.watchlist.map(x=>[String(x.media_id),x]));
    map.set(String(winner.media_id),{...winner});
    state.watchlist=[...map.values()];
    saveLocalList();
    state.pendingConflicts=state.pendingConflicts.filter((_,i)=>i!==idx);
    if(state.pendingConflicts.length)showConflictModal(state.pendingConflicts);else{root.innerHTML='';toast('충돌을 해결했습니다.');if(state.route==='watchlist')renderWatchlist();}
  };
}

function showSettings(){
  const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');const tmdbCfg=loadTMDBConfig();const root=$('#modal-root');
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" style="max-width:610px"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="settings-wrap"><div class="eyebrow">설정</div><h2>데이터 · 계정 설정</h2><p class="page-subtitle">기본 작품 정보는 AniList에서 제공하며, MyAnimeList 점수와 상세 정보는 Jikan을 통해 보완합니다.</p><section class="detail-section"><h3>계정 동기화 · Supabase</h3><div class="${state.supabase?'success-box':'warning-box'}">${state.supabase?'Supabase 연결이 설정되어 있습니다. 로그인하면 보관함·컬렉션·저장 검색 조건이 계정별로 동기화됩니다.':'Supabase 연결 정보가 필요합니다. 아래에 프로젝트 정보를 입력하면 이메일 계정과 클라우드 저장 기능을 사용할 수 있습니다.'}</div><form class="settings-form" id="settings-form"><label>Project URL<input id="supabase-url" type="url" placeholder="https://your-project.supabase.co" value="${esc(cfg.url||'')}"></label><label>Publishable key 또는 anon key<input id="supabase-key" type="password" placeholder="sb_publishable_... 또는 anon key" value="${esc(cfg.key||'')}"></label><button class="primary-button" type="submit">연결 정보 저장 및 연결</button></form><p class="hint">Supabase 대시보드의 Project URL과 공개용 publishable key(또는 legacy anon key)를 입력하세요. <b>service_role 키는 절대 입력하지 마세요.</b> 연결 후 최신 supabase/schema.sql을 Supabase SQL Editor에서 실행해야 보관함·컬렉션·검색 조건을 계정별로 저장할 수 있습니다.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noopener" class="text-link">Supabase 대시보드 열기 ↗</a></section><section class="detail-section"><h3>한국어 작품명 · 줄거리 정보</h3><p class="detail-desc">작품 제목과 소개는 각각 별도로 한국어 자료를 확인합니다. 국내 플랫폼 카탈로그를 직접 대조해 정리한 일부 대표작 자료, 사전 수확 한국어 제목 DB, AniList 한글 별칭, MyAnimeList/Jikan 한글 대체 제목, TMDB 한국어 등록 번역(대한민국 KR 우선), 나무위키·한국어 위키백과에서 확인된 한국어 표기를 출처별로 구분해 사용합니다. 한국어 제목이 없으면 원제를 유지하고, 한국어 소개가 확인되지 않으면 원문을 보여줍니다. 별칭과 TMDB 번역은 국내 판권사의 최종 공식 표기와 다를 수 있습니다. 검색어 입력을 보조하는 경우 외에는 제목·줄거리·인물명·제작사명을 기계 번역하지 않습니다.</p><form class="settings-form" id="tmdb-settings-form"><label>TMDB Read Access Token (v4)<input id="tmdb-read-token" type="password" placeholder="TMDB API Read Access Token" value="${esc(tmdbCfg.readAccessToken||'')}" autocomplete="off"></label><button class="primary-button" type="submit">한국어 데이터 연결 저장</button></form><p class="hint">TMDB 계정의 API 설정에서 v4 Read Access Token을 발급해 입력하세요. 토큰은 현재 브라우저의 로컬 저장소에만 보관됩니다. 대한민국(KR) 지역의 한국어 번역이 있으면 우선 사용하고, 없으면 다른 지역의 한국어 번역도 출처 국가를 구분해 사용할 수 있습니다. TMDB 등록 정보가 국내 판권사·방송사의 최종 정식 표기와 모든 경우에 일치한다고 보장되지는 않습니다. 작품 상세의 출처 링크에서 등록 내용을 직접 확인할 수 있습니다.</p><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" class="text-link">TMDB API 설정 열기 ↗</a></section><section class="detail-section"><h3>Gemini AI · 나무위키 검색 보조 (선택)</h3><p class="detail-desc">Google Gemini 무료 API 키를 입력하면, 한국어 자료가 없는 작품의 <b>나무위키 검색 후보(한국어 제목)</b>를 만드는 데에만 사용합니다. AI가 만든 번역을 화면에 표시하지 않으며, 나무위키·한국어 위키백과에서 실제 문서가 확인된 경우에만 그 제목·소개를 사용합니다. 키가 없으면 원제로 나무위키·한국어 위키백과를 직접 검색합니다.</p><form class="settings-form" id="gemini-settings-form"><label>Gemini API Key<input id="gemini-key" type="password" placeholder="AIzaSy..." value="${esc(getGeminiKey())}" autocomplete="off"></label><button class="primary-button" type="submit">저장</button></form><p class="hint">무료 tier: 15 req/min, 1M tokens/day. API 키는 이 브라우저에만 저장되며, 나무위키 검색 보조 외에는 사용되지 않습니다.</p></section><section class="detail-section"><h3>데이터 출처 · Credits</h3><div class="detail-desc">AniList: 작품·방영·장르·제작사·인물·연관 작품 및 한글 별칭<br>Jikan / MyAnimeList: 보조 평점·순위·일부 설명<br>TMDB: 선택 설정 시 한국어 작품명·줄거리 및 작품별 번역 목록(대한민국 KR 우선, 다른 국가 자료는 구분 표시)<br>국내 카탈로그 수동 확인: 일부 대표 작품의 한국어 제목·줄거리<br>나무위키: 1차 한국어 제목·소개 보조(문서가 확인된 경우에 한함)<br>한국어 위키백과: 나무위키 조회 실패 시 한국어 제목·소개 보조(애니메이션·만화 문서로 확인된 경우)<br>화면 제목 우선순위: 수동 확인 국내 카탈로그 → 사용자 입력 → 사전 수확 한국어 제목 DB → TMDB 한국어 등록 정보 → AniList 한글 별칭 → MAL 한글 대체 제목 → 나무위키 확인 문서 → 한국어 위키백과 확인 문서 → 원제<br>줄거리 우선순위: 수동 확인 국내 카탈로그 → 사용자 입력 → 사전 수확 한국어 소개 → TMDB 한국어 등록 소개 → MAL 한국어 소개 → 나무위키 확인 문서 → 한국어 위키백과 확인 문서 → 원문<br><br>데이터베이스 전체를 한 번에 내려받는 방식은 아닙니다. 검색과 페이지 이동을 통해 원본 DB의 공개 데이터를 조회합니다. 각 API의 요청 제한과 가용성에 따라 일부 항목은 늦게 표시될 수 있습니다.</div><div class="tmdb-attribution"><a href="https://www.themoviedb.org" target="_blank" rel="noopener" aria-label="The Movie Database"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg" alt="TMDB"></a><div><b>한국어 현지화 정보 제공 · TMDB</b><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><a href="https://www.themoviedb.org/about/logos-attribution" target="_blank" rel="noopener" class="text-link">TMDB 로고 및 출처 표시 안내 ↗</a></div></div></section><section class="detail-section"><h3>내 데이터</h3><button class="ghost-button" id="export-list">보관함 JSON 내보내기</button> <button class="ghost-button" id="export-collections">컬렉션 JSON 내보내기</button> <button class="ghost-button" id="export-all-data">전체 백업 다운로드</button> <button class="ghost-button" id="import-all-data">백업 복원</button><input type="file" id="import-backup-file" accept="application/json,.json" hidden> <button class="ghost-button" id="clear-local">이 기기 보관함 비우기</button></section></div></div></div>`;
  root.addEventListener('change',e=>{if(e.target.id==='import-backup-file')importAllData(e.target.files?.[0]);});
  root.onsubmit=async e=>{if(e.target.id==='tmdb-settings-form'){e.preventDefault();const readAccessToken=$('#tmdb-read-token').value.trim();if(readAccessToken){localStorage.setItem(TMDB_CONFIG_KEY,JSON.stringify({readAccessToken}));toast('한국어 현지화 데이터 연결을 저장했습니다.');}else{localStorage.removeItem(TMDB_CONFIG_KEY);toast('TMDB 연결을 해제했습니다.');}localStorage.removeItem(KOREAN_METADATA_CACHE_KEY);showSettings();return;}if(e.target.id==='gemini-settings-form'){e.preventDefault();const key=$('#gemini-key').value.trim();setGeminiKey(key);toast(key?'Gemini API 키를 저장했습니다.':'Gemini API 키를 삭제했습니다.');showSettings();return;}if(e.target.id!=='settings-form')return;e.preventDefault();const url=$('#supabase-url').value.trim().replace(/\/$/,''),key=$('#supabase-key').value.trim();if(!url||!key){toast('Project URL과 공개 키를 모두 입력해 주세요.','error');return;}try{new URL(url);}catch{toast('Project URL 형식이 올바르지 않습니다.','error');return;}localStorage.setItem(CONFIG_KEY,JSON.stringify({url,key}));state.supabase=null;state.user=null;await loadSupabase();if(state.supabase){toast('Supabase 연결 정보를 저장했습니다.');showSettings();}else toast(`연결 실패: ${state.supabaseError||'설정을 확인해 주세요.'}`,'error');};
  root.onclick=e=>{if(e.target.id==='export-all-data'){exportAllData();}if(e.target.id==='import-all-data')$('#import-backup-file')?.click();if(e.target.id==='import-backup-file')return;if(e.target.id==='export-list'){const blob=new Blob([JSON.stringify(state.watchlist,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='anime-hub-watchlist.json';a.click();URL.revokeObjectURL(a.href);}if(e.target.id==='export-collections'){const blob=new Blob([JSON.stringify(state.collections,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='anime-hub-collections.json';a.click();URL.revokeObjectURL(a.href);}if(e.target.id==='clear-local'){if(confirm('이 기기에 저장된 보관함을 삭제할까요? 클라우드 데이터는 삭제하지 않습니다.')){state.watchlist=[];saveLocalList();toast('이 기기의 보관함을 비웠습니다.');root.innerHTML='';if(state.route==='watchlist')renderWatchlist();}}};
}

// Event delegation
$('#main-content').addEventListener('click',async e=>{
  const route=e.target.closest('[data-route]');if(route){e.preventDefault();navigate(route.dataset.route);return;}
  const retry=e.target.closest('[data-retry]');if(retry){renderRoute();return;}
  const load=e.target.closest('#load-more');if(load){runBrowseSearch(state.page+1,true);return;}
  const add=e.target.closest('[data-add]');if(add){const m=knownMedia(add.dataset.add);if(m)saveAnimeToList(m,'PLANNING');else toast('작품 정보를 찾지 못했습니다. 상세 화면에서 다시 시도해 주세요.','error');return;}
  const open=e.target.closest('[data-open]');if(open){openAnime(open.dataset.open);return;}
  const studio=e.target.closest('[data-studio]');if(studio){showStudioWorks(studio.dataset.studio,studio.dataset.studioName);return;}
  const person=e.target.closest('[data-person]');if(person){showPersonWorks(person.dataset.person,person.dataset.personName);return;}
  const watchFilter=e.target.closest('[data-watch-filter]');if(watchFilter){state.watchStatusFilter=watchFilter.dataset.watchFilter==='ALL'?'':watchFilter.dataset.watchFilter;renderWatchlist();return;}
  const quickStatus=e.target.closest('[data-quick-status]');if(quickStatus){const current=readBrowseFilters();if(!current)return;state.filters=current;state.query=$('#filter-search')?.value.trim()||'';state.filters.status=quickStatus.dataset.quickStatus;$('#global-search').value=state.query;renderBrowseShell();runBrowseSearch(1,false);return;}
  const genreButton=e.target.closest('[data-genre]');if(genreButton){const genre=genreButton.dataset.genre;const selected=new Set(state.filters.genres||[]);selected.has(genre)?selected.delete(genre):selected.add(genre);state.filters.genres=[...selected];genreButton.classList.toggle('active',selected.has(genre));genreButton.setAttribute('aria-pressed',String(selected.has(genre)));$('#filter-active-count').textContent=`필터 ${activeFilterCount(state.filters)}개 적용 중`;return;}
  if(e.target.id==='apply-filters'){const next=readBrowseFilters();if(!next)return;state.query=$('#filter-search').value.trim();state.filters=next;$('#global-search').value=state.query;runBrowseSearch(1,false);return;}
  if(e.target.id==='reset-filters'){state.query='';state.filters=defaultFilters();$('#global-search').value='';renderBrowse();return;}
  if(e.target.id==='save-search'){saveCurrentSearch();return;}
  if(e.target.id==='load-saved-search'){loadSavedSearch();return;}
  if(e.target.id==='delete-saved-search'){deleteSavedSearch();return;}
  if(e.target.id==='refresh-results'){runBrowseSearch(1,false,true);return;}
  if(e.target.id==='studio-search-button'){searchStudios($('#studio-search').value.trim());return;}
  if(e.target.id==='people-search-button'){searchPeople($('#people-search').value.trim());return;}
  if(e.target.id==='create-collection'){createCollectionPrompt();renderCollections();return;}
  const deleteCollection=e.target.closest('[data-delete-collection]');if(deleteCollection){deleteCollectionById(deleteCollection.dataset.deleteCollection);return;}
  const openCollection=e.target.closest('[data-open-collection]');if(openCollection){state.activeCollectionId=openCollection.dataset.openCollection;renderCollectionDetail(state.activeCollectionId);return;}
  if(e.target.id==='back-collections'){renderCollections();return;}
if(e.target.id==='share-collection'){
  const id=new URLSearchParams(location.hash.includes('?')?location.hash.split('?')[1]:'').get('c')||state.currentCollectionId;
  const collection=state.collections.find(x=>x.id===id)||state.collections[0];
  if(!collection){toast('공유할 컬렉션이 없습니다.','error');return;}
  const url=`${location.origin}${location.pathname}#collection:${collection.id}`;
  if(navigator.clipboard){navigator.clipboard.writeText(url).then(()=>toast('공유 링크를 복사했습니다.'));}else{prompt('공유 링크',url);}
  return;
}
  const removeCollection=e.target.closest('[data-remove-collection-item]');if(removeCollection){removeMediaFromCollection(removeCollection.dataset.removeCollectionItem,removeCollection.dataset.mediaId);return;}
  const removeWatch=e.target.closest('[data-remove-watch]');if(removeWatch){removeWatchlistItem(removeWatch.dataset.removeWatch);return;}
  const saveWatch=e.target.closest('[data-save-watch-edit]');if(saveWatch){updateWatchlistItem(saveWatch.dataset.saveWatchEdit);return;}
  if(e.target.id==='enable-release-alerts'){enableReleaseAlerts();return;}
  if(e.target.id==='refresh-recommendations'){renderRecommendations(true);return;}
  if(e.target.id==='random-recommendation'){const pool=state.recommendedMedia.filter(Boolean);if(pool.length){const picked=pool[Math.floor(Math.random()*pool.length)];openAnime(picked.id);}else toast('먼저 추천 작품을 불러와 주세요.','error');return;}
  if(e.target.id==='back-franchise-detail'){if(state.franchiseFocus){state.currentModal={media:state.franchiseFocus};renderDetailModal(state.franchiseFocus);}return;}
});
$('#main-content').addEventListener('change',e=>{const status=e.target.closest('[data-watch-status]');if(status){const item=state.watchlist.find(x=>String(x.media_id)===status.dataset.watchStatus);if(item){item.status=status.value;item.updated_at=new Date().toISOString();saveLocalList();toast('시청 상태를 변경했습니다.');}}});
$('#main-content').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='filter-search'){e.preventDefault();$('#apply-filters')?.click();return;}if(e.key==='Enter'&&e.target.id==='studio-search'){e.preventDefault();searchStudios(e.target.value.trim());return;}if(e.key==='Enter'&&e.target.id==='people-search'){e.preventDefault();searchPeople(e.target.value.trim());return;}if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-open]')){e.preventDefault();openAnime(e.target.dataset.open);}});
$('#modal-root').addEventListener('click',async e=>{
  const backdrop=e.target.matches('.modal-backdrop');
  const closeButton=e.target.closest('.close-button');
  if(backdrop||closeButton){$('#modal-root').innerHTML='';state.currentModal=null;return;}
  if(e.target.closest('#retry-korean-translation')){
    if(state.currentModal?.media){await loadKoreanMetadataIntoDetail(state.currentModal.media,{force:true});toast('한국어 등록 정보를 다시 조회했습니다.');}return;
  }
  if(e.target.closest('#user-korean-input')){
    if(state.currentModal?.media)showUserKoreanModal(state.currentModal.media);return;
  }
  if(e.target.closest('#load-similar-works')){loadSimilarWorks();return;}
  if(e.target.closest('#open-franchise-map')){const media=state.currentModal?.media;if(media)renderFranchisePage(media);return;}
  const studioLink=e.target.closest('[data-studio]');if(studioLink){const id=studioLink.dataset.studio,name=studioLink.dataset.studioName||'';$('#modal-root').innerHTML='';showStudioWorks(id,name);return;}
  const personLink=e.target.closest('[data-person]');if(personLink){const id=personLink.dataset.person,name=personLink.dataset.personName||'';$('#modal-root').innerHTML='';showPersonWorks(id,name);return;}
  const save=e.target.closest('[data-save-anime]');
  if(save){e.preventDefault();const status=$('#detail-status')?.value;if(!status){toast('먼저 시청 상태를 선택해 주세요.','error');return;}if(state.currentModal?.media)saveAnimeToList(state.currentModal.media,status);return;}
  const addCollection=e.target.closest('[data-add-collection]');
  if(addCollection){const collectionId=$('#detail-collection-select')?.value;if(!collectionId){toast('컬렉션을 먼저 선택해 주세요.','error');return;}addMediaToCollection(collectionId,state.currentModal?.media);return;}
  const createCollection=e.target.closest('[data-create-collection-detail]');
  if(createCollection){const collection=createCollectionPrompt();if(collection&&state.currentModal?.media){addMediaToCollection(collection.id,state.currentModal.media);const select=$('#detail-collection-select');if(select)select.value=collection.id;}return;}
  const relation=e.target.closest('[data-open]');if(relation){e.stopPropagation();openAnime(relation.dataset.open);}
});
function readRecentSearches(){try{return JSON.parse(localStorage.getItem('animehub_recent_searches')||'[]');}catch{return [];}}
function saveRecentSearch(q){q=String(q||'').trim();if(q.length<2)return;const list=readRecentSearches().filter(x=>x!==q);list.unshift(q);localStorage.setItem('animehub_recent_searches',JSON.stringify(list.slice(0,8)));updateSearchSuggestions();}
function updateSearchSuggestions(){const dl=document.getElementById('search-suggestions');if(!dl)return;dl.innerHTML=readRecentSearches().map(q=>`<option value="${esc(q)}"></option>`).join('');}
$('#global-search').addEventListener('keydown',e=>{if(e.key==='Enter'){const q=e.target.value.trim();state.query=q;state.filters=defaultFilters();saveRecentSearch(q);navigate('browse');}});
$('#global-search').addEventListener('input',()=>updateSearchSuggestions());
updateSearchSuggestions();
$('#global-search').addEventListener('search',e=>{if(!e.target.value){state.query='';}});
$('#account-button').addEventListener('click',()=>state.supabase?showAuth():showSettings());
$('#settings-open').addEventListener('click',showSettings);
async function refreshCurrentRoute(){
  if(state.forceRefreshApi)return;
  state.forceRefreshApi=true;state.lastAutoRefresh=Date.now();
  const button=$('#refresh-data');if(button){button.classList.add('is-refreshing');button.disabled=true;}
  try{await renderRoute();if(state.staleDataUsed)toast('API가 응답하지 않아 저장된 이전 정보를 표시했습니다.','error');}
  finally{state.forceRefreshApi=false;if(button){button.classList.remove('is-refreshing');button.disabled=false;}}
}
$('#refresh-data').addEventListener('click',refreshCurrentRoute);

window.addEventListener('hashchange',()=>{const raw=location.hash.slice(1)||'home';if(raw.startsWith('collection:')){const id=raw.slice('collection:'.length);renderCollectionDetail(id);updateContinueBar();return;}const route=raw;if(route!==state.route){state.route=route;renderRoute();updateContinueBar();}});

const backToTop=document.getElementById('back-to-top');
if(backToTop){
  window.addEventListener('scroll',()=>{backToTop.classList.toggle('show',window.scrollY>400);},{passive:true});
  backToTop.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#install-button').hidden=false;});
function showInstallHelp(){
  const root=$('#modal-root');
  const ua=navigator.userAgent||'';const isIOS=/iPhone|iPad|iPod/i.test(ua);const isAndroid=/Android/i.test(ua);
  let steps=isIOS?'Safari 하단의 공유 버튼을 누른 뒤 <b>홈 화면에 추가</b>를 선택하세요.':'Chrome 또는 Edge 메뉴에서 <b>앱 설치</b>나 <b>홈 화면에 추가</b>를 선택하세요.';
  if(isAndroid)steps='Android Chrome에서 우측 상단 메뉴(⋮)를 열고 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.';
  root.innerHTML=`<div class="modal-backdrop" data-close-modal><div class="modal" style="max-width:480px"><div class="modal-top"><button class="close-button" data-close-modal>×</button></div><div class="settings-wrap"><div class="eyebrow">모바일 앱 설치</div><h2>ANIME HUB를 앱처럼 사용하기</h2><p class="detail-desc">${steps}</p><div class="warning-box">설치 메뉴가 나타나려면 공개된 HTTPS 주소에서 접속해야 합니다. PC의 <code>localhost</code> 주소는 스마트폰에서 그대로 사용할 수 없으며, 일반 HTTP 내부 IP 주소는 설치 조건을 충족하지 않습니다.</div><p class="hint">설치하면 홈 화면 아이콘과 독립 실행 화면을 사용할 수 있습니다. 앱을 설치해도 AniList·TMDB 정보 조회에는 인터넷 연결이 필요합니다.</p></div></div></div>`;
}
$('#install-button').addEventListener('click',async()=>{
  if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('#install-button').hidden=true;return;}
  showInstallHelp();
});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;$('#install-button').hidden=true;toast('ANIME HUB를 설치했습니다.');});
if(!window.matchMedia('(display-mode: standalone)').matches&&!navigator.standalone){$('#install-button').hidden=false;}


// 화면을 계속 열어 둔 경우 20분마다 현재 메뉴의 데이터만 새로 확인합니다.
setInterval(()=>{
  const formFocused=$('#main-content')?.contains(document.activeElement) && ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
  if(document.visibilityState==='visible' && !formFocused && !$('#modal-root').innerHTML && Date.now()-state.lastAutoRefresh>=AUTO_REFRESH_MS){refreshCurrentRoute();}
},60000);
window.addEventListener('online',async()=>{if(document.visibilityState==='visible')refreshCurrentRoute();await replayQueuedMutations();});

document.addEventListener('change',e=>{if(e.target?.id==='airing-tz'){state.airingTimeZone=e.target.value;try{localStorage.setItem('animehub_airing_tz_v1',e.target.value);}catch(err){}const t=$('#airing-results');if(t)renderAiringView(t,state.airingSource||'AniList 방영 일정',false,Date.now());}});

async function replayQueuedMutations(){
  if(!state.supabase||!state.user)return;
  let queue=readQueue();
  if(!queue.length)return;
  for(const entry of [...queue]){
    try{
      if(entry.type==='upsert'&&entry.payload)await syncUpsert(entry.payload);
      else if(entry.type==='delete'&&entry.payload?.media_id!=null)await syncDelete(entry.payload.media_id);
      else if(entry.type==='profile')await syncUserData();
      queue=dequeue(queue,entry.mutation_id);
      writeQueue(queue);
    }catch(error){
      queue=markAttempt(queue,entry.mutation_id);
      writeQueue(queue);
      if((entry.attempts||0)>=5)console.warn('Mutation dropped after 5 attempts:',entry,error);
    }
  }
  if(readQueue().length===0)toast('오프라인 변경 사항을 동기화했습니다.');
}

setInterval(()=>{if(document.visibilityState==='visible')checkNewReleaseAlerts(false);},30*60*1000);
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker registration failed',err)));}
await loadSupabase();updateAccountButton();loadKoreanTitlesDb().catch(()=>{});const initialHash=location.hash.slice(1)||'home';if(initialHash.startsWith('collection:')){renderCollectionDetail(initialHash.slice('collection:'.length));}else{state.route=initialHash;renderRoute();}updateContinueBar();if(state.notificationsEnabled&&'Notification' in window&&Notification.permission==='granted')checkNewReleaseAlerts(false);
