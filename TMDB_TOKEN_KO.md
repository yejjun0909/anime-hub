# API 키 안내 (TMDB · Gemini)

이 문서는 **선택 사항**입니다. v4.13.0 배포와 한국어 카탈로그 표시에는 TMDB/Gemini 키가 필요하지 않습니다. 키가 없으면 검증된 플랫폼 카탈로그·수확 DB·AniList 별칭 등 출처가 확인된 자료만 사용합니다.

## TMDB Read Access Token (v4)

한국어 제목 DB를 보강할 때만 사용합니다.

1. https://www.themoviedb.org/signup 에서 무료 계정을 만듭니다.
2. 로그인 후 프로필 → **Settings** → **API** → **Create**를 선택합니다.
3. **Developer**를 선택하고 앱 정보를 입력합니다.
   - Application Name: `Anime Hub`
   - Application URL: `http://localhost` 또는 배포 URL
   - Application Summary: `Anime metadata localization`
4. 제출 후 **API Read Access Token (Bearer Token)**을 복사합니다.

수확 스크립트에서만 사용합니다(브라우저 번들에 넣지 마세요).

```bash
py tools/build_korean_titles_db.py --limit 1000 --tmdb-token YOUR_TOKEN --resume
```

- 결과는 `data/korean-titles-db.json`에 저장됩니다.
- 앱의 **설정 → 데이터 · 계정 설정 → 한국어 작품명 · 줄거리 정보**에서도 토큰을 입력할 수 있습니다. 이 값은 해당 브라우저의 `localStorage`에만 저장되며 서버로 전송되지 않습니다.
- 무료 tier에는 요청 제한이 있으므로 `--resume`으로 이어서 실행하세요.

## Gemini API 키 (선택적 보조 번역)

1. https://aistudio.google.com/apikey 에서 Google 계정으로 로그인해 API 키를 발급합니다.
2. 앱의 **설정 → 데이터 · 계정 설정 → Gemini**에서 키를 입력합니다. 브라우저 `localStorage`의 `animehub_gemini_key_v1`에만 저장되며 저장소나 배포 파일에 포함되지 않습니다.
3. 무료 tier는 분당 요청 수와 일일 토큰 제한이 있습니다. 기본 모델은 `gemini-2.5-flash`입니다.

주의:

- **자동 번역은 기본 OFF**입니다. 설정에서 켠 경우에만 작품 상세의 **자동 번역 보기**가 동작하며, 결과는 항상 `자동 번역 · 비공식`으로 표시됩니다.
- 기계/AI 번역은 플랫폼 카탈로그나 검증 DB에 기록되지 않고 공식 제목·소개로 표시되지 않습니다.
- 번역 결과를 **내 한국어 자료로 저장**하면 사용자 입력으로 취급되며, 공식 표기와 다를 수 있음을 함께 표시합니다.
- 키를 브라우저에 입력할 때는 공용 기기 사용을 피하고, 필요 없어지면 설정에서 삭제하세요.

## 현재 v4.13.0 배포

이번 배포는 쿠팡플레이·디즈니+ KR 수확분을 포함한 검증된 한국어 카탈로그(285건)를 제공합니다. 위 키는 없어도 모든 공식 표시 기능이 동작합니다.
