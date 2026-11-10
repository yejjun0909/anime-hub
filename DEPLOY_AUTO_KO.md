# 애니허브 v4.8.0 — 자동 배포 (PC 없이 모바일 사용)

한 번 Git 저장소에 연결해 두면, **변경 사항을 커밋·푸시할 때마다 자동으로 다시 배포**됩니다.
이후에는 ZIP을 다시 올리거나 PC에서 서버를 켤 필요가 없습니다.

- 권장: **GitHub Pages + GitHub Actions** (무료, 별도 서비스 가입 불필요)
- 대안: **Netlify Git 연동**, **Cloudflare Pages Git 연동**
- 수동 ZIP 업로드는 `DEPLOY_NO_INSTALL_KO.md`를 참고하세요. (일회성·비상용)

## 공통: 로컬 저장소 준비

이 프로젝트는 이미 Git 저장소입니다. GitHub에 빈 저장소를 하나 만든 뒤(README 없이),
아래 명령으로 연결합니다.

```powershell
cd E:\다운로드\anime-hub
git branch -M main
git remote add origin https://github.com/<사용자>/<저장소>.git
git push -u origin main
```

처음 한 번은 Git Credential Manager가 GitHub 로그인 창을 띄웁니다. 로그인하면 이후 푸시는 자동입니다.

## 방법 A — GitHub Pages (권장)

1. GitHub에서 **New repository** → 이름 입력 → **Add a README file 체크 해제** → Create.
2. 위 공통 명령으로 `git push`.
3. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 변경합니다. (워크플로가 `configure-pages`로 자동 설정을 시도하지만, 처음 한 번은 직접 지정하는 것이 확실합니다.)
4. **Actions** 탭에서 `Deploy to GitHub Pages` 워크플로가 실행되는지 확인.
5. 배포 주소: `https://<사용자>.github.io/<저장소>/`

이제 `main`(또는 `master`) 브랜치에 푸시할 때마다 `.github/workflows/deploy-pages.yml`이
다음 작업을 자동으로 수행합니다.

- 플랫폼 카탈로그 JS 재생성
- 단일 HTML 재생성
- `_site/` 배포 폴더 생성
- 카탈로그·단일 HTML 검사
- GitHub Pages 배포

> 무료 GitHub 계정에서 Pages를 쓰려면 저장소가 **Public**이어야 합니다.
> Private 저장소는 GitHub Pro 이상에서 Pages를 사용할 수 있습니다.

## 방법 B — Netlify Git 연동

1. [Netlify](https://app.netlify.com/) → **Add new site → Import an existing project**.
2. GitHub 저장소를 연결합니다.
3. `netlify.toml`에 설정된 값이 자동 적용됩니다.
   - Build command: `python3 tools/build_site.py`
   - Publish directory: `_site`
4. **Deploy site**를 누르면 이후 푸시마다 자동 배포됩니다.

## 방법 C — Cloudflare Pages Git 연동

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. 저장소를 연결합니다.
3. 빌드 설정:
   - Framework preset: **None**
   - Build command: `python3 tools/build_site.py`
   - Build output directory: `_site`
4. **Save and Deploy**를 누르면 이후 푸시마다 자동 배포됩니다.

## 변경 사항 반영 흐름

일반 코드·문서 변경은 커밋 후 푸시만 하면 됩니다.

```powershell
git add -A
git commit -m "변경 내용"
git push
```

데이터를 새로 수확한 경우에는 파생 파일도 함께 갱신한 뒤 푸시하세요.

```powershell
py tools/harvest_laftel.py --anilist-pages 12   # 라프텔 수확(선택)
py tools/build_korean_platform_catalog.py      # JSON → JS
py tools/build_title_index.py                  # 한국어 검색 인덱스(AniList 조회)
py tools/build_single.py                       # 단일 HTML
py tools/check_korean_catalog.py               # 검사
git add -A
git commit -m "data: refresh Korean platform catalog"
git push
```

자동 배포 워크플로는 `build_korean_platform_catalog.py`, `build_single.py`,
`build_deploy_dir.py`를 실행한 뒤 검사합니다. **검색 인덱스(`build_title_index.py`)는
AniList를 조회하므로 CI에서 자동 실행하지 않습니다.** 플랫폼 카탈로그를 바꿨다면
로컬에서 먼저 인덱스를 갱신해야 검사가 통과합니다.

## 모바일에서 사용

배포 주소를 폰에서 한 번 열고 홈 화면에 추가합니다.

- Android Chrome: 메뉴 → **앱 설치** 또는 **홈 화면에 추가**
- iPhone Safari: 공유 → **홈 화면에 추가**

이후에는 PC 전원과 무관하게 홈 화면 아이콘으로 실행됩니다.

- 앱 셸(HTML/JS/CSS/JSON)과 최근 포스터 이미지는 서비스 워커가 캐시합니다.
- 새 검색·작품 정보·방영 정보는 인터넷 연결이 필요합니다.
- AniList 응답은 기기에서 약 20분간 캐시되며, 네트워크 실패 시 이전 캐시를 사용할 수 있습니다.
- 보관함·컬렉션·시청 상태는 기기 `localStorage`에 저장됩니다. 기기 간 자동 동기화는
  Supabase를 설정하고 로그인했을 때만 동작합니다.

## 참고

- 로컬 서버만으로는 PC가 꺼질 때 모바일에서 접속할 수 없습니다. 자동 배포는 반드시
  Git 저장소와 정적 호스팅을 연결해야 합니다.
- 같은 Wi-Fi에서 PC가 켜져 있을 때만 임시로 쓰려면 `py tools/serve.py --lan`을 실행하고
  출력되는 `휴대폰 접속 주소`를 사용하세요.
- 배포 후 서비스 워커는 앱 코드를 네트워크 우선으로 갱신하므로, 새 버전은 다음 접속 때
  자동 반영됩니다. 캐시 갱신이 늦으면 브라우저를 새로고침하거나 앱을 다시 실행하세요.
