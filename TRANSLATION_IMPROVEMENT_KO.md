# 한국어 번역 커버리지 개선 — 무료 방안 종합

## 문제 재정의

"번역이 안 되는 애니가 많다"의 근본 원인:
1. **TMDB 매칭 실패** — 임계값이 너무 엄격해서 매칭이 실패
2. **번역 품질** — Google Translate는 애니 제목에 부적합 (고유명사 처리 약함)
3. **소스 부족** — AniList/Jikan/TMDB 모두 한국어를 "부가"로 취급

## 무료 해결 방안 (비용 $0)

### 방안 1: TMDB 매칭 강화 (즉시, +15~20%)

**현재 문제**:
- `titleHit>=8` → 부분 매칭 실패 (예: "Steins;Gate" vs "Steins Gate" → 8점 미만)
- 연도 필터 ±3년 → 오래된 작품 매칭 실패
- 검색 쿼리 7개 → 더 많은 변형 시도 필요

**개선**:
- titleHit 임계값: 8 → 5 (부분 매칭 허용)
- 연도 필터: ±3년 → ±5년
- 검색 쿼리: 7개 → 15개 (native title, synonyms 추가)
- fallback: titleHit≥5이면 매칭 (현재는 ≥8)

### 방안 2: Google Gemini 무료 API (즉시, +30~40%, 품질 대폭 향상)

**Google Translate vs Gemini 비교**:
| | Google Translate (무료) | Google Gemini (무료 tier) |
|---|---|---|
| 한국어 품질 | 어색함 (고유명사 처리 약함) | 자연스러움 (맥락 이해) |
| API 키 | 불필요 | 필요 (무료 발급) |
| Rate limit | 제한 없음 (비공식) | 15 req/min (무료) |
| 비용 | $0 | $0 (무료 tier) |
| 고유명사 | "Steins;Gate" → "슈타인즈;게이트" | "Steins;Gate" → "슈타인즈 게이트" |

**Gemini 무료 tier**:
- Google AI Studio (aistudio.google.com)에서 API 키 무료 발급
- 무료: 15 requests/minute, 1 million tokens/day
- 모델: gemini-1.5-flash (빠르고 무료)
- 애니 제목 번역에 충분한 품질

**결정**: 정확도 문제로 **AI 번역(Gemini/Google)은 기각**하기로 함. 자동 폴백/프리패치에서 제거하고, 번역이 안 되는 미등록 작품만 나무위키 조회로 보완한다.

### 방안 3: crowdsourced 한국어 제목 DB (중기, +50%)

**구축 방법**:
1. AniList 상위 5000개 작품 추출 (popularity desc)
2. 각 작품의 AniList Korean synonym → DB에 추가
3. TMDB에서 한국어 번역 가져오기 → DB에 추가
4. Jikan에서 한국어 제목 가져오기 → DB에 추가
5. 중복 제거 (AniList ID 기준)
6. 사용자가 "한국어 제목 직접 입력"으로 기여 → DB에 추가
7. GitHub에 공개 DB → 커뮤니티 기여

**예상 커버리지**: AniList (~20%) + TMDB (~35%) + Jikan (~10%) = ~50% (중복 제거 후)

### 방안 4: 나무위키 데이터 활용 (장기, +80%)

나무위키(https://namu.wiki)에는 거의 모든 애니의 한국어 제목이 있습니다:
- URL 패턴: `namu.wiki/w/{애니_제목}`
- 한국어 제목이 문서 제목으로 사용됨
- 하지만 스크래핑은 법적/기술적 문제

**대안**: 나무위키 API (비공식) 또는 사용자가 직접 입력한 데이터를 나무위키에서 확인

**검증 결과 (2026-11-04)**: 브라우저에서 `https://wiki-api.namu.la/api`는 DNS/터널 실패, `https://namu.wiki/api`는 CORS 헤더가 없어 읽기 불가. 나무위키는 MediaWiki가 아니라 자체 엔진(the seed)이라 표준 `api.php`도 없다. 따라서 현재 구현은 **best-effort**(실패 시 빈 결과 → 다음 단계로 진행)이며, 실제 데이터 활용에는 서버 측 프록시나 승인된 API가 필요하다.

### 방안 4-1: 한국어 위키백과 (실사용 가능, v4.9+)

나무위키 조회가 실패할 때 사용할 수 있는 **브라우저 직접 조회 가능한 한국어 소스**다. 한국어 위키백과 Action API는 `origin=*`(CORS 허용)을 지원한다.

- 검색: `https://ko.wikipedia.org/w/api.php?action=query&list=search&origin=*`
- 소개: `action=query&prop=extracts&exintro=1&explaintext=1&redirects=1`
- `data/korean-wiki.js`: `searchKoreanWikipedia`, `lookupKoreanWikipedia`
- 애니메이션·만화 문서(`애니메이션`, `만화`, `극장판`, `OVA`, `라이트 노벨` 등)로 확인된 경우에만 사용하고, 동음이의 문서는 제외한다. 소개는 600자로 제한한다.
- AI는 이 경로에서 사용하지 않는다. (AI는 나무위키 검색 후보 생성에만 한정)

**검증 (2026-11-04)**: `鬼滅の刃` → `귀멸의 칼날`, `ぼっち・ざ・ろっく！` → `봇치 더 록!`, `Sonny Boy` → 동명 문서의 한국어 소개 확인. 브라우저에서 CORS 오류 없이 동작.

**한국어 소스 폴백 순서**: 나무위키(직접 검색) → AI 한국어 후보로 나무위키 재검색 → 한국어 위키백과 → 원제. 확인된 문서가 없으면 원제를 유지한다.

### 방안 5: 퍼지 검색 (Fuzzy Search, v4.9+)

**문제**: 번역·수집된 데이터가 "완벽히 같은 이름"일 때만 검색 결과가 나왔음. 사용자가 번역된 이름이나 비슷한 이름(예: "귀멸의 칼날: 무한열차편" vs "귀멸의 칼날")으로 검색해도 결과가 없었음.

**해결**: `data/fuzzy-search.js` — Levenshtein similarity + 정규화 + 부분 매칭.

- `levenshtein`, `similarity`, `normalizeForSearch`, `fuzzyMatch`, `fuzzyFilter`, `searchVariants` (v4.9+)
- 검색 폴백: 정확한 매칭이 모두 실패 → 후보 풀에서 `fuzzyFilter` → 유사 이름 결과 반환

**기대 효과**: "완벽히 같아야 나오는 게 아니라 비슷한 이름의 결과가 나왔으면 좋겠다" 요구 충족.

---

## 즉시 구현: 방안 1 + 방안 2 + 방안 4-1 + 방안 5 (+ AI 번역 기각, 나무위키 보조)

### 1. TMDB 매칭 강화

`chooseTMDBMatch` 임계값 낮춤 + 검색 쿼리 확대 + 연도 필터 확대

### 2. Gemini 무료 API (나무위키 검색 보조로 한정)

설정에서 Gemini API 키 입력 → 번역이 안 되는 작품의 **나무위키 검색 후보(한국어 제목)** 생성에만 사용. AI 번역 결과를 화면 표시·저장 출처로 쓰지 않으며, 나무위키에서 실제 문서가 확인된 경우에만 그 제목·소개를 사용한다.

### 2-1. 한국어 위키백과 폴백 (실사용 가능)

나무위키 조회가 실패하면 `data/korean-wiki.js`로 한국어 위키백과를 조회한다. CORS(`origin=*`)가 허용되어 브라우저에서 직접 동작하며, 애니메이션·만화 문서로 확인된 경우에만 제목·소개를 사용한다. AI는 사용하지 않는다.

### 3. crowdsourced DB 뼈대 구축

`data/korean-titles-db.json` 파일 생성 (AniList synonyms + TMDB + Jikan 통합)

---

## 구현할까요?

- **A**: TMDB 매칭 강화만 (즉시, +15~20%)
- **B**: TMDB 강화 + Gemini 무료 API (즉시, +30~40%, 품질 향상)
- **C**: B + crowdsourced DB 뼈대 (중기, +50%)
- **D**: 모두 (B + C + DB 구축)

**추천**: B + 방안 5 + AI 번역 기각(나무위키 검색 보조로 한정) + 한국어 위키백과 폴백. 비용 $0, 즉시 효과, 품질 대폭 향상, 유사 이름 검색 지원.

Gemini API 키는 https://aistudio.google.com 에서 무료로 발급받을 수 있습니다 (Google 계정만 있으면 됨).