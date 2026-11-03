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

**구현**: Google Translate 대신 Gemini를 사용 (API 키 입력 시). 키 없으면 Google Translate 폴백.

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

---

## 즉시 구현: 방안 1 + 방안 2

### 1. TMDB 매칭 강화

`chooseTMDBMatch` 임계값 낮춤 + 검색 쿼리 확대 + 연도 필터 확대

### 2. Google Gemini 무료 API 추가

설정에서 Gemini API 키 입력 → Google Translate 대신 Gemini 사용 (품질 대폭 향상)

### 3. crowdsourced DB 뼈대 구축

`data/korean-titles-db.json` 파일 생성 (AniList synonyms + TMDB + Jikan 통합)

---

## 구현할까요?

- **A**: TMDB 매칭 강화만 (즉시, +15~20%)
- **B**: TMDB 강화 + Gemini 무료 API (즉시, +30~40%, 품질 향상)
- **C**: B + crowdsourced DB 뼈대 (중기, +50%)
- **D**: 모두 (B + C + DB 구축)

**추천**: B (TMDB 강화 + Gemini 무료 API). 비용 $0, 즉시 효과, 품질 대폭 향상.

Gemini API 키는 https://aistudio.google.com 에서 무료로 발급받을 수 있습니다 (Google 계정만 있으면 됨).