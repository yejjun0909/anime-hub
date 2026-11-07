# TMDB API 토큰 발급 가이드

## 1. 가입
https://www.themoviedb.org/signup 에서 무료 계정 생성.

## 2. API 키 발급
1. 로그인 후 우측 상단 프로필 → Settings
2. 좌측 메뉴 "API" → "Create" 클릭
3. "Developer" 선택
4. 앱 정보 입력:
   - Application Name: Anime Hub
   - Application URL: http://localhost (또는 배포 URL)
   - Application Summary: Anime metadata localization
5. "Submit" → API Read Access Token (Bearer Token) 복사

## 3. DB 수확 실행
```bash
py tools/build_korean_titles_db.py --limit 1000 --tmdb-token YOUR_TOKEN --resume
```

## 4. 결과
- `data/korean-titles-db.json`에 TMDB 한국어 제목이 추가됩니다.
- 앱은 자동으로 TMDB 제목을 우선 표시합니다 ( verified source ).

## 주의
- API 키는 브라우저에 노출하지 마세요. 빌드 스크립트에서만 사용합니다.
- 무료 tier는 요청 제한이 있으므로 `--resume`으로 이어받기 하세요.
""", "path">
E:\다운로드\anime-hub\TMDB_TOKEN_KO.md